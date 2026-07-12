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
    auth_key_hash: str,          # 客户端 PBKDF2 派生的 authKey（base64），服务端再 bcrypt
    login_salt: str,             # 登录密码派生用盐
    kdf_settings: Optional[dict],
    encrypted_user_key: str,     # AES(K, User Key)，K = PBKDF2(恢复码[+主密码], recovery_salt)
    recovery_salt: str,          # K 派生用盐
    has_master_password: bool,
    recovery_code_hash: str,    # HMAC(server_key, salt+mnemonic)
    recovery_code_salt: str,    # HMAC 验码用盐
    device_name: Optional[str] = None,
    device_public_key: str = "web",
    device_wrapped: str = "web",
) -> User:
    """模型 D 注册：创建 user + user_keys + recovery_code + device。

    服务端不存任何密码密文（无 password_wrapped）。
    encrypted_user_key 用 K 包裹 User Key，K 不在服务器。
    """
    hashed_auth_key = hash_auth_key(auth_key_hash)

    user = User(
        email=email,
        phone=phone,
        google_id=google_id,
        auth_key_hash=hashed_auth_key,
        login_salt=login_salt,
        kdf_settings=json.dumps(kdf_settings or DEFAULT_KDF_SETTINGS),
        password_version=0,
        has_master_password=has_master_password,
    )
    db.add(user)
    await db.flush()

    keys = UserKeys(
        user_id=user.id,
        encrypted_user_key=encrypted_user_key,
        recovery_salt=recovery_salt,
    )
    db.add(keys)

    from app.models.recovery_code import RecoveryCode
    rc = RecoveryCode(
        user_id=user.id,
        recovery_code_hash=recovery_code_hash,
        recovery_code_salt=recovery_code_salt,
        status="active",
        failed_attempt_count=0,
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
