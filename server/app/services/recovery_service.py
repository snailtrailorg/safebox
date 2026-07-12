"""恢复码业务逻辑：生成、验证、发起恢复、加速、冻结。

状态机（v2 重设计，登录零写入）：
  initiate  -> 正式字段写新密码 + rollback_* 存旧值 + status=cooldown
  accelerate-> status=active + 清 rollback（用户确认新密码，回滚窗口关闭）
  freeze    -> 正式字段回滚 = rollback_* + status=active + 清 rollback
  冷却到期  -> 无动作（时间到了）
  登录      -> 纯读：now < cooldown_until 则拒绝；否则正常验证
               首次新密码登录成功 -> 清 rollback（押后，清不掉无害）
"""

from typing import Optional
import base64
import hashlib
import hmac
import json
import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

import bcrypt
import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.recovery_code import RecoveryCode
from app.models.user import User, UserKeys
from app.services.bip39 import generate_bip39_code

# ── 常量 ────────────────────────────────────────────

COOLDOWN_HOURS = 24
ACCELERATE_LINK_TTL_MINUTES = COOLDOWN_HOURS * 60  # 与冷却期一致


def _recovery_signing_key() -> str:
    """恢复码签名链接的密钥（独立于 JWT secret）。"""
    return getattr(settings, "recovery_signing_key", None) or settings.jwt_secret_key


def _get_hmac_key() -> bytes:
    """从环境变量解码服务端 HMAC 密钥。"""
    key = settings.recovery_hmac_key
    if not key:
        raise RuntimeError("RECOVERY_HMAC_KEY is not configured")
    return base64.b64decode(key)


def normalize_mnemonic(mnemonic: str) -> str:
    """规范化助记词：trim + lower + 单空格。"""
    return " ".join(mnemonic.strip().lower().split())


# ── 哈希与验证 ──────────────────────────────────────

def hash_recovery_code(plaintext: str, salt: str) -> str:
    """HMAC-SHA256(server_key, salt + normalized_mnemonic) -> hex digest。"""
    key = _get_hmac_key()
    normalized = normalize_mnemonic(plaintext)
    message = salt.encode() + normalized.encode("utf-8")
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def verify_recovery_code(plaintext: str, salt: str, stored_hash: str) -> bool:
    """常量时间比较 HMAC 哈希。"""
    return hmac.compare_digest(
        hash_recovery_code(plaintext, salt), stored_hash
    )


# ── 生成 ────────────────────────────────────────────

def generate_recovery_code_plaintext() -> str:
    """生成 BIP39 12 词恢复码。132 bit 熵，用户友好。"""
    return generate_bip39_code(12)


def generate_recovery_code_salt() -> str:
    """生成恢复码专用盐。"""
    return secrets.token_hex(32)


async def create_recovery_code(
    db: AsyncSession, user_id: UUID,
) -> tuple[str, RecoveryCode]:
    """为用户生成新恢复码。如有旧码（active/cooldown）则不再需要（恢复码永久不重生成）。"""
    result = await db.execute(
        select(RecoveryCode).where(
            RecoveryCode.user_id == user_id,
            RecoveryCode.status.in_(["active", "cooldown"]),
        )
    )
    for old in result.scalars().all():
        pass  # 恢复码永久不重生成，无需锁旧码

    plaintext = generate_recovery_code_plaintext()
    salt = generate_recovery_code_salt()
    code_hash = hash_recovery_code(plaintext, salt)

    rc = RecoveryCode(
        user_id=user_id,
        recovery_code_hash=code_hash,
        recovery_code_salt=salt,
        status="active",
    )
    db.add(rc)
    await db.flush()
    return plaintext, rc


# ── 验证恢复码并获取记录 ────────────────────────────

async def find_valid_recovery_code(
    db: AsyncSession, user_id: UUID, plaintext: str,
) -> Optional[RecoveryCode]:
    """查找用户的 active 恢复码并验证。

    恢复码 132bit 不可暴力枚举，不累积失败计数、不永久锁定。
    initiate 失败由 RateLimitMiddleware（100/h）防骚扰。
    """
    result = await db.execute(
        select(RecoveryCode).where(
            RecoveryCode.user_id == user_id,
            RecoveryCode.status == "active",
        )
    )
    rc = result.scalar_one_or_none()
    if not rc:
        return None

    if not verify_recovery_code(plaintext, rc.recovery_code_salt, rc.recovery_code_hash):
        return None

    return rc


# ── 内部：UserKeys 查询 ────────────────────────────

async def _get_user_keys(db: AsyncSession, user_id: UUID) -> Optional[UserKeys]:
    result = await db.execute(select(UserKeys).where(UserKeys.user_id == user_id))
    return result.scalar_one_or_none()


def _clear_rollback(rc: RecoveryCode) -> None:
    """清空旧登录密码副本（accelerate/freeze/登录成功后调用）。
    K/User Key 不变，只回滚登录密码认证字段。"""
    rc.rollback_auth_key_hash = None
    rc.rollback_login_salt = None
    rc.rollback_password_version = None


# ── 发起恢复 ────────────────────────────────────────

def _clear_pending_initiate(rc: RecoveryCode) -> None:
    """清空两步 initiate 的待确认态（confirm 成功后或过期后调用）。"""
    rc.pending_initiate_token = None
    rc.pending_initiate_at = None
    rc.pending_new_auth_key_hash = None
    rc.pending_new_login_salt = None


INITIATE_TOKEN_TTL_MINUTES = 15  # 两步 initiate：步骤1 到步骤2 的最大间隔


# ── 两步 initiate：步骤 1（验证恢复码 + 建待确认态）────

async def initiate_recovery_step1(
    db: AsyncSession,
    rc: RecoveryCode,
    user: User,
    new_auth_key_hash: str,
    new_login_salt: str,
) -> tuple[str, str, str]:
    """验证恢复码通过后，建"待确认"态（不改正式字段、不进冷却）。

    Returns (initiate_token, encrypted_user_key, recovery_salt).
    客户端用 recovery_salt + 恢复码[+主密码]派生 K，解 encrypted_user_key 拿 User Key，
    用新登录密码重包 K（cached_K）后调 confirm。
    """
    token = secrets.token_hex(32)
    rc.pending_initiate_token = hashlib.sha256(token.encode()).hexdigest()
    rc.pending_initiate_at = datetime.now(timezone.utc)
    rc.pending_new_auth_key_hash = new_auth_key_hash
    rc.pending_new_login_salt = new_login_salt
    await db.flush()

    keys = await _get_user_keys(db, user.id)
    eu_key = keys.encrypted_user_key if keys else ""
    rec_salt = keys.recovery_salt if keys else ""
    return (token, eu_key, rec_salt)


# ── 两步 initiate：步骤 2（确认 + 真正发起）────────────

async def confirm_recovery(
    db: AsyncSession,
    rc: RecoveryCode,
    user: User,
    token: str,
) -> bool:
    """验 token + 真正发起恢复：写正式登录密码 + 存 rollback + 进冷却 + 清待确认态。

    模型 D：只改登录密码认证字段（authKey+login_salt+password_version），
    不改 K/User Key/encrypted_user_key（K 不变，数据不动）。
    token 错误/过期 -> false；成功 -> true + cooldown_until 被写入 rc。
    """
    now = datetime.now(timezone.utc)

    # 1. 验 token（常量时间防侧信道）
    expected = hashlib.sha256(token.encode()).hexdigest()
    if not hmac.compare_digest(rc.pending_initiate_token or "", expected):
        return False
    # 2. 时效检查（15min）
    if rc.pending_initiate_at is None:
        return False
    pending_at = rc.pending_initiate_at
    if pending_at.tzinfo is None:
        pending_at = pending_at.replace(tzinfo=timezone.utc)
    if (now - pending_at).total_seconds() > INITIATE_TOKEN_TTL_MINUTES * 60:
        _clear_pending_initiate(rc)
        await db.flush()
        return False

    # 3. 存旧登录密码到 rollback_*（供 freeze 回滚）
    rc.rollback_auth_key_hash = user.auth_key_hash
    rc.rollback_login_salt = user.login_salt
    rc.rollback_password_version = user.password_version

    # 4. 写正式 = 新登录密码（用步骤1暂存）
    user.auth_key_hash = rc.pending_new_auth_key_hash
    user.login_salt = rc.pending_new_login_salt
    user.password_version += 1

    # 5. 进冷却
    rc.status = "cooldown"
    rc.cooldown_until = now + timedelta(hours=COOLDOWN_HOURS)

    # 6. 清待确认态
    _clear_pending_initiate(rc)
    await db.flush()
    return True

# ── 加速：立即解除冷却（用户确认用新密码）──────────

async def accelerate_recovery(db: AsyncSession, rc: RecoveryCode, user: User) -> None:
    """加速通道：清冷却 + 清 rollback（回滚窗口关闭），新密码已生效。

    accelerate 后 status=active，可用新密码登录。
    """
    rc.status = "active"
    rc.cooldown_until = None
    _clear_rollback(rc)
    await db.flush()


# ── 冻结：回滚到旧密码 ─────────────────────────────

async def freeze_recovery(db: AsyncSession, rc: RecoveryCode, user: User) -> None:
    """冻结：回滚登录密码认证字段 = rollback_*（K/User Key 不变），status -> active。"""
    if rc.rollback_auth_key_hash:
        user.auth_key_hash = rc.rollback_auth_key_hash
    if rc.rollback_login_salt:
        user.login_salt = rc.rollback_login_salt
    if rc.rollback_password_version is not None:
        user.password_version = rc.rollback_password_version
    rc.status = "active"
    rc.cooldown_until = None
    _clear_rollback(rc)
    await db.flush()


# ── 登录门 + 押后清理 ──────────────────────────────

async def is_in_cooldown(db: AsyncSession, user_id: UUID) -> bool:
    """登录门（纯读）：用户恢复处于冷却期且未到期 -> 拒绝登录。

    冷却已到期（now >= cooldown_until）则放行（status 仍为 cooldown，由登录成功后清理）。
    """
    result = await db.execute(
        select(RecoveryCode).where(RecoveryCode.user_id == user_id)
    )
    rc = result.scalar_one_or_none()
    if not rc or rc.status != "cooldown" or not rc.cooldown_until:
        return False
    until = rc.cooldown_until
    if until.tzinfo is None:
        until = until.replace(tzinfo=timezone.utc)
    return until > datetime.now(timezone.utc)


async def clear_rollback_after_login(db: AsyncSession, user_id: UUID) -> None:
    """冷却后首次新密码登录成功时清理 rollback（押后，清不掉无害）。

    将 status 置 active、清 cooldown_until 与 rollback。若未执行（如网络中断），
    下次登录重试；即便永不执行，rollback 留存也无害（不影响功能/安全）。
    """
    result = await db.execute(
        select(RecoveryCode).where(RecoveryCode.user_id == user_id)
    )
    rc = result.scalar_one_or_none()
    if not rc or rc.rollback_auth_key_hash is None:
        return
    rc.status = "active"
    rc.cooldown_until = None
    _clear_rollback(rc)
    await db.commit()


# ── 签名链接（加速/冻结用）─────────────────────────

def sign_recovery_token(payload: dict, expires_minutes: int = ACCELERATE_LINK_TTL_MINUTES) -> str:
    """签发恢复操作 token（加速或冻结）。"""
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    payload["exp"] = expire
    payload["iat"] = datetime.now(timezone.utc)
    return jwt.encode(payload, _recovery_signing_key(), algorithm="HS256")


def verify_recovery_token(token: str) -> Optional[dict]:
    """验证恢复操作 token，返回 payload 或 None。"""
    try:
        return jwt.decode(token, _recovery_signing_key(), algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None
