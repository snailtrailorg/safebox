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


def _login_fail_key(target: str, value: str) -> str:
    return f"loginfail:{target}:{value}"


def generate_code() -> str:
    """生成 6 位数字验证码。"""
    return "".join(secrets.choice("0123456789") for _ in range(settings.verification_code_length))


async def store_code(target: str, value: str, code: str) -> None:
    """存储验证码到 Redis，带过期时间。"""
    r = await _get_redis()
    key = _redis_key(target, value)
    await r.setex(key, timedelta(seconds=settings.verification_code_expire_seconds), code)


async def verify_and_consume(target: str, value: str, code: str) -> bool:
    """验证验证码，验证成功后删除。使用 GETDEL 避免 TOCTOU 竞态。"""
    r = await _get_redis()
    key = _redis_key(target, value)
    try:
        stored = await r.getdel(key)
    except AttributeError:
        stored = await r.get(key)
        if stored is not None and stored == code:
            await r.delete(key)
            return True
        return False
    return stored is not None and stored == code


async def check_rate_limit(target: str, value: str) -> bool:
    """检查发送频率限制。返回 True 表示可以发送。使用 SET NX 避免 TOCTOU。"""
    r = await _get_redis()
    key = _rate_limit_key(target, value)
    ok = await r.set(key, "1", nx=True, ex=settings.verification_code_rate_limit_seconds)
    return bool(ok)


# ── 登录频率限制（指数退避）──────────────────────────

LOGIN_LOCKOUT_SECONDS = 3600  # 5 次失败后锁定 1 小时


async def check_login_rate_limit(target: str, value: str) -> int:
    """检查登录频率限制。返回还需等待的秒数，0 表示可以尝试。"""
    r = await _get_redis()
    key = _login_fail_key(target, value)
    count_str = await r.get(key)
    count = int(count_str) if count_str else 0

    if count == 0:
        return 0
    if count >= 5:
        return LOGIN_LOCKOUT_SECONDS
    # 指数退避: 1, 2, 4, 8 秒
    return 1 << (count - 1)


async def record_login_failure(target: str, value: str) -> int:
    """记录一次登录失败，返回当前失败次数。"""
    r = await _get_redis()
    key = _login_fail_key(target, value)
    count = await r.incr(key)
    # 第一次失败时设置 1 小时过期
    if count == 1:
        await r.expire(key, LOGIN_LOCKOUT_SECONDS)
    return count


async def clear_login_failures(target: str, value: str) -> None:
    """登录成功后清除失败记录。"""
    r = await _get_redis()
    key = _login_fail_key(target, value)
    await r.delete(key)
