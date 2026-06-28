"""认证业务逻辑。"""

import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from jose import jwt
from passlib.hash import bcrypt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Item, User, UserDevice, UserKeys


def hash_password(client_hash: str) -> str:
    """对客户端 PBKDF2 hash 再做 bcrypt。

    客户端已做 PBKDF2(password, client_salt, 100k) → client_hash。
    服务端 bcrypt(client_hash) → 存数据库。两层哈希防止数据库泄露后离线暴力破解。
    """
    return bcrypt.hash(client_hash)


def verify_password(client_hash: str, stored_bcrypt: str) -> bool:
    """验证客户端 hash 与服务端 bcrypt 是否匹配。"""
    return bcrypt.verify(client_hash, stored_bcrypt)


def create_access_token(user_id: UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire, "type": "access"},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def create_refresh_token(user_id: UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire, "type": "refresh"},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_refresh_token(token: str) -> UUID | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "refresh":
            return None
        return UUID(payload["sub"])
    except Exception:
        return None


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
    password: str,
    client_password_salt: str,
    password_wrapped: str,
    recovery_wrapped: str,
    encrypted_private: str,
    rsa_public_key: str,
    device_name: str | None,
    device_public_key: str,
    device_wrapped: str,
) -> User:
    # 客户端 PBKDF2 hash → 服务端 bcrypt 再套一层
    password_hash = hash_password(password)

    user = User(
        email=email,
        phone=phone,
        google_id=google_id,
        password_hash=password_hash,
        password_salt=client_password_salt,
    )
    db.add(user)
    await db.flush()

    keys = UserKeys(
        user_id=user.id,
        password_wrapped=password_wrapped,
        recovery_wrapped=recovery_wrapped,
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
