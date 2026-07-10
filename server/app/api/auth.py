"""认证 API：注册、登录、验证码、密码重置、设备注册。"""

import json
import hmac
import hashlib
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.i18n import get_lang, get_text
from app.middleware import get_current_user_id
from app.models import User, UserDevice
from app.schemas.auth import (
    ChangePasswordRequest,
    DeleteAccountRequest,
    DeviceInfo,
    LoginEmailRequest,
    LoginGoogleRequest,
    LoginPhoneRequest,
    LoginResponse,
    LogoutRequest,
    RefreshTokenRequest,
    RefreshTokenResponse,
    RegisterDeviceRequest,
    RegisterDeviceResponse,
    RegisterEmailRequest,
    RegisterGoogleRequest,
    RegisterPhoneRequest,
    RegisterResponse,
    ResetPasswordRequest,
    ResetPasswordResponse,
    SendCodeRequest,
    SendCodeResponse,
)
from app.services.auth_service import (
    DEFAULT_KDF_SETTINGS,
    create_access_token,
    create_refresh_token,
    create_user_with_keys,
    find_user_by_email,
    find_user_by_google_id,
    find_user_by_phone,
    get_user_devices,
    get_user_keys,
    hash_auth_key,
    revoke_all_user_tokens,
    verify_and_rotate_refresh_token,
    verify_auth_key,
)
from app.services.email_service import send_verification_email
from app.services.google_auth_service import verify_google_id_token
from app.services.sms_service import send_sms
from app.services.verification_service import (
    check_rate_limit,
    clear_login_failures,
    generate_code,
    get_login_wait,
    record_login_failure,
    store_code,
    verify_and_consume,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _t(request: Request, key: str, **kw: object) -> str:
    """快捷 i18n：从请求头解析语言并翻译。"""
    lang = get_lang(request.headers.get("Accept-Language"))
    return get_text(key, lang, **kw)


# ── 预登录 ──────────────────────────────────────────

@router.get("/salt")
async def get_salt(email: str | None = None, phone: str | None = None, db: AsyncSession = Depends(get_db)):
    """获取用户密码 salt，用于客户端 PBKDF2 派生密钥。

    防枚举：不存在用户返回由 target 派生的确定性 salt（HMAC(server_secret, target)），
    与真实用户 salt 同为 base64(32 字节) 且稳定，攻击者无法通过稳定性/格式差异判断用户是否存在。
    """
    user = None
    if email:
        user = await find_user_by_email(db, email)
    elif phone:
        user = await find_user_by_phone(db, phone)

    if user:
        kdf = json.loads(user.kdf_settings) if user.kdf_settings else DEFAULT_KDF_SETTINGS
        return {
            "password_salt": user.password_salt,
            "kdf_settings": kdf,
        }
    # 用户不存在：派生确定性 salt（稳定 + 格式与真实一致），防止枚举
    target = email or phone or ""
    return {"password_salt": _derive_fake_salt(target),
            "kdf_settings": DEFAULT_KDF_SETTINGS}


def _derive_fake_salt(target: str) -> str:
    """为不存在用户派生确定性 salt：base64(HMAC-SHA256(jwt_secret, target))。

    - 稳定：同一 target 每次相同（与真实用户一致）。
    - 格式一致：HMAC-SHA256 输出 32 字节 -> base64，与真实 salt（随机 32 字节 base64）不可区分。
    - 不可预测：依赖 jwt_secret_key，攻击者无法自行计算比对。
    """
    import base64
    digest = hmac.new(settings.jwt_secret_key.encode(), target.encode(), hashlib.sha256).digest()
    return base64.b64encode(digest).decode()


# ── 验证码 ──────────────────────────────────────────

@router.post("/send-code", response_model=SendCodeResponse)
async def send_code(req: SendCodeRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """发送验证码。60 秒内同一目标只能发一次。"""
    lang = get_lang(request.headers.get("Accept-Language"))
    if not await check_rate_limit(req.target, req.value):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=get_text("verification_code_rate_limited", lang, seconds=settings.verification_code_rate_limit_seconds),
        )

    code = generate_code()
    sent = await send_sms(req.value, code, lang) if req.target == "phone" else await send_verification_email(req.value, code, lang)
    if not sent:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Failed to send verification code")

    await store_code(req.target, req.value, code)
    return SendCodeResponse(expires_in=settings.verification_code_expire_seconds)


# ── 注册 ──────────────────────────────────────────

@router.post("/register/email", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_email(req: RegisterEmailRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if not await verify_and_consume("email", req.email, req.verification_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "verification_code_invalid"))
    existing = await find_user_by_email(db, req.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_t(request, "email_already_registered"))

    # 清除该邮箱的历史登录失败计数（防止他人攻击导致的锁影响真正注册用户）
    await clear_login_failures("email", req.email)

    user = await create_user_with_keys(db=db, email=req.email, phone=None, google_id=None,
        password=req.auth_key_hash, client_password_salt=req.password_salt,
        password_wrapped=req.password_wrapped,
        encrypted_private=req.encrypted_private, rsa_public_key=req.rsa_public_key,
        device_name=req.device_name, device_public_key=req.device_public_key, device_wrapped=req.device_wrapped,
        kdf_settings=req.kdf_settings)
    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    return RegisterResponse(user_id=str(user.id), access_token=access_token, refresh_token=refresh_token)


@router.post("/register/phone", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_phone(req: RegisterPhoneRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if not await verify_and_consume("phone", req.phone, req.verification_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "verification_code_invalid"))
    existing = await find_user_by_phone(db, req.phone)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_t(request, "phone_already_registered"))

    user = await create_user_with_keys(db=db, email=None, phone=req.phone, google_id=None,
        password=req.auth_key_hash, client_password_salt=req.password_salt,
        password_wrapped=req.password_wrapped,
        encrypted_private=req.encrypted_private, rsa_public_key=req.rsa_public_key,
        device_name=req.device_name, device_public_key=req.device_public_key, device_wrapped=req.device_wrapped,
        kdf_settings=req.kdf_settings)
    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    return RegisterResponse(user_id=str(user.id), access_token=access_token, refresh_token=refresh_token)


@router.post("/register/google", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_google(req: RegisterGoogleRequest, request: Request, db: AsyncSession = Depends(get_db)):
    google_id = await verify_google_id_token(req.google_id_token)
    if not google_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "google_token_invalid"))
    existing = await find_user_by_google_id(db, google_id)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_t(request, "google_already_registered"))

    user = await create_user_with_keys(db=db, email=None, phone=None, google_id=google_id,
        password=req.auth_key_hash, client_password_salt=req.password_salt,
        password_wrapped=req.password_wrapped,
        encrypted_private=req.encrypted_private, rsa_public_key=req.rsa_public_key,
        device_name=req.device_name, device_public_key=req.device_public_key, device_wrapped=req.device_wrapped,
        kdf_settings=req.kdf_settings)
    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    return RegisterResponse(user_id=str(user.id), access_token=access_token, refresh_token=refresh_token)


# ── 登录 ──────────────────────────────────────────

async def _build_login_response(db: AsyncSession, user) -> LoginResponse:
    """构建登录响应（公共逻辑）。"""
    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    keys = await get_user_keys(db, user.id)
    devices = await get_user_devices(db, user.id)
    return LoginResponse(
        access_token=access_token, refresh_token=refresh_token,
        password_salt=user.password_salt or "",
        password_wrapped=keys.password_wrapped if keys else None,
        encrypted_private=keys.encrypted_private if keys else "",
        rsa_public_key=keys.rsa_public_key if keys else "",
        devices=[DeviceInfo(id=str(d.id), device_name=d.device_name, device_wrapped=d.device_wrapped) for d in devices],
    )


@router.post("/login/email", response_model=LoginResponse)
async def login_email(req: LoginEmailRequest, request: Request, db: AsyncSession = Depends(get_db)):
    wait = await get_login_wait("email", req.email)
    if wait > 0:
        await record_login_failure("email", req.email)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=_t(request, "login_rate_limited", seconds=wait))
    user = await find_user_by_email(db, req.email)
    if not user:
        # 恒等时间：不存在时也跑一次 bcrypt，防止枚举侧信道
        hash_auth_key(req.auth_key_hash)
        await record_login_failure("email", req.email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, "email_or_password_wrong"))
    if not verify_auth_key(req.auth_key_hash, user.auth_key_hash):
        await record_login_failure("email", req.email)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, "email_or_password_wrong"))
    await clear_login_failures("email", req.email)
    return await _build_login_response(db, user)


@router.post("/login/phone", response_model=LoginResponse)
async def login_phone(req: LoginPhoneRequest, request: Request, db: AsyncSession = Depends(get_db)):
    wait = await get_login_wait("phone", req.phone)
    if wait > 0:
        await record_login_failure("phone", req.phone)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=_t(request, "login_rate_limited", seconds=wait))
    if not await verify_and_consume("phone", req.phone, req.verification_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "verification_code_invalid"))
    user = await find_user_by_phone(db, req.phone)
    if not user:
        hash_auth_key(req.auth_key_hash)
        await record_login_failure("phone", req.phone)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, "phone_or_password_wrong"))
    if not verify_auth_key(req.auth_key_hash, user.auth_key_hash):
        await record_login_failure("phone", req.phone)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, "phone_or_password_wrong"))
    await clear_login_failures("phone", req.phone)
    return await _build_login_response(db, user)


@router.post("/login/google", response_model=LoginResponse)
async def login_google(req: LoginGoogleRequest, request: Request, db: AsyncSession = Depends(get_db)):
    google_id = await verify_google_id_token(req.google_id_token)
    if not google_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "google_token_invalid"))
    wait = await get_login_wait("google", google_id)
    if wait > 0:
        await record_login_failure("google", google_id)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=_t(request, "login_rate_limited", seconds=wait))
    user = await find_user_by_google_id(db, google_id)
    if not user:
        await record_login_failure("google", google_id)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, "google_not_registered"))
    await clear_login_failures("google", google_id)
    return await _build_login_response(db, user)


# ── 密码重置 ───────────────────────────────────────

@router.post("/reset-password", response_model=ResetPasswordResponse)
async def reset_password(req: ResetPasswordRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if not await verify_and_consume(req.target, req.value, req.verification_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "verification_code_invalid"))

    user = await find_user_by_email(db, req.value) if req.target == "email" else await find_user_by_phone(db, req.value)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_t(request, "user_not_found"))

    user.auth_key_hash = hash_auth_key(req.new_auth_key_hash)
    user.password_salt = req.new_password_salt
    keys = await get_user_keys(db, user.id)
    if keys:
        keys.password_wrapped = req.new_password_wrapped
    await db.commit()

    await revoke_all_user_tokens(db, user.id)
    await db.commit()

    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    return ResetPasswordResponse(
        success=True, access_token=access_token, refresh_token=refresh_token,
        password_salt=user.password_salt, password_wrapped=keys.password_wrapped if keys else None,
        encrypted_private=keys.encrypted_private if keys else "",
        rsa_public_key=keys.rsa_public_key if keys else "",
    )


@router.post("/change-password", response_model=ResetPasswordResponse)
async def change_password(
    req: ChangePasswordRequest,
    request: Request,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """已登录用户修改密码。需当前密码 + 验证码双因子。"""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_t(request, "user_not_found"))

    # 因子一：校验当前密码（先于消费验证码，防止仅凭被盗 access token 改密，
    # 也避免当前密码错误时白白烧掉一次性验证码）
    if not verify_auth_key(req.current_auth_key_hash, user.auth_key_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, "current_password_wrong"))

    # 因子二：邮箱/短信验证码
    if not await verify_and_consume(req.target, req.value, req.verification_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "verification_code_invalid"))

    user.auth_key_hash = hash_auth_key(req.new_auth_key_hash)
    user.password_salt = req.new_password_salt
    keys = await get_user_keys(db, user.id)
    if keys:
        keys.password_wrapped = req.new_password_wrapped
    await db.commit()

    await revoke_all_user_tokens(db, user.id)
    await db.commit()

    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    return ResetPasswordResponse(
        success=True, access_token=access_token, refresh_token=refresh_token,
        password_salt=user.password_salt, password_wrapped=keys.password_wrapped if keys else None,
        encrypted_private=keys.encrypted_private if keys else "",
        rsa_public_key=keys.rsa_public_key if keys else "",
    )


# ── Token 刷新 ─────────────────────────────────────

@router.post("/refresh-token", response_model=RefreshTokenResponse)
async def refresh_token(req: RefreshTokenRequest, request: Request, db: AsyncSession = Depends(get_db)):
    result = await verify_and_rotate_refresh_token(db, req.refresh_token)
    if result is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, "refresh_token_invalid"))
    new_access, new_refresh, _ = result
    return RefreshTokenResponse(access_token=new_access, refresh_token=new_refresh)


# ── 登出 ──────────────────────────────────────────

@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(user_id: UUID = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    await revoke_all_user_tokens(db, user_id)
    await db.commit()


# ── 设备注册 ─────────────────────────────────────

@router.post("/register-device", response_model=RegisterDeviceResponse)
async def register_device(req: RegisterDeviceRequest, user_id: UUID = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    device = UserDevice(user_id=user_id, device_name=req.device_name, device_public_key=req.device_public_key, device_wrapped=req.device_wrapped)
    db.add(device)
    await db.commit()
    await db.refresh(device)
    return RegisterDeviceResponse(device_id=str(device.id))


# ── 注销账号 ────────────────────────────────────────

@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    req: DeleteAccountRequest,
    request: Request,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """注销账号。需验证码确认。"""
    if not await verify_and_consume(req.target, req.value, req.verification_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "verification_code_invalid"))

    from app.models import User
    await db.execute(sa_delete(User).where(User.id == user_id))
    await db.commit()
