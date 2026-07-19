"""认证业务逻辑。"""

from typing import Optional, List
import json
from uuid import UUID

import bcrypt
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


def hash_auth_key(client_hash: str) -> str:
    return bcrypt.hashpw(client_hash.encode(), bcrypt.gensalt()).decode()


def verify_auth_key(client_hash: str, stored_hash: str) -> bool:
    return bcrypt.checkpw(client_hash.encode(), stored_hash.encode())


# ── 用户查询 ────────────────────────────────────────

async def find_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def find_user_by_phone(db: AsyncSession, phone: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.phone == phone))
    return result.scalar_one_or_none()


async def find_user_by_google_id(db: AsyncSession, google_id: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.google_id == google_id))
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
    local_password_hash: str,          # 客户端 PBKDF2 派生的 authKey（base64），服务端再 bcrypt
    local_salt: str,             # 本地密码派生用盐
    kdf_settings: Optional[dict],
    encrypted_user_key: str,     # AES(K, User Key)，K = PBKDF2(助记词[+Passphrase], mnemonic_salt)
    mnemonic_salt: str,          # K 派生用盐
    has_passphrase: bool,
    mnemonic_hash: str,    # HMAC(server_key, salt+mnemonic)
    mnemonic_hmac_salt: str,    # HMAC 验码用盐
    device_name: Optional[str] = None,
    device_public_key: str = "web",
    device_wrapped: str = "web",
) -> User:
    """模型 D 注册：创建 user + user_keys + mnemonic + device。

    服务端不存任何密码密文（无 password_wrapped）。
    encrypted_user_key 用 K 包裹 User Key，K 不在服务器。
    """
    hashed_auth_key = hash_auth_key(local_password_hash)

    user = User(
        email=email,
        phone=phone,
        google_id=google_id,
        local_password_hash=hashed_auth_key,
        local_salt=local_salt,
        kdf_settings=json.dumps(kdf_settings or DEFAULT_KDF_SETTINGS),
        local_password_version=0,
        has_passphrase=has_passphrase,
    )
    db.add(user)
    await db.flush()

    keys = UserKeys(
        user_id=user.id,
        encrypted_user_key=encrypted_user_key,
        mnemonic_salt=mnemonic_salt,
    )
    db.add(keys)

    from app.models.mnemonic import Mnemonic
    rc = Mnemonic(
        user_id=user.id,
        mnemonic_hash=mnemonic_hash,
        mnemonic_hmac_salt=mnemonic_hmac_salt,
        status="active",
    )
    db.add(rc)

    device = UserDevice(
        user_id=user.id,
        device_name=device_name,
        device_public_key=device_public_key,
        device_wrapped=device_wrapped,
    )
    db.add(device)

    await db.commit()
    await db.refresh(user)
    return user
