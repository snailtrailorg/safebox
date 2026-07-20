"""助记词 API：发起恢复（换设备，验助记词返回 encrypted_user_key）。

合并主密码模型：忘主密码 = 数据丢失（无法恢复）。
initiate 用于换设备：验助记词 + 返回 encrypted_user_key，客户端用助记词+主密码派生 K 解密。
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.i18n import get_lang, get_text
from app.services.auth_service import find_user_by_email, find_user_by_phone
from app.services.recovery_service import find_valid_mnemonic, _get_user_keys

router = APIRouter(prefix="/api/v1/auth/recovery", tags=["recovery"])


def _t(request: Request, key: str, **kw: object) -> str:
    lang = get_lang(request.headers.get("Accept-Language"))
    return get_text(key, lang, **kw)


# -- Schemas -----------------------------------------

class InitiateRecoveryRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    mnemonic: str


class InitiateRecoveryResponse(BaseModel):
    encrypted_user_key: str     # 客户端用 K=PBKDF2(助记词+主密码, mnemonic_salt) 解出 User Key
    mnemonic_salt: str          # K 派生用盐


# -- 恢复：验助记词 + 返回 encrypted_user_key（换设备用）-

@router.post("/initiate", response_model=InitiateRecoveryResponse)
async def initiate(
    req: InitiateRecoveryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """验助记词 -> 返回 encrypted_user_key + mnemonic_salt。

    客户端用助记词 + 主密码派生 K，解 encrypted_user_key 拿 User Key（换设备）。
    忘主密码无法派生 K -> 数据丢失（无恢复）。
    """
    user = (
        await find_user_by_email(db, req.value)
        if req.target == "email"
        else await find_user_by_phone(db, req.value)
    )
    if not user:
        # 不返回 404（账户枚举 oracle），与助记词错误返回一致的 401
        raise HTTPException(401, detail=_t(request, "mnemonic_invalid"))

    m = await find_valid_mnemonic(db, user.id, req.mnemonic)
    if not m:
        raise HTTPException(401, detail=_t(request, "mnemonic_invalid"))

    keys = await _get_user_keys(db, user.id)
    return InitiateRecoveryResponse(
        encrypted_user_key=keys.encrypted_user_key if keys else "",
        mnemonic_salt=keys.mnemonic_salt if keys else "",
    )
