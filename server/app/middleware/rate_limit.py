"""速率限制中间件。

按 IP 或 user_id 做滑动窗口限流，路径规则区分严格/宽松。
- 白名单路径（/health, /docs 等）跳过
- 已认证请求按 user_id 限流，未认证按 IP
- Redis 故障时 fail-open（放行），避免限流故障锁死服务
"""

from typing import Awaitable, Callable, Optional

import jwt as jwt_lib

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.config import settings
from app.i18n import get_text, get_lang
from app.services.verification_service import check_rate_key

# 白名单路径：不限制
WHITELIST_PATHS = ("/health", "/docs", "/openapi.json", "/redoc")

# 路径前缀 -> 限流阈值（覆盖默认的 500/小时）
# 严格端点：登录/注册/助记词 - 100 次/小时
STRICT_PREFIXES = ("/api/v1/auth/login", "/api/v1/auth/register", "/api/v1/auth/recovery")
STRICT_MAX = 100


def _client_ip(request: Request) -> str:
    """提取客户端真实 IP。

    策略与 api/auth._client_ip 保持一致（保守）：
    - 仅当直连来自可信代理（trusted_proxies）时才采纳 X-Real-IP
    - **不采信 X-Forwarded-For**：其最左端由客户端完全控制（客户端可自带
      `X-Forwarded-For: 1.2.3.4`，反代默认 append 到右侧），取最左等价采信伪造值，
      攻击者可借此让每次请求落在不同限流桶，绕过 IP 限流。
    - 非可信直连一律用 request.client.host

    注：trusted_proxies 为空时（默认），所有请求按直连 IP 处理。反代部署下这会
    退化为同一 IP 单桶 -> 需在部署时显式配置 trusted_proxies（见 DEPLOY.md）。
    """
    direct = request.client.host if request.client else ""
    trusted = [p.strip() for p in settings.trusted_proxies.split(",") if p.strip()]
    if direct in trusted:
        return request.headers.get("x-real-ip") or direct
    return direct


def _extract_user_id(request: Request) -> Optional[str]:
    """从 Authorization Bearer token 解析 user_id。

    **验签**：早期版本只解码 payload 不验签，导致伪造 sub 可把限流计数打到他人账号
    （把受害者打成 429）或每次换 sub 规避自身 IP 限流。现改为验签后再取 sub；
    验签失败则返回 None -> 退回按 IP 限流（宁可限 IP，不可信伪造身份）。
    """
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        return None
    token = auth[7:]
    try:
        payload = jwt_lib.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
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
            # 按 Accept-Language 翻译（早期硬编码英文，中文用户看到英文提示）
            lang = get_lang(request.headers.get("Accept-Language"))
            return JSONResponse(
                status_code=429,
                content={"detail": get_text("too_many_requests", lang)},
                headers={"Retry-After": "3600"},
            )

        return await call_next(request)
