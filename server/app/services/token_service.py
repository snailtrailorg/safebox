"""Token 服务：JWT 创建、refresh rotation、撤销。

refresh token 设计（与 CLAUDE.md / FEATURE_LIST 一致）：
  - 一个 family = 一次登录会话；同一会话内轮换复用该 family。
  - 轮换：同 family 派生新 token（新 jti），更新 active_token_hash，旧 token 立即失效。
  - 重放检测：family 仍在但提交的 token hash 不匹配 -> 撤销该用户全部 family（全线失效）。
  - jti 保证同 family 的新旧 token hash 不同，使重放可被检测。
"""

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


def _encode_refresh_token(user_id: UUID, family: str) -> str:
    """签发 refresh token：复用给定 family，jti 随机使每个 token 唯一。"""
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    return jwt.encode(
        {
            "sub": str(user_id),
            "exp": expire,
            "type": "refresh",
            "family": family,
            "jti": uuid4().hex,
        },
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )


async def create_refresh_token(db: AsyncSession, user_id: UUID) -> str:
    """新登录会话：创建新 family 并写入活跃 token hash。"""
    family = str(uuid4())
    token = _encode_refresh_token(user_id, family)
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
    """验证 refresh token。成功则同 family 轮换（旧 token 失效）。

    - 无 family 字段（旧格式）：拒绝（M2），不降级刷新，避免绕过轮换/重放检测。
    - family 不存在：拒绝（已撤销/过期/级联失效）。
    - family 存在但 hash 不匹配：重放 -> 撤销该用户全部 family（全线失效，M1）。
    - hash 匹配：同 family 派生新 token，更新 active_token_hash。
    """
    payload = _decode_refresh_token_payload(token)
    if payload is None:
        return None

    user_id = UUID(payload["sub"])
    family: str | None = payload.get("family")

    # M2：无 family 的 token 一律拒绝
    if not family:
        return None

    # FOR UPDATE 行级锁，防并发竞态
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
        # 重放检测：family 仍在但提交的 token 已非活跃 token
        # -> 有人重放了已轮换的旧 token，全线失效，强制全部重新登录
        await db.execute(sa_delete(TokenFamily).where(TokenFamily.user_id == user_id))
        await db.commit()
        return None

    # 正常轮换：同 family 派生新 token（新 jti），更新 active_token_hash（旧 token 失效）
    new_access = create_access_token(user_id)
    new_refresh = _encode_refresh_token(user_id, family)
    entry.active_token_hash = _token_hash(new_refresh)
    entry.used_at = datetime.now(timezone.utc)
    await db.commit()
    return (new_access, new_refresh, user_id)


async def revoke_all_user_tokens(db: AsyncSession, user_id: UUID) -> None:
    """撤销用户所有 refresh token。"""
    await db.execute(sa_delete(TokenFamily).where(TokenFamily.user_id == user_id))
    await db.flush()
