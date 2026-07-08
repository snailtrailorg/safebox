"""恢复码 API：生成、发起恢复、加速、冻结、状态查询、作废。"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.i18n import get_lang, get_text
from app.middleware import get_current_user_id
from app.models.recovery_code import RecoveryCode
from app.models.user import User
from app.services.auth_service import (
    find_user_by_email,
    find_user_by_phone,
    hash_auth_key,
    verify_auth_key,
)
from app.services.email_service import send_recovery_alert
from app.services.recovery_service import (
    COOLDOWN_HOURS,
    activate_recovery,
    check_and_auto_activate,
    create_recovery_code,
    find_valid_recovery_code,
    freeze_recovery,
    initiate_recovery,
    sign_recovery_token,
    verify_recovery_token,
)
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


class GenerateRecoveryResponse(BaseModel):
    recovery_code: str


class InitiateRecoveryRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    recovery_code: str
    new_auth_key_hash: str
    new_password_salt: str
    new_kdf_settings: dict
    new_wrapped_user_key: str


class InitiateRecoveryResponse(BaseModel):
    cooldown_expires_at: str


class AccelerateRecoveryRequest(BaseModel):
    signed_token: str
    verification_code: str = Field(..., min_length=6, max_length=6)


class FreezeRecoveryRequest(BaseModel):
    signed_token: str


class RecoveryStatusResponse(BaseModel):
    status: str  # none | active | pending_activation | permanently_locked
    cooldown_expires_at: str | None = None
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
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """生成新恢复码。需验证码 + 当前密码。"""
    # 验证码
    if not await verify_and_consume(req.target, req.value, req.verification_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_t(request, "verification_code_invalid"),
        )

    # 验证当前密码
    user = await db.get(User, user_id)
    if not user or not verify_auth_key(req.current_auth_key_hash, user.auth_key_hash or ""):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_t(request, "email_or_password_wrong"),
        )

    plaintext, _ = await create_recovery_code(db, user_id)
    await db.commit()

    return GenerateRecoveryResponse(recovery_code=plaintext)


# ── 发起恢复（无需验证码）───────────────────────────

@router.post("/initiate", response_model=InitiateRecoveryResponse)
async def initiate(
    req: InitiateRecoveryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """验证恢复码 + 提交新密码，进入 24h 冷却期。不要求验证码。"""
    user = (
        await find_user_by_email(db, req.value)
        if req.target == "email"
        else await find_user_by_phone(db, req.value)
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=_t(request, "user_not_found"),
        )

    # 查找并验证恢复码
    rc = await find_valid_recovery_code(db, user.id, req.recovery_code)
    if not rc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=_t(request, "recovery_code_invalid"),
        )

    # 检查是否已在冷却期
    if rc.status == "pending_activation":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_t(request, "recovery_already_pending"),
        )

    # 新密码哈希
    new_hash = hash_auth_key(req.new_auth_key_hash)

    await initiate_recovery(
        db, rc,
        new_auth_key_hash=new_hash,
        new_password_salt=req.new_password_salt,
        new_kdf_settings=req.new_kdf_settings,
        new_wrapped_user_key=req.new_wrapped_user_key,
    )
    await db.commit()

    # 发送告警邮件（异步）
    accelerate_token = sign_recovery_token(
        {"sub": str(user.id), "action": "accelerate", "rc_id": str(rc.id)}
    )
    freeze_token = sign_recovery_token(
        {"sub": str(user.id), "action": "freeze", "rc_id": str(rc.id)}
    )
    await send_recovery_alert(user, "initiate", accelerate_token, freeze_token)

    return InitiateRecoveryResponse(
        cooldown_expires_at=rc.cooldown_expires_at.isoformat()
    )


# ── 状态查询 ────────────────────────────────────────

@router.get("/status", response_model=RecoveryStatusResponse)
async def get_status(
    user_id: UUID = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """查询当前用户的恢复码状态（前端倒计时用）。"""
    result = await db.execute(
        select(RecoveryCode).where(RecoveryCode.user_id == user_id)
    )
    rc = result.scalar_one_or_none()

    if not rc:
        return RecoveryStatusResponse(status="none")

    # 检查是否应自动激活
    if rc.status == "pending_activation":
        user = await db.get(User, user_id)
        if user:
            activated = await check_and_auto_activate(db, rc, user)
            if activated:
                return RecoveryStatusResponse(
                    status=rc.status,
                    monthly_initiation_count=rc.monthly_initiation_count,
                    failed_attempt_count=rc.failed_attempt_count,
                )

    return RecoveryStatusResponse(
        status=rc.status,
        cooldown_expires_at=rc.cooldown_expires_at.isoformat() if rc.cooldown_expires_at else None,
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
    """加速通道：验证码 + 签名链接 → 立即激活新密码。"""
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    rc = await db.get(RecoveryCode, rc_id)
    if not rc or rc.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    if rc.status != "pending_activation":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_t(request, "recovery_not_pending"),
        )

    # 需要验证码
    if not await verify_and_consume("email", user.email or "", req.verification_code):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=_t(request, "verification_code_invalid"),
        )

    await activate_recovery(db, rc, user)
    await db.commit()

    await send_recovery_alert(user, "accelerate", "", "")


# ── 冻结（签名 token，无需登录/验证码）──────────────

@router.post("/freeze", status_code=status.HTTP_204_NO_CONTENT)
async def freeze(
    req: FreezeRecoveryRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """终止恢复：签名链接 → 丢弃 pending，回滚旧密码。无需登录。"""
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
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    rc = await db.get(RecoveryCode, rc_id)
    if not rc or rc.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    if rc.status != "pending_activation":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=_t(request, "recovery_not_pending"),
        )

    await freeze_recovery(db, rc)
    await db.commit()

    await send_recovery_alert(user, "freeze", "", "")


# ── 主动作废（已登录）───────────────────────────────

@router.post("/revoke", status_code=status.HTTP_204_NO_CONTENT)
async def revoke(
    req: RevokeRecoveryRequest,
    request: Request,
    user_id: UUID = Depends(get_current_user_id),
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
            RecoveryCode.status.in_(["active", "pending_activation"]),
        )
    )
    rc = result.scalar_one_or_none()
    if rc:
        rc.status = "permanently_locked"
        await db.commit()
