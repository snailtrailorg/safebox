"""Token 服务：JWT 创建、refresh rotation、撤销。"""

import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import jwt
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import TokenFamily


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
    # Use hmac.compare_digest (not !=) to avoid timing side-channel attacks.
    # The token hash is only reachable after JWT signature verification,
    # but this is a defense-in-depth measure.
    if not hmac.compare_digest(entry.active_token_hash, _token_hash(token)):
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