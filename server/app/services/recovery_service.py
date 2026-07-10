"""恢复码业务逻辑：生成、验证、发起恢复、加速、冻结。"""

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

MAX_FAILED_ATTEMPTS = 5          # 24h 窗口内连续失败 → permanently_locked
MAX_MONTHLY_INITIATIONS = 3      # 月发起次数 > 3 → permanently_locked
FAILED_ATTEMPT_WINDOW_HOURS = 24  # 失败计数窗口
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
    """HMAC-SHA256(server_key, salt + normalized_mnemonic) → hex digest。"""
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
    """为用户生成新恢复码。如有旧码则标记为 permanently_locked。"""
    # 锁定旧码
    result = await db.execute(
        select(RecoveryCode).where(
            RecoveryCode.user_id == user_id,
            RecoveryCode.status.in_(["active", "pending_activation"]),
        )
    )
    for old in result.scalars().all():
        old.status = "permanently_locked"

    plaintext = generate_recovery_code_plaintext()
    salt = generate_recovery_code_salt()
    code_hash = hash_recovery_code(plaintext, salt)

    rc = RecoveryCode(
        user_id=user_id,
        recovery_code_hash=code_hash,
        recovery_code_salt=salt,
        status="active",
        monthly_initiation_count=0,
        failed_attempt_count=0,
    )
    db.add(rc)
    await db.flush()
    return plaintext, rc


# ── 验证恢复码并获取记录 ────────────────────────────

async def find_valid_recovery_code(
    db: AsyncSession, user_id: UUID, plaintext: str,
) -> RecoveryCode | None:
    """查找用户的有效恢复码并验证。

    失败时：24h 滑动窗口内递增失败计数，≥5 次永久锁定。
    成功时：清零失败计数。
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
        now = datetime.now(timezone.utc)
        # 24h 窗口：超过窗口期重置计数。
        # last_at 归一到 aware UTC——PostgreSQL 返回 aware，SQLite 返回 naive，
        # 不归一会在 aware - naive 相减时抛 TypeError。
        last_at = rc.failed_attempt_last_at
        if last_at is not None and last_at.tzinfo is None:
            last_at = last_at.replace(tzinfo=timezone.utc)
        if (
            last_at is None
            or (now - last_at).total_seconds() > FAILED_ATTEMPT_WINDOW_HOURS * 3600
        ):
            rc.failed_attempt_count = 1
        else:
            rc.failed_attempt_count += 1
        rc.failed_attempt_last_at = now

        if rc.failed_attempt_count >= MAX_FAILED_ATTEMPTS:
            rc.status = "permanently_locked"
        # 必须 commit（而非 flush）：调用方随后会抛 401，get_db 对异常回滚。
        # 若仅 flush，失败计数会随请求一起被回滚，跨请求永不累加，≥5 锁定形同虚设。
        await db.commit()
        return None

    # 验证成功，清零失败计数
    rc.failed_attempt_count = 0
    rc.failed_attempt_last_at = None
    return rc


# ── 发起恢复 ────────────────────────────────────────

async def initiate_recovery(
    db: AsyncSession,
    rc: RecoveryCode,
    new_auth_key_hash: str,
    new_password_salt: str,
    new_kdf_settings: dict,
    new_wrapped_user_key: str,
) -> RecoveryCode:
    """进入冷却期：写入 pending_* 字段，status → pending_activation。"""
    now = datetime.now(timezone.utc)

    rc.status = "pending_activation"
    rc.pending_new_auth_key_hash = new_auth_key_hash
    rc.pending_password_salt = new_password_salt
    rc.pending_kdf_settings = json.dumps(new_kdf_settings)
    rc.pending_wrapped_user_key = new_wrapped_user_key
    rc.pending_setup_at = now
    rc.cooldown_expires_at = now + timedelta(hours=COOLDOWN_HOURS)
    rc.monthly_initiation_count += 1

    # 月发起次数 > 3 → 永久锁定
    if rc.monthly_initiation_count > MAX_MONTHLY_INITIATIONS:
        rc.status = "permanently_locked"

    await db.flush()
    return rc


# ── 激活（加速通道或冷却自然结束）──────────────────

async def activate_recovery(
    db: AsyncSession, rc: RecoveryCode, user: User,
) -> None:
    """将 pending_* 写入 users/user_keys，status → consumed。"""
    user.auth_key_hash = rc.pending_new_auth_key_hash
    user.password_salt = rc.pending_password_salt
    if rc.pending_kdf_settings:
        user.kdf_settings = rc.pending_kdf_settings  # M3：恢复激活时同步 KDF 设置

    # 更新 UserKeys
    result = await db.execute(
        select(UserKeys).where(UserKeys.user_id == user.id)
    )
    keys = result.scalar_one_or_none()
    if keys and rc.pending_wrapped_user_key:
        keys.password_wrapped = rc.pending_wrapped_user_key

    rc.status = "consumed"
    rc.consumed_at = datetime.now(timezone.utc)
    await db.flush()


# ── 冻结 ────────────────────────────────────────────

async def freeze_recovery(db: AsyncSession, rc: RecoveryCode) -> None:
    """丢弃 pending_* 字段，status 回退 active。旧密码保持不变。"""
    rc.status = "active"
    rc.pending_new_auth_key_hash = None
    rc.pending_password_salt = None
    rc.pending_kdf_settings = None
    rc.pending_wrapped_user_key = None
    rc.pending_setup_at = None
    rc.cooldown_expires_at = None
    await db.flush()


# ── 签名链接（加速/冻结用）─────────────────────────

def sign_recovery_token(payload: dict, expires_minutes: int = ACCELERATE_LINK_TTL_MINUTES) -> str:
    """签发一次性恢复操作 token（加速或冻结）。"""
    expire = datetime.now(timezone.utc) + timedelta(minutes=expires_minutes)
    payload["exp"] = expire
    payload["iat"] = datetime.now(timezone.utc)
    return jwt.encode(payload, _recovery_signing_key(), algorithm="HS256")


def verify_recovery_token(token: str) -> dict | None:
    """验证恢复操作 token，返回 payload 或 None。"""
    try:
        return jwt.decode(token, _recovery_signing_key(), algorithms=["HS256"])
    except jwt.InvalidTokenError:
        return None


# ── 检查冷却期到期并自动激活 ────────────────────────

async def check_and_auto_activate(
    db: AsyncSession, rc: RecoveryCode, user: User,
) -> bool:
    """如果冷却期已结束，自动激活。返回 True 表示已激活。"""
    if (
        rc.status == "pending_activation"
        and rc.cooldown_expires_at
        and rc.cooldown_expires_at <= datetime.now(timezone.utc)
    ):
        await activate_recovery(db, rc, user)
        await db.commit()
        return True
    return False
