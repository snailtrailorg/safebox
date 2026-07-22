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
        kdf_settings=json.dumps(kdf_settings or DEFAULT_KDF_SETTINGS),
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
