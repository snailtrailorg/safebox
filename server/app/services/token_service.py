"""Token 服务：JWT 创建、refresh rotation、撤销。

refresh token 设计：
  - 一个 family = 一次登录会话；同一会话内轮换复用该 family。
  - 轮换：同 family 派生新 token（新 jti），更新 active_token_hash，旧 token 立即失效。
  - 重放检测：family 仍在但提交的 token hash 不匹配 -> 撤销该用户全部 family（全线失效）。
  - token 绑 device_id：access/refresh 含 device_id claim，TokenFamily 绑 device_id（按 device 撤销）。
"""

from typing import Optional
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import jwt
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import TokenFamily


FRESH_TOKEN_WINDOW = timedelta(minutes=5)  # fresh token 新鲜窗口（改密/删号须 5min 内，防盗用旧 access）


def create_access_token(user_id: UUID, device_id: Optional[UUID] = None) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(minutes=settings.access_token_expire_minutes)
    payload: dict = {"sub": str(user_id), "exp": expire, "type": "access", "iat": now}
    if device_id:
        payload["device_id"] = str(device_id)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def is_fresh_token(iat) -> bool:
    """校验 token iat 是否在 fresh 窗口内（改密/删号要求 fresh token，防 XSS 盗旧 access 改密）。"""
    if not iat:
        return False  # 旧 token 无 iat -> 非新鲜
    return datetime.now(timezone.utc) - datetime.fromtimestamp(iat, timezone.utc) < FRESH_TOKEN_WINDOW


# ── Refresh Token Family ──────────────────────────


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _encode_refresh_token(user_id: UUID, family: str, device_id: Optional[UUID] = None) -> str:
    """签发 refresh token：复用给定 family，jti 随机使每个 token 唯一。"""
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    payload: dict = {
        "sub": str(user_id),
        "exp": expire,
        "type": "refresh",
        "family": family,
        "jti": uuid4().hex,
    }
    if device_id:
        payload["device_id"] = str(device_id)
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


async def create_refresh_token(db: AsyncSession, user_id: UUID, device_id: Optional[UUID] = None) -> str:
    """新登录会话：创建新 family 并写入活跃 token hash（绑 device_id）。"""
    family = str(uuid4())
    token = _encode_refresh_token(user_id, family, device_id)
    entry = TokenFamily(user_id=user_id, family=family, active_token_hash=_token_hash(token), device_id=device_id)
    db.add(entry)
    await db.flush()
    return token


def _decode_refresh_token_payload(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "refresh":
            return None
        return payload
    except jwt.InvalidTokenError:
        return None


async def verify_and_rotate_refresh_token(
    db: AsyncSession, token: str,
) -> Optional[tuple[str, str, UUID, Optional[UUID]]]:
    """验证 refresh token。成功则同 family 轮换（旧 token 失效）。

    - 无 family 字段（旧格式）：拒绝，不降级刷新，避免绕过轮换/重放检测。
    - family 不存在：拒绝（已撤销/过期/级联失效）。
    - family 存在但 hash 不匹配：重放 -> 撤销该用户全部 family（全线失效）。
    - hash 匹配：同 family 派生新 token（继承 device_id），更新 active_token_hash。
    """
    payload = _decode_refresh_token_payload(token)
    if payload is None:
        return None

    user_id = UUID(payload["sub"])
    family: Optional[str] = payload.get("family")
    device_id_str: Optional[str] = payload.get("device_id")
    device_id: Optional[UUID] = UUID(device_id_str) if device_id_str else None

    # 无 family 的 token 一律拒绝
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
    if not hmac.compare_digest(entry.active_token_hash, _token_hash(token)):
        # 重放检测：family 仍在但提交的 token 已非活跃 token
        # -> 撤销该用户全部 family（全线失效），强制全部重新登录
        await db.execute(sa_delete(TokenFamily).where(TokenFamily.user_id == user_id))
        await db.commit()
        return None

    # 正常轮换：同 family 派生新 token（继承 device_id），更新 active_token_hash（旧 token 失效）
    new_access = create_access_token(user_id, device_id)
    new_refresh = _encode_refresh_token(user_id, family, device_id)
    entry.active_token_hash = _token_hash(new_refresh)
    entry.used_at = datetime.now(timezone.utc)
    await db.commit()
    return (new_access, new_refresh, user_id, device_id)


async def revoke_device_tokens(db: AsyncSession, device_id: UUID) -> None:
    """撤销某设备的所有 refresh token family（deauthorize 用）。"""
    await db.execute(sa_delete(TokenFamily).where(TokenFamily.device_id == device_id))
    await db.flush()


async def revoke_all_user_tokens(db: AsyncSession, user_id: UUID) -> None:
    """撤销用户所有 refresh token。"""
    await db.execute(sa_delete(TokenFamily).where(TokenFamily.user_id == user_id))
    await db.flush()
