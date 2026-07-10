"""恢复码 API：生成、发起恢复、加速、冻结、状态查询、作废。"""

import hashlib
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.i18n import get_lang, get_text
from app.middleware import get_current_user_id, require_not_in_cooldown
from app.models.recovery_code import RecoveryCode
from app.models.user import User, UserKeys
from app.services.auth_service import (
    find_user_by_email,
    find_user_by_phone,
    hash_auth_key,
    verify_auth_key,
)
from app.services.email_service import send_recovery_alert
from app.services.recovery_service import (
    COOLDOWN_HOURS,
    accelerate_recovery,
    confirm_recovery,
    create_recovery_code,
    find_valid_recovery_code,
    freeze_recovery,
    initiate_recovery_step1,
    sign_recovery_token,
    verify_recovery_code,
    verify_recovery_token,
)
from app.services.token_service import revoke_all_user_tokens
from app.services.verification_service import verify_and_consume

router = APIRouter(prefix="/api/v1/auth/recovery", tags=["recovery"])


def _t(request: Request, key: str, **kw: object) -> str:
    lang = get_lang(request.headers.get("Accept-Language"))
    return get_text(key, lang, **kw)


# ── Schemas ─────────────────────────────────────────

class GenerateRecoveryRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    current_auth_key_hash: str
    recovery_wrapped: str       # 恢复码派生密钥包裹的 User Key（客户端用恢复码明文派生）
    recovery_salt: str          # 恢复码派生密钥的盐


class GenerateRecoveryResponse(BaseModel):
    recovery_code: str


class InitiateRecoveryRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    recovery_code: str
    new_auth_key_hash: str
    new_password_salt: str
    new_kdf_settings: dict


class InitiateRecoveryResponse(BaseModel):
    recovery_wrapped: str       # 客户端用恢复码派生密钥解出旧 User Key，本地重包后调 confirm
    recovery_salt: str
    initiate_token: str         # 步骤2 confirm 用（15min 有效）


class ConfirmRecoveryRequest(BaseModel):
    initiate_token: str
    new_wrapped_user_key: str   # 旧 User Key 用新密码重包（User Key 不换，数据不动）


class ConfirmRecoveryResponse(BaseModel):
    cooldown_until: str


class AccelerateRecoveryRequest(BaseModel):
    signed_token: str
    verification_code: str = Field(..., min_length=6, max_length=6)


class FreezeRecoveryRequest(BaseModel):
    signed_token: str


class RecoveryStatusResponse(BaseModel):
    status: str  # none | active | cooldown | permanently_locked
    cooldown_until: str | None = None
    monthly_initiation_count: int = 0
    failed_attempt_count: int = 0


class RevokeRecoveryRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    current_auth_key_hash: str


# ── 生成恢复码（已登录）─────────────────────────────

@router.post("/generate", response_model=GenerateRecoveryResponse)
async def generate_recovery(
    req: GenerateRecoveryRequest,
    request: Request,
    user_id: UUID = Depends(require_not_in_cooldown),
    db: AsyncSession = Depends(get_db),
):
    """生成新恢复码。需验证码 + 当前密码。"""
    if not await verify_and_consume(req.target, req.value, req.verification_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_t(request, "verification_code_invalid"),
        )

    user = await db.get(User, user_id)
    if not user or not verify_auth_key(req.current_auth_key_hash, user.auth_key_hash or ""):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_t(request, "email_or_password_wrong"),
        )

    plaintext, _ = await create_recovery_code(db, user_id)

    # 存客户端用恢复码派生密钥包裹的 User Key（数据恢复用）
    result = await db.execute(select(UserKeys).where(UserKeys.user_id == user_id))
    uk = result.scalar_one_or_none()
    if uk:
        uk.recovery_wrapped = req.recovery_wrapped
        uk.recovery_salt = req.recovery_salt
    await db.commit()

    return GenerateRecoveryResponse(recovery_code=plaintext)


# ── 恢复：步骤 1（验证恢复码 + 建待确认态）─────────────

@router.post("/initiate", response_model=InitiateRecoveryResponse)
async def initiate(
    req: InitiateRecoveryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """步骤 1：验证恢复码。验通过后返回 recovery_wrapped + initiate_token。

    此时**不改正式字段**、不进冷却。客户端用恢复码 + recovery_salt 本地解包旧 User Key、
    用新密码重包后，调 /auth/recovery/confirm 完成。
    """
    user = (
        await find_user_by_email(db, req.value)
        if req.target == "email"
        else await find_user_by_phone(db, req.value)
    )
    if not user:
        raise HTTPException(404, detail=_t(request, "user_not_found"))

    # 检查是否已在冷却期
    result = await db.execute(
        select(RecoveryCode).where(RecoveryCode.user_id == user.id)
    )
    existing = result.scalar_one_or_none()
    if existing is not None and existing.status == "cooldown":
        if verify_recovery_code(
            req.recovery_code, existing.recovery_code_salt, existing.recovery_code_hash
        ):
            raise HTTPException(409, detail=_t(request, "recovery_already_pending"))
        raise HTTPException(401, detail=_t(request, "recovery_code_invalid"))

    # 验证 active 恢复码（含失败计数 / 锁定）
    rc = await find_valid_recovery_code(db, user.id, req.recovery_code)
    if not rc:
        raise HTTPException(401, detail=_t(request, "recovery_code_invalid"))

    new_hash = hash_auth_key(req.new_auth_key_hash)
    token, rec_wrapped, rec_salt = await initiate_recovery_step1(
        db, rc, user,
        new_auth_key_hash=new_hash,
        new_password_salt=req.new_password_salt,
        new_kdf_settings=req.new_kdf_settings,
    )
    await db.commit()

    return InitiateRecoveryResponse(
        recovery_wrapped=rec_wrapped,
        recovery_salt=rec_salt,
        initiate_token=token,
    )


# ── 恢复：步骤 2（确认 + 真正发起）────────────────────

@router.post("/confirm", response_model=ConfirmRecoveryResponse)
async def confirm(
    req: ConfirmRecoveryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """步骤 2：验 token + 交重包后的 new_wrapped_user_key。真正发起恢复。

    写正式=新密码 + rollback_*=旧密码 + status=cooldown + 吊销所有旧 token（A）。
    """
    # 按 token 哈希找对应 recovery_code
    token_hash = hashlib.sha256(req.initiate_token.encode()).hexdigest()
    result = await db.execute(
        select(RecoveryCode).where(RecoveryCode.pending_initiate_token == token_hash)
    )
    rc = result.scalar_one_or_none()
    if not rc:
        raise HTTPException(401, detail=_t(request, "recovery_token_invalid"))

    user = await db.get(User, rc.user_id)
    if not user:
        raise HTTPException(404, detail=_t(request, "user_not_found"))

    ok = await confirm_recovery(db, rc, user, req.initiate_token, req.new_wrapped_user_key)
    if not ok:
        raise HTTPException(401, detail=_t(request, "recovery_token_invalid"))

    await revoke_all_user_tokens(db, user.id)  # A: 切断所有旧会话
    await db.commit()

    # 发送告警（同原 initiate）
    accelerate_token = sign_recovery_token(
        {"sub": str(user.id), "action": "accelerate", "rc_id": str(rc.id)}
    )
    freeze_token = sign_recovery_token(
        {"sub": str(user.id), "action": "freeze", "rc_id": str(rc.id)}
    )
    await send_recovery_alert(user, "initiate", accelerate_token, freeze_token)

    return ConfirmRecoveryResponse(
        cooldown_until=rc.cooldown_until.isoformat()
    )


# ── 状态查询 ────────────────────────────────────────

@router.get("/status", response_model=RecoveryStatusResponse)
async def get_status(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """查询当前用户的恢复码状态（前端倒计时用）。纯读，不触发激活。"""
    result = await db.execute(
        select(RecoveryCode).where(RecoveryCode.user_id == user_id)
    )
    rc = result.scalar_one_or_none()

    if not rc:
        return RecoveryStatusResponse(status="none")

    return RecoveryStatusResponse(
        status=rc.status,
        cooldown_until=rc.cooldown_until.isoformat() if rc.cooldown_until else None,
        monthly_initiation_count=rc.monthly_initiation_count,
        failed_attempt_count=rc.failed_attempt_count,
    )


# ── 加速通道（需验证码 + 签名 token）───────────────

@router.post("/accelerate", status_code=status.HTTP_204_NO_CONTENT)
async def accelerate(
    req: AccelerateRecoveryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """加速通道：验证码 + 签名链接 -> 立即解除冷却（新密码已生效）。"""
    payload = verify_recovery_token(req.signed_token)
    if not payload or payload.get("action") != "accelerate":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_t(request, "recovery_token_invalid"),
        )

    user_id = UUID(payload["sub"])
    rc_id = UUID(payload["rc_id"])

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_t(request, "user_not_found"))

    rc = await db.get(RecoveryCode, rc_id)
    if not rc or rc.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_t(request, "user_not_found"))

    if rc.status != "cooldown":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_t(request, "recovery_not_pending"),
        )

    if not await verify_and_consume("email", user.email or "", req.verification_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_t(request, "verification_code_invalid"),
        )

    await accelerate_recovery(db, rc, user)
    await db.commit()

    await send_recovery_alert(user, "accelerate", "", "")


# ── 冻结（签名 token，无需登录/验证码）──────────────

@router.post("/freeze", status_code=status.HTTP_204_NO_CONTENT)
async def freeze(
    req: FreezeRecoveryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """冻结：签名链接 -> 回滚旧密码 + 解除冷却。无需登录。"""
    payload = verify_recovery_token(req.signed_token)
    if not payload or payload.get("action") != "freeze":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_t(request, "recovery_token_invalid"),
        )

    user_id = UUID(payload["sub"])
    rc_id = UUID(payload["rc_id"])

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_t(request, "user_not_found"))

    rc = await db.get(RecoveryCode, rc_id)
    if not rc or rc.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_t(request, "user_not_found"))

    if rc.status != "cooldown":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_t(request, "recovery_not_pending"),
        )

    await freeze_recovery(db, rc, user)
    await db.commit()

    await send_recovery_alert(user, "freeze", "", "")


# ── 主动作废（已登录）───────────────────────────────

@router.post("/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke(
    req: RevokeRecoveryRequest,
    request: Request,
    user_id: UUID = Depends(require_not_in_cooldown),
    db: AsyncSession = Depends(get_db),
):
    """已登录用户主动作废恢复码。需验证码 + 当前密码。"""
    if not await verify_and_consume(req.target, req.value, req.verification_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_t(request, "verification_code_invalid"),
        )

    user = await db.get(User, user_id)
    if not user or not verify_auth_key(req.current_auth_key_hash, user.auth_key_hash or ""):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_t(request, "email_or_password_wrong"),
        )

    result = await db.execute(
        select(RecoveryCode).where(
            RecoveryCode.user_id == user_id,
            RecoveryCode.status.in_(["active", "cooldown"]),
        )
    )
    rc = result.scalar_one_or_none()
    if rc:
        rc.status = "permanently_locked"
        await db.commit()
