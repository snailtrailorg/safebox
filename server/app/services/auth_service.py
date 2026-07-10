"""认证业务逻辑。"""

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

async def find_user_by_email(db: AsyncSession, email: str) -> User | None:
    result = await db.execute(select(User).where(User.email == email))
    return result.scalar_one_or_none()


async def find_user_by_phone(db: AsyncSession, phone: str) -> User | None:
    result = await db.execute(select(User).where(User.phone == phone))
    return result.scalar_one_or_none()


async def find_user_by_google_id(db: AsyncSession, google_id: str) -> User | None:
    result = await db.execute(select(User).where(User.google_id == google_id))
    return result.scalar_one_or_none()


async def get_user_keys(db: AsyncSession, user_id: UUID) -> UserKeys | None:
    result = await db.execute(select(UserKeys).where(UserKeys.user_id == user_id))
    return result.scalar_one_or_none()


async def get_user_devices(db: AsyncSession, user_id: UUID) -> list[UserDevice]:
    result = await db.execute(
        select(UserDevice).where(UserDevice.user_id == user_id).order_by(UserDevice.last_active_at.desc())
    )
    return list(result.scalars().all())


async def create_user_with_keys(
    db: AsyncSession,
    email: str | None,
    phone: str | None,
    google_id: str | None,
    password: str,  # 实际上是客户端派生的 auth_key_hash（PBKDF2 输出），不是原始密码
    client_password_salt: str,
    password_wrapped: str,
    encrypted_private: str,
    rsa_public_key: str,
    device_name: str | None,
    device_public_key: str,
    device_wrapped: str,
    kdf_settings: dict | None = None,
) -> User:
    auth_key_hash = hash_auth_key(password)

    user = User(
        email=email,
        phone=phone,
        google_id=google_id,
        auth_key_hash=auth_key_hash,
        password_salt=client_password_salt,
        kdf_settings=json.dumps(kdf_settings or DEFAULT_KDF_SETTINGS),
    )
    db.add(user)
    await db.flush()

    keys = UserKeys(
        user_id=user.id,
        password_wrapped=password_wrapped,
        encrypted_private=encrypted_private,
        rsa_public_key=rsa_public_key,
    )
    db.add(keys)

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
