"""验证码服务：生成、存储（Redis）、验证。"""

import secrets
from datetime import timedelta

import redis.asyncio as aioredis

from app.config import settings

# Redis 连接（懒初始化）
_redis: aioredis.Redis | None = None


async def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, encoding="utf-8", decode_responses=True)
    return _redis


def _redis_key(target: str, value: str) -> str:
    return f"vc:{target}:{value}"


def _rate_limit_key(target: str, value: str) -> str:
    return f"vc_rl:{target}:{value}"


def generate_code() -> str:
    """生成 6 位数字验证码。"""
    return "".join(secrets.choice("0123456789") for _ in range(settings.verification_code_length))


async def store_code(target: str, value: str, code: str) -> None:
    """存储验证码到 Redis，带过期时间。"""
    r = await _get_redis()
    key = _redis_key(target, value)
    await r.setex(key, timedelta(seconds=settings.verification_code_expire_seconds), code)


async def verify_and_consume(target: str, value: str, code: str) -> bool:
    """验证验证码，验证成功后删除。"""
    r = await _get_redis()
    key = _redis_key(target, value)
    stored = await r.get(key)
    if stored is not None and stored == code:
        await r.delete(key)
        return True
    return False


async def check_rate_limit(target: str, value: str) -> bool:
    """检查发送频率限制。返回 True 表示可以发送。"""
    r = await _get_redis()
    key = _rate_limit_key(target, value)
    exists = await r.exists(key)
    if exists:
        return False
    await r.setex(key, timedelta(seconds=settings.verification_code_rate_limit_seconds), "1")
    return True
