"""速率限制中间件。

按 IP 或 user_id 做滑动窗口限流，路径规则区分严格/宽松。
- 白名单路径（/health, /docs 等）跳过
- 已认证请求按 user_id 限流，未认证按 IP
- Redis 故障时 fail-open（放行），避免限流故障锁死服务
"""

import base64
import json
from typing import Awaitable, Callable, Optional

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.config import settings
from app.services.verification_service import check_rate_key

# 白名单路径：不限制
WHITELIST_PATHS = ("/health", "/docs", "/openapi.json", "/redoc")

# 路径前缀 -> 限流阈值（覆盖默认的 500/小时）
# 严格端点：登录/注册/恢复码 - 100 次/小时
STRICT_PREFIXES = ("/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/recovery")
STRICT_MAX = 100


def _client_ip(request: Request) -> str:
    """提取客户端真实 IP。

    仅当直连来自可信代理（trusted_proxies）时才采纳 X-Forwarded-For/X-Real-IP，
    防止客户端伪造头绕过 IP 限流。非可信直连用 request.client.host。
    """
    direct = request.client.host if request.client else ""
    trusted = [p.strip() for p in settings.trusted_proxies.split(",") if p.strip()]
    if direct in trusted:
        # 可信代理：取 X-Forwarded-For 最左侧（最原始客户端），回退 X-Real-IP
        xff = request.headers.get("x-forwarded-for", "")
        if xff:
            return xff.split(",")[0].strip()
        return request.headers.get("x-real-ip") or direct
    return direct


def _extract_user_id(request: Request) -> Optional[str]:
    """从 Authorization Bearer token 解析 user_id（仅解码 payload，不验签）。"""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    parts = token.split(".")
    if len(parts) != 3:
        return None
    try:
        # JWT payload 是 base64url，补齐 padding 后解码
        payload_b64 = parts[1] + "=" * (-len(parts[1]) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        sub = payload.get("sub")
        return str(sub) if sub else None
    except Exception:
        return None


def _is_whitelisted(path: str) -> bool:
    return any(path == p or path.startswith(p + "/") for p in WHITELIST_PATHS)


def _rate_limit_for(path: str) -> tuple[str, int]:
    """返回 (key_prefix, max_count)。"""
    if any(path.startswith(p) for p in STRICT_PREFIXES):
        return "strict", STRICT_MAX
    return "default", 0  # 0 表示用 check_rate_key 默认值


class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        path = request.url.path
        if _is_whitelisted(path):
            return await call_next(request)

        # 限流 key：已认证用 user_id，否则用 IP
        user_id = _extract_user_id(request)
        key = f"userrate:{user_id}" if user_id else f"iprate:{_client_ip(request)}"

        _, max_count = _rate_limit_for(path)
        try:
            if max_count > 0:
                limited = await check_rate_key(key, max_count=max_count)
            else:
                limited = await check_rate_key(key)
        except Exception:
            # Redis 故障：fail-open，放行请求
            return await call_next(request)

        if limited:
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."},
                headers={"Retry-After": "3600"},
            )

        return await call_next(request)
