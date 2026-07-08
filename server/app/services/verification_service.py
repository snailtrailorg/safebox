"""验证码服务：生成、存储（Redis）、验证。"""

import secrets
import time
import uuid
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
    stored = await r.getdel(key)
    return stored is not None and stored == code


async def check_rate_limit(target: str, value: str) -> bool:
    """检查发送频率限制。返回 True 表示可以发送。使用 SET NX 避免 TOCTOU。"""
    r = await _get_redis()
    key = _rate_limit_key(target, value)
    ok = await r.set(key, "1", nx=True, ex=settings.verification_code_rate_limit_seconds)
    return bool(ok)


# ── 登录频率限制（指数退避）──────────────────────────

LOGIN_LOCKOUT_SECONDS = 3600  # 5 次失败后锁定 1 小时
LOGIN_RATE_LIMIT_DISABLED = 0  # 设为 0 可关闭限流（调试用）


async def get_login_wait(target: str, value: str) -> int:
    """只读检查当前登录等待秒数。0=可尝试，不修改计数。

    第 1 次不限制，后续指数退避（1,2,4,8 秒），第 5 次锁定 1 小时。
    """
    r = await _get_redis()
    key = _login_fail_key(target, value)
    count = await r.get(key)
    if count is None:
        return 0
    count = int(count)
    if count >= 5:
        return LOGIN_LOCKOUT_SECONDS
    if count >= 2:
        return 1 << (count - 2)
    return 0


async def record_login_failure(target: str, value: str) -> None:
    """登录验证失败后记录一次失败。"""
    r = await _get_redis()
    key = _login_fail_key(target, value)
    count = await r.incr(key)
    if count == 1:
        await r.expire(key, LOGIN_LOCKOUT_SECONDS)


async def clear_login_failures(target: str, value: str) -> None:
    """登录成功后清除失败记录。"""
    r = await _get_redis()
    key = _login_fail_key(target, value)
    await r.delete(key)


# ── IP 频率限制（滑动窗口）─────────────────────────────

IP_RATE_WINDOW = 3600       # 滑动窗口 1 小时
IP_RATE_LIMIT_MAX = 500     # 单 IP 每小时最多请求次数


async def check_ip_rate(ip: str) -> bool:
    """检查 IP 请求频率。滑动窗口 1 小时，超限返回 True（拒绝本次请求）。

    每个请求：移走窗口外旧记录 → ZCARD 检查当前计数 → ZADD 记录本次。
    EXPIRE 兜底回收：IP 停止请求后 1 小时 key 自动消失。
    """
    if not ip:
        return False
    return await check_rate_key(f"iprate:{ip}")


async def check_rate_key(key: str, window: int = IP_RATE_WINDOW, max_count: int = IP_RATE_LIMIT_MAX) -> bool:
    """通用滑动窗口限流。超限返回 True（拒绝）。供中间件使用。"""
    if not key:
        return False
    r = await _get_redis()
    now = time.time()
    await r.zremrangebyscore(key, 0, now - window)
    count = await r.zcard(key)
    if count >= max_count:
        return True
    await r.zadd(key, {str(uuid.uuid4()): now})
    await r.expire(key, window)
    return False
