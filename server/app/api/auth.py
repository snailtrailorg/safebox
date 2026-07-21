"""认证 API：注册、登录（SRP-6a 两步）、验证码、改密、设备注册、注销。"""

from typing import Optional
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
    ChangePasswordResponse,
    DeleteAccountRequest,
    DeviceInfo,
    LoginGoogleRequest,
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
    SRPChallengeRequest,
    SRPChallengeResponse,
    SRPVerifyRequest,
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
    revoke_all_user_tokens,
    verify_and_rotate_refresh_token,
)
from app.services.email_service import send_recovery_alert, send_verification_email
from app.services.google_auth_service import verify_google_id_token
from app.services.sms_service import send_sms
from app.services.srp_service import (
    G as SRP_G,
    N as SRP_N,
    compute_K,
    compute_M2,
    compute_server_public,
    compute_server_S,
    compute_u,
    generate_private_ephemeral,
    is_valid_public,
    verify_M1,
)
from app.services.verification_service import (
    check_rate_limit,
    clear_login_failures,
    create_srp_session,
    delete_srp_session,
    generate_code,
    get_login_wait,
    get_srp_session,
    record_login_failure,
    store_code,
    verify_and_consume,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _t(request: Request, key: str, **kw: object) -> str:
    """快捷 i18n：从请求头解析语言并翻译。"""
    lang = get_lang(request.headers.get("Accept-Language"))
    return get_text(key, lang, **kw)


def _login_err_key(target_type: str) -> str:
    return "email_or_password_wrong" if target_type == "email" else "phone_or_password_wrong"


# ── 预登录 ──────────────────────────────────────────

@router.get("/salt")
async def get_salt(email: Optional[str] = None, phone: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """返回 SRP 参数 + salt（srp_salt/local_salt/mnemonic_salt + N/g + kdf_settings）。

    已注册用户返回其存储值；未注册返回确定性 fake salt 防枚举（SRP verify 必失败）。
    """
    user = None
    if email:
        user = await find_user_by_email(db, email)
    elif phone:
        user = await find_user_by_phone(db, phone)

    if user:
        kdf = json.loads(user.kdf_settings) if user.kdf_settings else DEFAULT_KDF_SETTINGS
        keys = await get_user_keys(db, user.id)
        return {
            "srp_salt": user.srp_salt or "",
            "local_salt": user.local_salt or "",
            "kdf_settings": kdf,
            "mnemonic_salt": keys.mnemonic_salt if keys else "",
            "N": hex(SRP_N)[2:],
            "g": str(SRP_G),
        }
    target = email or phone or ""
    return {
        "srp_salt": _derive_fake_salt(target),
        "local_salt": _derive_fake_salt(target),
        "kdf_settings": DEFAULT_KDF_SETTINGS,
        "mnemonic_salt": _derive_fake_salt(target),
        "N": hex(SRP_N)[2:],
        "g": str(SRP_G),
    }


def _derive_fake_salt(target: str) -> str:
    """为不存在用户派生确定性 salt：base64(HMAC-SHA256(jwt_secret, target))。

    - 稳定：同一 target 每次相同（与真实用户一致）。
    - 格式一致：HMAC-SHA256 输出 32 字节 -> base64，与真实 salt 不可区分。
    - 不可预测：依赖 jwt_secret_key，攻击者无法自行计算比对。
    - SRP verify 时客户端用此 fake srp_salt 派生 x，与服务端 fake verifier 不匹配，必失败。
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


# ── 注册（客户端本地派生 srp_verifier，服务端只存）──────────────────

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
        srp_verifier=req.srp_verifier, srp_salt=req.srp_salt, local_salt=req.local_salt,
        encrypted_user_key=req.encrypted_user_key, mnemonic_salt=req.mnemonic_salt,
        kdf_settings=req.kdf_settings,
        device_name=req.device_name, device_public_key=req.device_public_key, device_wrapped=req.device_wrapped)
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

    await clear_login_failures("phone", req.phone)

    user = await create_user_with_keys(db=db, email=None, phone=req.phone, google_id=None,
        srp_verifier=req.srp_verifier, srp_salt=req.srp_salt, local_salt=req.local_salt,
        encrypted_user_key=req.encrypted_user_key, mnemonic_salt=req.mnemonic_salt,
        kdf_settings=req.kdf_settings,
        device_name=req.device_name, device_public_key=req.device_public_key, device_wrapped=req.device_wrapped)
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
        srp_verifier=req.srp_verifier, srp_salt=req.srp_salt, local_salt=req.local_salt,
        encrypted_user_key=req.encrypted_user_key, mnemonic_salt=req.mnemonic_salt,
        kdf_settings=req.kdf_settings,
        device_name=req.device_name, device_public_key=req.device_public_key, device_wrapped=req.device_wrapped)
    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    return RegisterResponse(user_id=str(user.id), access_token=access_token, refresh_token=refresh_token)


# ── 登录（SRP-6a 两步：challenge A->B，verify M1->M2+token）──────────

async def _build_login_response(db: AsyncSession, user, M2: str = "") -> LoginResponse:
    """构建登录响应。SRP 登录传 M2（服务端证据），Google 登录无 M2。"""
    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    keys = await get_user_keys(db, user.id)
    devices = await get_user_devices(db, user.id)
    return LoginResponse(
        user_id=str(user.id),
        access_token=access_token, refresh_token=refresh_token,
        local_salt=user.local_salt or "",
        encrypted_user_key=keys.encrypted_user_key if keys else "",
        mnemonic_salt=keys.mnemonic_salt if keys else "",
        M2=M2,
        devices=[DeviceInfo(id=str(d.id), device_name=d.device_name, device_wrapped=d.device_wrapped) for d in devices],
    )


@router.post("/login/srp/challenge", response_model=SRPChallengeResponse)
async def login_srp_challenge(req: SRPChallengeRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """SRP 第一步：客户端发 A，服务端返回 B + session_id（存 b/v/A 到 Redis）。"""
    wait = await get_login_wait(req.target_type, req.target)
    if wait > 0:
        await record_login_failure(req.target_type, req.target)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=_t(request, "login_rate_limited", seconds=wait))

    if req.target_type == "email":
        user = await find_user_by_email(db, req.target)
    else:
        user = await find_user_by_phone(db, req.target)

    try:
        A = int(req.A, 16)
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid A")
    if not is_valid_public(A):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid A")

    if user and user.srp_verifier and user.srp_salt:
        v = int(user.srp_verifier, 16)
        user_id = str(user.id)
    else:
        # 用户不存在或缺 verifier：用随机假 verifier，verify 必失败（与真用户错密码一样返回 401）
        v = generate_private_ephemeral()
        user_id = None

    b = generate_private_ephemeral()
    B = compute_server_public(v, b)
    session_id = await create_srp_session(
        b_hex=hex(b)[2:], v_hex=hex(v)[2:], A_hex=hex(A)[2:],
        user_id=user_id, target_type=req.target_type, target=req.target,
    )
    return SRPChallengeResponse(session_id=session_id, B=hex(B)[2:])


@router.post("/login/srp/verify", response_model=LoginResponse)
async def login_srp_verify(req: SRPVerifyRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """SRP 第二步：客户端发 M1，服务端验证后返回 M2 + token。"""
    session = await get_srp_session(req.session_id)
    if not session:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="SRP session expired")
    await delete_srp_session(req.session_id)  # 一次性，防重放

    target_type = session["target_type"]
    target = session["target"]
    b = int(session["b"], 16)
    v = int(session["v"], 16)
    A = int(session["A"], 16)
    user_id = session.get("user_id")

    try:
        client_M1 = bytes.fromhex(req.M1)
    except (ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid M1")

    B = compute_server_public(v, b)
    u = compute_u(A, B)
    S = compute_server_S(A, v, u, b)
    K = compute_K(S)

    if not verify_M1(A, B, K, client_M1):
        # 真用户密码错 / 用户不存在（fake verifier）/ 客户端算错：统一 401
        if user_id:
            await record_login_failure(target_type, target)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, _login_err_key(target_type)))

    # fake verifier 不会过 verify_M1，到此一定是真用户且密码正确
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, _login_err_key(target_type)))
    user = await db.get(User, UUID(user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, _login_err_key(target_type)))

    await clear_login_failures(target_type, target)
    M2 = compute_M2(A, client_M1, K).hex()
    return await _build_login_response(db, user, M2=M2)


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


# ── 改主密码 ───────────────────────────────────────
# 旧主密码由前置 SRP 登录验证（客户端先走 challenge+verify 拿 fresh token），此端点只验 fresh token + 验证码。

@router.post("/change-password", response_model=ChangePasswordResponse)
async def change_password(
    req: ChangePasswordRequest,
    request: Request,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """改主密码：主密码参与 K 派生，更新 encrypted_user_key + srp_verifier/srp_salt/local_salt。
    前端用助记词+新主密码派生新 K 重新包裹 UserKey，重新派生 SRP x 算新 verifier。旧密码由前置 SRP 登录验证。"""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_t(request, "user_not_found"))

    # 验证码必须发到用户注册的邮箱/手机，不接受客户端自带的 target/value
    code_ok = (user.email and await verify_and_consume("email", user.email, req.verification_code)) or \
              (user.phone and await verify_and_consume("phone", user.phone, req.verification_code))
    if not code_ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "verification_code_invalid"))

    user.srp_verifier = req.new_srp_verifier
    user.srp_salt = req.new_srp_salt
    user.local_salt = req.new_local_salt
    keys = await get_user_keys(db, user_id)
    if keys:
        keys.encrypted_user_key = req.new_encrypted_user_key
    await revoke_all_user_tokens(db, user.id)  # 同一事务吊销旧 token（单次 commit，原子）
    await db.commit()

    await send_recovery_alert(user, "password_changed")

    access_token = create_access_token(user.id)
    refresh_token = await create_refresh_token(db, user.id)
    return ChangePasswordResponse(success=True, access_token=access_token, refresh_token=refresh_token)


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
# 旧主密码由前置 SRP 登录验证，此端点只验 fresh token + 验证码。

@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    req: DeleteAccountRequest,
    request: Request,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """注销账号。需 fresh token（前置 SRP 登录）+ 验证码（绑定注册联系方式）确认。"""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_t(request, "user_not_found"))
    code_ok = (user.email and await verify_and_consume("email", user.email, req.verification_code)) or \
              (user.phone and await verify_and_consume("phone", user.phone, req.verification_code))
    if not code_ok:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "verification_code_invalid"))

    await db.execute(sa_delete(User).where(User.id == user_id))
    await db.commit()
