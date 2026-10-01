"""认证业务逻辑。"""

from typing import Optional, List
import json
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, UserDevice, UserKeys
from app.services.token_service import (
    create_access_token,
    create_refresh_token,
    verify_and_rotate_refresh_token,
    revoke_all_user_tokens,
)

# 服务端默认 KDF（与前端 DEFAULT_KDF 一致）；注册未指定时落库此值
DEFAULT_KDF_SETTINGS = {"algorithm": "pbkdf2", "iterations": 600_000}

# 允许的 KDF 算法白名单。argon2id 未实现（前端 kdf.ts 会抛错），
# 若落库则账户永久无法解锁 —— 故在入口拦截，只放行 pbkdf2。
ALLOWED_KDF_ALGORITHMS = ("pbkdf2",)
MIN_PBKDF2_ITERATIONS = 100_000  # 防止客户端上传过低迭代数削弱 KDF


def validate_kdf_settings(raw: Optional[dict]) -> dict:
    """校验客户端上传的 kdf_settings；非法则回退默认值（不抛错，避免注册被卡）。

    背景：kdf_settings 由客户端注册时上传并原样落库，是未校验的外部输入。
    若允许 argon2id 落库，前端 deriveKey 会抛 "argon2id KDF not yet supported"，
    该账户之后永久无法派生 K -> 数据不可达。故只放行 pbkdf2。
    """
    if not raw or not isinstance(raw, dict):
        return dict(DEFAULT_KDF_SETTINGS)
    algo = raw.get("algorithm")
    if algo not in ALLOWED_KDF_ALGORITHMS:
        return dict(DEFAULT_KDF_SETTINGS)
    iterations = raw.get("iterations", DEFAULT_KDF_SETTINGS["iterations"])
    if not isinstance(iterations, int) or iterations < MIN_PBKDF2_ITERATIONS:
        return dict(DEFAULT_KDF_SETTINGS)
    return {"algorithm": "pbkdf2", "iterations": iterations}


# ── 用户查询 ────────────────────────────────────────

async def find_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.email == email.lower()))
    return result.scalar_one_or_none()


async def find_user_by_phone(db: AsyncSession, phone: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.phone == phone))
    return result.scalar_one_or_none()


async def get_user_keys(db: AsyncSession, user_id: UUID) -> Optional[UserKeys]:
    result = await db.execute(select(UserKeys).where(UserKeys.user_id == user_id))
    return result.scalar_one_or_none()


async def get_user_devices(db: AsyncSession, user_id: UUID) -> List[UserDevice]:
    result = await db.execute(
        select(UserDevice).where(UserDevice.user_id == user_id).order_by(UserDevice.last_active_at.desc())
    )
    return list(result.scalars().all())


async def create_user_with_keys(
    db: AsyncSession,
    email: Optional[str],
    phone: Optional[str],
    google_id: Optional[str],
    srp_verifier: str,                  # SRP-6a verifier v 的 hex（客户端 deriveX + computeVerifier 本地生成）
    srp_salt: str,                      # 2SKD x 派生用盐（hex），客户端生成
    local_salt: str,                    # 本地 cached_K 派生用盐
    kdf_settings: Optional[dict],
    encrypted_user_key: str,            # AES(K, User Key)，K = PBKDF2(助记词+主密码, mnemonic_salt)
    mnemonic_salt: str,                 # K 派生用盐
    device_name: Optional[str] = None,
    device_public_key: str = "web",
    device_wrapped: str = "web",
    client_name: Optional[str] = None,
    os_name: Optional[str] = None,
    last_auth_ip: Optional[str] = None,
) -> User:
    """注册：创建 user + user_keys + device。

    服务端只存 SRP verifier（不存任何密码密文）；助记词不上传，由客户端本地持有/
    加密缓存。encrypted_user_key 用 K 包裹 User Key，K 不在服务器。
    """
    user = User(
        email=email,
        phone=phone,
        google_id=google_id,
        srp_verifier=srp_verifier,
        srp_salt=srp_salt,
        local_salt=local_salt,
        kdf_settings=json.dumps(validate_kdf_settings(kdf_settings)),
    )
    db.add(user)
    await db.flush()

    keys = UserKeys(
        user_id=user.id,
        encrypted_user_key=encrypted_user_key,
        mnemonic_salt=mnemonic_salt,
    )
    db.add(keys)

    device = UserDevice(
        user_id=user.id,
        device_name=device_name,
        device_public_key=device_public_key,
        device_wrapped=device_wrapped,
        client_name=client_name,
        os_name=os_name,
        last_auth_ip=last_auth_ip,
    )
    db.add(device)

    await db.commit()
    await db.refresh(user)
    return user, device.id
