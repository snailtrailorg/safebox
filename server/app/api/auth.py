"""认证 API：注册、登录（SRP-6a 两步 + device 绑定）、验证码、改密、设备管理、注销。"""

from typing import Optional, List
import base64
import json
import hmac
import hashlib
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.i18n import get_lang, get_text
from app.middleware import get_current_user_id, get_current_device_id
from app.models import User, UserDevice
from app.schemas.auth import (
    ChangePasswordRequest,
    ChangePasswordResponse,
    DeleteAccountRequest,
    DeviceInfo,
    LoginGoogleRequest,
    LoginResponse,
    RefreshTokenRequest,
    RefreshTokenResponse,
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
from app.services.token_service import revoke_device_tokens
from app.services.verification_service import (
    check_rate_limit,
    clear_login_failures,
    create_srp_session,
    delete_session_key,
    delete_srp_session,
    generate_code,
    get_login_wait,
    get_srp_session,
    mark_device_revoked,
    record_login_failure,
    renew_session_key,
    store_code,
    store_session_key,
    verify_and_consume,
)

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


def _t(request: Request, key: str, **kw: object) -> str:
    """快捷 i18n：从请求头解析语言并翻译。"""
    lang = get_lang(request.headers.get("Accept-Language"))
    return get_text(key, lang, **kw)


def _login_err_key(target_type: str) -> str:
    return "email_or_password_wrong" if target_type == "email" else "phone_or_password_wrong"


def _parse_user_agent(ua: str) -> tuple[str, str]:
    """从 User-Agent 解析 (client_name, os_name)。简单解析，不依赖库。"""
    import re
    # 浏览器（顺序重要：Edge 含 Chrome 字样，Chrome 含 Safari 字样）
    client = "Unknown"
    if "Edg/" in ua:
        client = "Edge"
    elif "Chrome/" in ua and "Chromium" not in ua:
        client = "Chrome"
    elif "Firefox/" in ua:
        client = "Firefox"
    elif "Safari/" in ua and "Chrome" not in ua:
        client = "Safari"
    m = re.search(r"(?:Chrome|Firefox|Version|Edg)/(\d+)", ua)
    ver = m.group(1) if m else ""
    client_name = f"{client} {ver}" if ver else client
    # OS
    os_name = "Unknown"
    if "Windows" in ua:
        os_name = "Windows"
    elif "Android" in ua:
        os_name = "Android"
    elif "iPhone" in ua or "iPad" in ua:
        os_name = "iOS"
    elif "Mac OS" in ua or "Macintosh" in ua:
        os_name = "macOS"
    elif "Linux" in ua:
        os_name = "Linux"
    return client_name, os_name


def _client_ip(request: Request) -> str:
    """最后认证 IP（X-Forwarded-For / X-Real-IP / client.host）。"""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    xri = request.headers.get("X-Real-IP", "")
    if xri:
        return xri
    return request.client.host if request.client else ""


def _device_info(d: UserDevice, current_device_id: Optional[UUID] = None) -> DeviceInfo:
    return DeviceInfo(
        id=str(d.id),
        device_name=d.device_name,
        device_wrapped=d.device_wrapped,
        client_name=d.client_name,
        os_name=d.os_name,
        last_auth_ip=d.last_auth_ip,
        last_active_at=d.last_active_at.isoformat() if d.last_active_at else None,
        created_at=d.created_at.isoformat() if d.created_at else None,
        is_revoked=d.is_revoked,
        is_current=(current_device_id == d.id),
    )


async def _resolve_device(
    db: AsyncSession, user_id: UUID,
    device_id_str: Optional[str], device_name: Optional[str],
    request: Request,
) -> UUID:
    """登录后建/关联 device。同设备（device_id 有）验未 revoked + 更新 last_active_at + client_info；
    新设备建 UserDevice（client_name/os_name/last_auth_ip 从 User-Agent + IP 解析）。"""
    client_name, os_name = _parse_user_agent(request.headers.get("User-Agent", ""))
    ip = _client_ip(request)
    if device_id_str:
        try:
            device_id = UUID(device_id_str)
        except (ValueError, TypeError):
            device_id = None
        if device_id:
            result = await db.execute(
                select(UserDevice).where(UserDevice.id == device_id, UserDevice.user_id == user_id)
            )
            device = result.scalar_one_or_none()
            if device and not device.is_revoked:
                device.last_active_at = datetime.now(timezone.utc)
                device.client_name = client_name
                device.os_name = os_name
                device.last_auth_ip = ip
                await db.flush()
                return device.id
    # 新设备：建 UserDevice（device_public_key/device_wrapped 占位，deauthorize 用 device_id）
    device = UserDevice(
        user_id=user_id,
        device_name=device_name,
        device_public_key="web",
        device_wrapped="web",
        client_name=client_name,
        os_name=os_name,
        last_auth_ip=ip,
    )
    db.add(device)
    await db.flush()
    return device.id


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
    digest = hmac.new(settings.jwt_secret_key.encode(), target.encode(), hashlib.sha256).digest()
    return {
        "srp_salt": digest[:16].hex(),                          # hex(16字节)=32 字符，与真实 srp_salt 格式一致（防枚举）
        "local_salt": base64.b64encode(digest).decode(),        # base64(32字节)=44 字符，与真实一致
        "kdf_settings": DEFAULT_KDF_SETTINGS,
        "mnemonic_salt": base64.b64encode(digest).decode(),
        "N": hex(SRP_N)[2:],
        "g": str(SRP_G),
    }


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

    await clear_login_failures("email", req.email)

    client_name, os_name = _parse_user_agent(request.headers.get("User-Agent", ""))
    user, device_id = await create_user_with_keys(db=db, email=req.email, phone=None, google_id=None,
        srp_verifier=req.srp_verifier, srp_salt=req.srp_salt, local_salt=req.local_salt,
        encrypted_user_key=req.encrypted_user_key, mnemonic_salt=req.mnemonic_salt,
        kdf_settings=req.kdf_settings,
        device_name=req.device_name, device_public_key=req.device_public_key, device_wrapped=req.device_wrapped,
        client_name=client_name, os_name=os_name, last_auth_ip=_client_ip(request))
    access_token = create_access_token(user.id, device_id)
    refresh_token = await create_refresh_token(db, user.id, device_id)
    return RegisterResponse(user_id=str(user.id), access_token=access_token, refresh_token=refresh_token, device_id=str(device_id))


@router.post("/register/phone", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_phone(req: RegisterPhoneRequest, request: Request, db: AsyncSession = Depends(get_db)):
    if not await verify_and_consume("phone", req.phone, req.verification_code):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "verification_code_invalid"))
    existing = await find_user_by_phone(db, req.phone)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_t(request, "phone_already_registered"))

    await clear_login_failures("phone", req.phone)

    client_name, os_name = _parse_user_agent(request.headers.get("User-Agent", ""))
    user, device_id = await create_user_with_keys(db=db, email=None, phone=req.phone, google_id=None,
        srp_verifier=req.srp_verifier, srp_salt=req.srp_salt, local_salt=req.local_salt,
        encrypted_user_key=req.encrypted_user_key, mnemonic_salt=req.mnemonic_salt,
        kdf_settings=req.kdf_settings,
        device_name=req.device_name, device_public_key=req.device_public_key, device_wrapped=req.device_wrapped,
        client_name=client_name, os_name=os_name, last_auth_ip=_client_ip(request))
    access_token = create_access_token(user.id, device_id)
    refresh_token = await create_refresh_token(db, user.id, device_id)
    return RegisterResponse(user_id=str(user.id), access_token=access_token, refresh_token=refresh_token, device_id=str(device_id))


@router.post("/register/google", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
async def register_google(req: RegisterGoogleRequest, request: Request, db: AsyncSession = Depends(get_db)):
    google_id = await verify_google_id_token(req.google_id_token)
    if not google_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=_t(request, "google_token_invalid"))
    existing = await find_user_by_google_id(db, google_id)
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_t(request, "google_already_registered"))

    client_name, os_name = _parse_user_agent(request.headers.get("User-Agent", ""))
    user, device_id = await create_user_with_keys(db=db, email=None, phone=None, google_id=google_id,
        srp_verifier=req.srp_verifier, srp_salt=req.srp_salt, local_salt=req.local_salt,
        encrypted_user_key=req.encrypted_user_key, mnemonic_salt=req.mnemonic_salt,
        kdf_settings=req.kdf_settings,
        device_name=req.device_name, device_public_key=req.device_public_key, device_wrapped=req.device_wrapped,
        client_name=client_name, os_name=os_name, last_auth_ip=_client_ip(request))
    access_token = create_access_token(user.id, device_id)
    refresh_token = await create_refresh_token(db, user.id, device_id)
    return RegisterResponse(user_id=str(user.id), access_token=access_token, refresh_token=refresh_token, device_id=str(device_id))


# ── 登录（SRP-6a 两步 + device 绑定）──────────

async def _build_login_response(db: AsyncSession, user, M2: str = "", device_id: Optional[UUID] = None) -> LoginResponse:
    """构建登录响应。token 绑 device_id；SRP 登录传 M2，Google 登录无 M2。"""
    access_token = create_access_token(user.id, device_id)
    refresh_token = await create_refresh_token(db, user.id, device_id)
    keys = await get_user_keys(db, user.id)
    devices = await get_user_devices(db, user.id)
    return LoginResponse(
        user_id=str(user.id),
        access_token=access_token, refresh_token=refresh_token,
        local_salt=user.local_salt or "",
        encrypted_user_key=keys.encrypted_user_key if keys else "",
        mnemonic_salt=keys.mnemonic_salt if keys else "",
        M2=M2,
        device_id=str(device_id) if device_id else "",
        devices=[_device_info(d, device_id) for d in devices],
    )


@router.post("/login/srp/challenge", response_model=SRPChallengeResponse)
async def login_srp_challenge(req: SRPChallengeRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """SRP 第一步：客户端发 A，服务端返回 B + session_id（存 b/v/A/device 到 Redis）。"""
    wait = await get_login_wait(req.target_type, req.target)
    if wait > 0:
        await record_login_failure(req.target_type, req.target)
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=_t(request, "login_rate_limited", seconds=wait))

    if req.target_type == "email":
        user = await find_user_by_email(db, req.target)
    else:
        user = await find_user_by_phone(db, req.target)

    # 同设备登录：device_id 有则验 UserDevice 未 revoked
    if user and req.device_id:
        try:
            did = UUID(req.device_id)
            result = await db.execute(
                select(UserDevice).where(UserDevice.id == did, UserDevice.user_id == user.id)
            )
            device = result.scalar_one_or_none()
            if device and device.is_revoked:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, "device_revoked"))
        except (ValueError, TypeError):
            pass

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
        device_id=req.device_id, device_name=req.device_name,
    )
    return SRPChallengeResponse(session_id=session_id, B=hex(B)[2:])


@router.post("/login/srp/verify", response_model=LoginResponse)
async def login_srp_verify(req: SRPVerifyRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """SRP 第二步：客户端发 M1，服务端验证后返回 M2 + token（绑 device_id）。"""
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
    device_id_str = session.get("device_id")
    device_name = session.get("device_name")

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
    device_id = await _resolve_device(db, UUID(user_id), device_id_str, device_name, request)
    await db.commit()
    await store_session_key(device_id, K.hex())  # 存 SRP 会话密钥 K（通信加密，TTL=session 级 30 天，login 存 logout 清）
    M2 = compute_M2(A, client_M1, K).hex()
    return await _build_login_response(db, user, M2=M2, device_id=device_id)


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
    device_id = await _resolve_device(db, user.id, req.device_id, req.device_name, request)
    await db.commit()
    return await _build_login_response(db, user, device_id=device_id)


# ── 改主密码 ───────────────────────────────────────
# 旧主密码由前置 SRP 登录验证（fresh token），此端点只验 fresh token + 验证码。

@router.post("/change-password", response_model=ChangePasswordResponse)
async def change_password(
    req: ChangePasswordRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """改主密码：主密码参与 K 派生，更新 encrypted_user_key + srp_verifier/srp_salt/local_salt。
    新 token 继承当前 device_id。"""
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_t(request, "user_not_found"))

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
    # 清其他设备 session_key（让 B 等 K 不存 -> 401 -> 重登 RecoveryPage；当前 device 保留继续用）
    device_id = await get_current_device_id(request)
    if device_id:
        result = await db.execute(
            select(UserDevice.id).where(UserDevice.user_id == user.id, UserDevice.id != device_id)
        )
    else:
        result = await db.execute(select(UserDevice.id).where(UserDevice.user_id == user.id))
    for (did,) in result.fetchall():
        await delete_session_key(did)
    await db.commit()

    background_tasks.add_task(send_recovery_alert, user, "password_changed")  # 异步发通知，不阻塞响应（SMTP 慢）

    access_token = create_access_token(user.id, device_id)
    refresh_token = await create_refresh_token(db, user.id, device_id)
    return ChangePasswordResponse(success=True, access_token=access_token, refresh_token=refresh_token)


# ── Token 刷新 ─────────────────────────────────────

@router.post("/refresh-token", response_model=RefreshTokenResponse)
async def refresh_token(req: RefreshTokenRequest, request: Request, db: AsyncSession = Depends(get_db)):
    result = await verify_and_rotate_refresh_token(db, req.refresh_token)
    if result is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_t(request, "refresh_token_invalid"))
    new_access, new_refresh, _, device_id = result
    if device_id:
        await renew_session_key(device_id)  # 续 K TTL（保持 session 连续）
    return RefreshTokenResponse(access_token=new_access, refresh_token=new_refresh)


# ── 登出 ──────────────────────────────────────────

@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(user_id: UUID = Depends(get_current_user_id), db: AsyncSession = Depends(get_db)):
    await revoke_all_user_tokens(db, user_id)
    # 清该用户所有 device 的 session_key（session 终点，对称撤销 token；重登须重 SRP login 重建 K）
    result = await db.execute(select(UserDevice.id).where(UserDevice.user_id == user_id))
    for (device_id,) in result.fetchall():
        await delete_session_key(device_id)
    await db.commit()


# ── 设备管理 ─────────────────────────────────────

@router.get("/devices", response_model=List[DeviceInfo])
async def list_devices(
    request: Request,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """当前用户的所有设备列表（含 is_revoked / is_current）。"""
    current = await get_current_device_id(request)
    devices = await get_user_devices(db, user_id)
    return [_device_info(d, current) for d in devices]


@router.delete("/devices/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deauthorize_device(
    device_id: UUID,
    request: Request,
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """撤销某设备：标记 is_revoked + 删该 device TokenFamily + Redis 标记（access 立即失效）。"""
    result = await db.execute(
        select(UserDevice).where(UserDevice.id == device_id, UserDevice.user_id == user_id)
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_t(request, "device_not_found"))
    if device.is_revoked:
        return  # 幂等
    device.is_revoked = True
    device.revoked_at = datetime.now(timezone.utc)
    await revoke_device_tokens(db, device.id)
    await db.commit()
    await mark_device_revoked(device.id)  # Redis 标记（access 立即失效，TTL = access 有效期）


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
