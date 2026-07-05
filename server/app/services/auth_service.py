"""认证业务逻辑。"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import bcrypt
import jwt
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Item, TokenFamily, User, UserDevice, UserKeys


def hash_password(client_hash: str) -> str:
    return bcrypt.hashpw(client_hash.encode(), bcrypt.gensalt()).decode()


def verify_password(client_hash: str, stored_hash: str) -> bool:
    return bcrypt.checkpw(client_hash.encode(), stored_hash.encode())


def create_access_token(user_id: UUID) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode(
        {"sub": str(user_id), "exp": expire, "type": "access"},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


# ── Refresh Token Family ──────────────────────────


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def create_refresh_token(db: AsyncSession, user_id: UUID) -> str:
    """创建 refresh token 并写入 TokenFamily 表。"""
    family = str(uuid4())
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    token = jwt.encode(
        {"sub": str(user_id), "exp": expire, "type": "refresh", "family": family},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    entry = TokenFamily(user_id=user_id, family=family, active_token_hash=_token_hash(token))
    db.add(entry)
    await db.flush()
    return token


def _decode_refresh_token_payload(token: str) -> dict | None:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "refresh":
            return None
        return payload
    except jwt.InvalidTokenError:
        return None


async def verify_and_rotate_refresh_token(
    db: AsyncSession, token: str,
) -> tuple[str, str, UUID] | None:
    """验证 refresh token。成功则 rotation，检测到重放则全线失效。

    旧 token（无 family 字段）降级刷新并带上 family。
    """
    payload = _decode_refresh_token_payload(token)
    if payload is None:
        return None

    user_id = UUID(payload["sub"])
    family: str | None = payload.get("family")

    # 过渡路径：旧 token 无 family，降级刷新并写入 family
    if not family:
        new_access = create_access_token(user_id)
        new_refresh = await create_refresh_token(db, user_id)
        return (new_access, new_refresh, user_id)

    # 主路径：带 rotation（FOR UPDATE 防止并发竞态）
    result = await db.execute(
        select(TokenFamily).where(TokenFamily.family == family).with_for_update()
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        return None
    if entry.active_token_hash != _token_hash(token):
        await db.execute(sa_delete(TokenFamily).where(TokenFamily.user_id == user_id))
        await db.commit()
        return None

    new_access = create_access_token(user_id)
    new_refresh = await create_refresh_token(db, user_id)
    await db.delete(entry)
    await db.commit()
    return (new_access, new_refresh, user_id)


async def revoke_all_user_tokens(db: AsyncSession, user_id: UUID) -> None:
    """撤销用户所有 refresh token。"""
    await db.execute(sa_delete(TokenFamily).where(TokenFamily.user_id == user_id))
    await db.flush()


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
