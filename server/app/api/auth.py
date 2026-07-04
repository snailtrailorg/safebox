"""认证 API：注册、登录、验证码、密码重置、设备注册。"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.i18n import get_lang, get_text
from app.middleware import get_current_user_id
from app.schemas.auth import (
    DeviceInfo,
    LoginEmailRequest,
    LoginGoogleRequest,
    LoginPhoneRequest,
    LoginResponse,
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
    LogoutRequest,
)
from app.services.auth_service import (
    create_access_token,
    create_refresh_token,
    create_user_with_keys,
    find_user_by_email,
    find_user_by_google_id,
    find_user_by_phone,
    get_user_devices,
    get_user_keys,
    hash_password,
    revoke_all_user_tokens,
    verify_and_rotate_refresh_token,
    verify_password,
)
from app.services.email_service import send_verification_email
from app.services.google_auth_service import verify_google_id_token
from app.services.sms_service import send_sms
from app.services.verification_service import (
    check_login_rate_limit,
    check_rate_limit,
    clear_login_failures,
    generate_code,
    store_code,
    verify_and_consume,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


async def get_i18n(request: Request):
    """FastAPI 依赖：从 Accept-Language header 解析语言，返回 gettext 风格的翻译函数。"""
    lang = get_lang(request.headers.get("Accept-Language"))
    return lambda key, **kw: get_text(key, lang, **kw)


# ── 预登录 ──────────────────────────────────────────

@router.get("/salt")
async def get_salt(email: str | None = None, phone: str | None = None, db: AsyncSession = Depends(get_db)):
    """获取用户密码 salt，用于客户端 PBKDF2 派生密钥。

    始终返回 200（即使用户不存在），防止用户枚举攻击。
    """
    user = None
    if email:
        user = await find_user_by_email(db, email)
    elif phone:
        user = await find_user_by_phone(db, phone)

    if user:
        keys = await get_user_keys(db, user.id)
        return {
            "password_salt": user.password_salt,
            "recovery_wrapped": keys.recovery_wrapped if keys else "",
            "encrypted_private": keys.encrypted_private if keys else "",
            "rsa_public_key": keys.rsa_public_key if keys else "",
        }
    # 用户不存在时返回随机 salt，防止枚举
    import secrets
    return {"password_salt": secrets.token_hex(16)}


# ── 验证码 ──────────────────────────────────────────

@router.post("/send-code", response_model=SendCodeResponse)
async def send_code(req: SendCodeRequest, request: Request, db: AsyncSession = Depends(get_db), _ = Depends(get_i18n)):
    """发送验证码（phone 或 email）。60 秒内同一目标只能发一次。"""
    lang = get_lang(request.headers.get("Accept-Language"))
    # 频率限制
    if not await check_rate_limit(req.target, req.value):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=_("verification_code_rate_limited", seconds=settings.verification_code_rate_limit_seconds),
        )

    # 生成验证码
    code = generate_code()

    # 实际发送验证码
    sent = False
    if req.target == "phone":
        sent = await send_sms(req.value, code, lang)
    else:
        sent = await send_verification_email(req.value, code, lang)

    if not sent:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to send verification code",
        )

    await store_code(req.target, req.value, code)

    return SendCodeResponse(expires_in=settings.verification_code_expire_seconds)


# ── 注册 ──────────────────────────────────────────

@router.post("/register/email", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_email(req: RegisterEmailRequest, db: AsyncSession = Depends(get_db), _ = Depends(get_i18n)):
    """邮箱注册。"""
    if not await verify_and_consume("email", req.email, req.verification_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_("verification_code_invalid"))

    existing = await find_user_by_email(db, req.email)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_("email_already_registered"))

    user = await create_user_with_keys(
        db=db,
        email=req.email,
        phone=None,
        google_id=None,
        password=req.password_hash,
        client_password_salt=req.password_salt,
        password_wrapped=req.password_wrapped,
        recovery_wrapped=req.recovery_wrapped,
        encrypted_private=req.encrypted_private,
        rsa_public_key=req.rsa_public_key,
        device_name=req.device_name,
        device_public_key=req.device_public_key,
        device_wrapped=req.device_wrapped,
    )

    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    return RegisterResponse(user_id=str(user.id), access_token=access_token, refresh_token=refresh_token)


@router.post("/register/phone", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_phone(req: RegisterPhoneRequest, db: AsyncSession = Depends(get_db), _ = Depends(get_i18n)):
    """手机号注册。"""
    if not await verify_and_consume("phone", req.phone, req.verification_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_("verification_code_invalid"))

    existing = await find_user_by_phone(db, req.phone)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_("phone_already_registered"))

    user = await create_user_with_keys(
        db=db, email=None, phone=req.phone, google_id=None,
        password=req.password_hash,
        client_password_salt=req.password_salt,
        password_wrapped=req.password_wrapped,
        recovery_wrapped=req.recovery_wrapped,
        encrypted_private=req.encrypted_private,
        rsa_public_key=req.rsa_public_key,
        device_name=req.device_name,
        device_public_key=req.device_public_key,
        device_wrapped=req.device_wrapped,
    )

    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    return RegisterResponse(user_id=str(user.id), access_token=access_token, refresh_token=refresh_token)


@router.post("/register/google", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_google(req: RegisterGoogleRequest, db: AsyncSession = Depends(get_db), _ = Depends(get_i18n)):
    """Google OAuth 注册。"""
    google_id = await verify_google_id_token(req.google_id_token)
    if not google_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_("google_token_invalid"))

    existing = await find_user_by_google_id(db, google_id)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_("google_already_registered"))

    user = await create_user_with_keys(
        db=db, email=None, phone=None, google_id=google_id,
        password=req.password_hash,
        client_password_salt=req.password_salt,
        password_wrapped=req.password_wrapped,
        recovery_wrapped=req.recovery_wrapped,
        encrypted_private=req.encrypted_private,
        rsa_public_key=req.rsa_public_key,
        device_name=req.device_name,
        device_public_key=req.device_public_key,
        device_wrapped=req.device_wrapped,
    )

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
        access_token=access_token,
        refresh_token=refresh_token,
        password_salt=user.password_salt,
        password_wrapped=keys.password_wrapped if keys else None,
        recovery_wrapped=keys.recovery_wrapped if keys else "",
        encrypted_private=keys.encrypted_private if keys else "",
        rsa_public_key=keys.rsa_public_key if keys else "",
        devices=[
            DeviceInfo(id=str(d.id), device_name=d.device_name, device_wrapped=d.device_wrapped)
            for d in devices
        ],
    )


@router.post("/login/email", response_model=LoginResponse)
async def login_email(req: LoginEmailRequest, db: AsyncSession = Depends(get_db), _ = Depends(get_i18n)):
    """邮箱 + 密码登录。指数退避限流。"""
    wait = await check_login_rate_limit("email", req.email)
    if wait > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=_("login_rate_limited", seconds=wait),
        )
    user = await find_user_by_email(db, req.email)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_("email_or_password_wrong"))

    if not verify_password(req.password_hash, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_("email_or_password_wrong"))

    await clear_login_failures("email", req.email)
    return await _build_login_response(db, user)


@router.post("/login/phone", response_model=LoginResponse)
async def login_phone(req: LoginPhoneRequest, db: AsyncSession = Depends(get_db), _ = Depends(get_i18n)):
    """手机号 + 验证码 + 密码登录。"""
    wait = await check_login_rate_limit("phone", req.phone)
    if wait > 0:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=_("login_rate_limited", seconds=wait),
        )
    if not await verify_and_consume("phone", req.phone, req.verification_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_("verification_code_invalid"))

    user = await find_user_by_phone(db, req.phone)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_("phone_or_password_wrong"))

    if not verify_password(req.password_hash, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_("phone_or_password_wrong"))

    await clear_login_failures("phone", req.phone)

    return await _build_login_response(db, user)


@router.post("/login/google", response_model=LoginResponse)
async def login_google(req: LoginGoogleRequest, db: AsyncSession = Depends(get_db), _ = Depends(get_i18n)):
    """Google OAuth 登录。"""
    google_id = await verify_google_id_token(req.google_id_token)
    if not google_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_("google_token_invalid"))

    user = await find_user_by_google_id(db, google_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_("google_not_registered"))

    return await _build_login_response(db, user)


# ── 密码重置 ───────────────────────────────────────

@router.post("/reset-password", response_model=ResetPasswordResponse)
async def reset_password(req: ResetPasswordRequest, db: AsyncSession = Depends(get_db), _ = Depends(get_i18n)):
    """验证码验证后重置密码。"""
    if not await verify_and_consume(req.target, req.value, req.verification_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_("verification_code_invalid"))

    if req.target == "phone":
        user = await find_user_by_phone(db, req.value)
    else:
        user = await find_user_by_email(db, req.value)

    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_("user_not_found"))

    # 更新密码哈希和 wrapped key
    user.password_hash = hash_password(req.new_password_hash)
    user.password_salt = req.new_password_salt

    keys = await get_user_keys(db, user.id)
    if keys:
        keys.password_wrapped = req.new_password_wrapped

    await db.commit()

    # 撤销旧 refresh token
    if user:
        await revoke_all_user_tokens(db, user.id)
        await db.commit()

    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    return ResetPasswordResponse(
        success=True,
        access_token=access_token,
        refresh_token=refresh_token,
        password_salt=user.password_salt if user.password_salt else None,
        password_wrapped=keys.password_wrapped if keys else None,
        recovery_wrapped=keys.recovery_wrapped if keys else "",
        encrypted_private=keys.encrypted_private if keys else "",
        rsa_public_key=keys.rsa_public_key if keys else "",
    )


# ── Token 刷新（带 rotation）─────────────────────

@router.post("/refresh-token", response_model=RefreshTokenResponse)
async def refresh_token(
    req: RefreshTokenRequest,
    db: AsyncSession = Depends(get_db),
    _ = Depends(get_i18n),
):
    """用 refresh_token 换取新的 token 对。旧 token（无 family）降级刷新。"""
    result = await verify_and_rotate_refresh_token(db, req.refresh_token)
    if result is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_("refresh_token_invalid"))

    new_access, new_refresh, _ = result
    return RefreshTokenResponse(access_token=new_access, refresh_token=new_refresh)


# ── 登出 ──────────────────────────────────────────


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    req: LogoutRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """登出。撤销用户所有 refresh token。"""
    await revoke_all_user_tokens(db, user_id)
    await db.commit()


# ── 设备注册（换手机时）────────────────────────────

@router.post("/register-device", response_model=RegisterDeviceResponse)
async def register_device(
    req: RegisterDeviceRequest,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """注册新设备（Keystore 密钥对）。"""
    from app.models import UserDevice

    device = UserDevice(
        user_id=user_id,
        device_name=req.device_name,
        device_public_key=req.device_public_key,
        device_wrapped=req.device_wrapped,
    )
    db.add(device)
    await db.commit()
    await db.refresh(device)

    return RegisterDeviceResponse(device_id=str(device.id))


# ── 注销账号 ────────────────────────────────────────


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """注销当前账号并删除所有关联数据（级联删除 keys, devices, items, token_families）。"""
    from sqlalchemy import delete
    from app.models import User

    await db.execute(delete(User).where(User.id == user_id))
    await db.commit()
