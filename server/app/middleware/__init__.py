"""JWT 认证中间件。"""

from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt as jwt_lib
from jwt import InvalidTokenError

from app.config import settings
from app.i18n import get_lang, get_text

security = HTTPBearer()


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    request: Request = None,  # type: ignore[assignment]
) -> UUID:
    """从 Authorization: Bearer <token> 中解析当前用户 ID。"""
    lang = get_lang(request.headers.get("Accept-Language")) if request else "en"
    token = credentials.credentials
    try:
        payload = jwt_lib.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=get_text("invalid_token", lang))
        return UUID(user_id)
    except InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=get_text("invalid_token", lang))
