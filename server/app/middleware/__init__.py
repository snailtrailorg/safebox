"""JWT 认证中间件。"""

from typing import Optional
from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt as jwt_lib
from jwt import InvalidTokenError

from app.config import settings
from app.i18n import get_lang, get_text
from app.services.verification_service import is_device_revoked

security = HTTPBearer()


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    request: Request = None,
) -> UUID:
    """从 Authorization: Bearer <token> 中解析当前用户 ID。仅接受 type="access" 的 token。

    若 token 绑 device_id，检查设备是否已撤销（deauthorize 后立即失效）。
    device_id 存 request.state 供端点取用。
    """
    lang = get_lang(request.headers.get("Accept-Language")) if request else "en"
    token = credentials.credentials
    try:
        payload = jwt_lib.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "access":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=get_text("invalid_token", lang))
        user_id: Optional[str] = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=get_text("invalid_token", lang))
        device_id_str: Optional[str] = payload.get("device_id")
        device_id = UUID(device_id_str) if device_id_str else None
        if device_id:
            if await is_device_revoked(device_id):
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=get_text("device_revoked", lang))
            if request:
                request.state.device_id = device_id
        return UUID(user_id)
    except (InvalidTokenError, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=get_text("invalid_token", lang))


async def get_current_device_id(request: Request) -> Optional[UUID]:
    """当前请求的 device_id（token 绑定时）；未绑定返回 None。"""
    return getattr(request.state, "device_id", None)
