"""JWT 认证中间件。"""

from uuid import UUID

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
import jwt as jwt_lib
from jwt import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db
from app.i18n import get_lang, get_text

security = HTTPBearer()


async def get_current_user_id(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    request: Request = None,
) -> UUID:
    """从 Authorization: Bearer <token> 中解析当前用户 ID。仅接受 type="access" 的 token。

    注意：此处不查冷却状态（避免每请求 DB 查询）。需冷却门控的端点另挂 require_not_in_cooldown。
    """
    lang = get_lang(request.headers.get("Accept-Language")) if request else "en"
    token = credentials.credentials
    try:
        payload = jwt_lib.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        if payload.get("type") != "access":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=get_text("invalid_token", lang))
        user_id: str | None = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=get_text("invalid_token", lang))
        return UUID(user_id)
    except InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=get_text("invalid_token", lang))


async def require_not_in_cooldown(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
) -> UUID:
    """冷却门（D）：恢复冷却期内拒绝所有数据访问/账户操作（零窗口，不等 access token 过期）。

    status（只读）不挂此依赖（放行，供用户自查冷却状态）；
    accelerate/freeze 用签名 token，不走 get_current_user_id，天然豁免。
    """
    from app.services.recovery_service import is_in_cooldown
    if await is_in_cooldown(db, user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=get_text("account_in_cooldown", "en"))
    return user_id
