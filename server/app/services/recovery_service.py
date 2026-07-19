"""助记词业务逻辑：生成、验证、发起恢复、加速、冻结。

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
from app.models.mnemonic import Mnemonic
from app.models.user import User, UserKeys
from app.services.bip39 import generate_bip39_code

# ── 常量 ────────────────────────────────────────────

COOLDOWN_HOURS = 24
ACCELERATE_LINK_TTL_MINUTES = COOLDOWN_HOURS * 60  # 与冷却期一致


def _recovery_signing_key() -> str:
    """助记词签名链接的密钥（独立于 JWT secret）。"""
    return getattr(settings, "recovery_signing_key", None) or settings.jwt_secret_key


def _get_hmac_key() -> bytes:
    """从环境变量解码服务端 HMAC 密钥。"""
    key = settings.mnemonic_hmac_key
    if not key:
        raise RuntimeError("RECOVERY_HMAC_KEY is not configured")
    return base64.b64decode(key)


def normalize_mnemonic(mnemonic: str) -> str:
    """规范化助记词：trim + lower + 单空格。"""
    return " ".join(mnemonic.strip().lower().split())


# ── 哈希与验证 ──────────────────────────────────────

def hash_mnemonic(plaintext: str, salt: str) -> str:
    """HMAC-SHA256(server_key, salt + normalized_mnemonic) -> hex digest。"""
    key = _get_hmac_key()
    normalized = normalize_mnemonic(plaintext)
    message = salt.encode() + normalized.encode("utf-8")
    return hmac.new(key, message, hashlib.sha256).hexdigest()


def verify_mnemonic(plaintext: str, salt: str, stored_hash: str) -> bool:
    """常量时间比较 HMAC 哈希。"""
    return hmac.compare_digest(
        hash_mnemonic(plaintext, salt), stored_hash
    )


# ── 生成 ────────────────────────────────────────────

def generate_mnemonic_plaintext() -> str:
    """生成 BIP39 12 词助记词。132 bit 熵，用户友好。"""
    return generate_bip39_code(12)


def generate_mnemonic_hmac_salt() -> str:
    """生成助记词专用盐。"""
    return secrets.token_hex(32)


async def create_mnemonic(
    db: AsyncSession, user_id: UUID,
) -> tuple[str, Mnemonic]:
    """为用户生成新助记词。如有旧码（active/cooldown）则不再需要（助记词永久不重生成）。"""
    result = await db.execute(
        select(Mnemonic).where(
            Mnemonic.user_id == user_id,
            Mnemonic.status.in_(["active", "cooldown"]),
        )
    )
    for old in result.scalars().all():
        pass  # 助记词永久不重生成，无需锁旧码

    plaintext = generate_mnemonic_plaintext()
    salt = generate_mnemonic_hmac_salt()
    code_hash = hash_mnemonic(plaintext, salt)

    rc = Mnemonic(
        user_id=user_id,
        mnemonic_hash=code_hash,
        mnemonic_hmac_salt=salt,
        status="active",
    )
    db.add(rc)
    await db.flush()
    return plaintext, rc


# ── 验证助记词并获取记录 ────────────────────────────

async def find_valid_mnemonic(
    db: AsyncSession, user_id: UUID, plaintext: str,
) -> Optional[Mnemonic]:
    """查找用户的 active 助记词并验证。

    助记词 132bit 不可暴力枚举，不累积失败计数、不永久锁定。
    initiate 失败由 RateLimitMiddleware（100/h）防骚扰。
    """
    result = await db.execute(
        select(Mnemonic).where(
            Mnemonic.user_id == user_id,
            Mnemonic.status == "active",
        )
    )
    rc = result.scalar_one_or_none()
    if not rc:
        return None

    if not verify_mnemonic(plaintext, rc.mnemonic_hmac_salt, rc.mnemonic_hash):
        return None

    return rc


# ── 内部：UserKeys 查询 ────────────────────────────

async def _get_user_keys(db: AsyncSession, user_id: UUID) -> Optional[UserKeys]:
    result = await db.execute(select(UserKeys).where(UserKeys.user_id == user_id))
    return result.scalar_one_or_none()


def _clear_rollback(rc: Mnemonic) -> None:
    """清空旧本地密码副本（accelerate/freeze/登录成功后调用）。
    K/User Key 不变，只回滚本地密码认证字段。"""
    rc.rollback_local_password_hash = None
    rc.rollback_local_salt = None
    rc.rollback_local_password_version = None


# ── 发起恢复 ────────────────────────────────────────

def _clear_pending_initiate(rc: Mnemonic) -> None:
    """清空两步 initiate 的待确认态（confirm 成功后或过期后调用）。"""
    rc.pending_initiate_token = None
    rc.pending_initiate_at = None
    rc.pending_new_local_password_hash = None
    rc.pending_new_local_salt = None


INITIATE_TOKEN_TTL_MINUTES = 15  # 两步 initiate：步骤1 到步骤2 的最大间隔


# ── 两步 initiate：步骤 1（验证助记词 + 建待确认态）────

async def initiate_recovery_step1(
    db: AsyncSession,
    rc: Mnemonic,
    user: User,
    new_local_password_hash: str,
    new_local_salt: str,
) -> tuple[str, str, str]:
    """验证助记词通过后，建"待确认"态（不改正式字段、不进冷却）。

    Returns (initiate_token, encrypted_user_key, mnemonic_salt).
    客户端用 mnemonic_salt + 助记词[+Passphrase]派生 K，解 encrypted_user_key 拿 User Key，
    用新本地密码重包 K（cached_K）后调 confirm。
    """
    token = secrets.token_hex(32)
    rc.pending_initiate_token = hashlib.sha256(token.encode()).hexdigest()
    rc.pending_initiate_at = datetime.now(timezone.utc)
    rc.pending_new_local_password_hash = new_local_password_hash
    rc.pending_new_local_salt = new_local_salt
    await db.flush()

    keys = await _get_user_keys(db, user.id)
    eu_key = keys.encrypted_user_key if keys else ""
    rec_salt = keys.mnemonic_salt if keys else ""
    return (token, eu_key, rec_salt)


# ── 两步 initiate：步骤 2（确认 + 真正发起）────────────

async def confirm_recovery(
    db: AsyncSession,
    rc: Mnemonic,
    user: User,
    token: str,
) -> bool:
    """验 token + 真正发起恢复：写正式本地密码 + 存 rollback + 进冷却 + 清待确认态。

    模型 D：只改本地密码认证字段（authKey+local_salt+local_password_version），
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

    # 3. 存旧本地密码到 rollback_*（供 freeze 回滚）
    rc.rollback_local_password_hash = user.local_password_hash
    rc.rollback_local_salt = user.local_salt
    rc.rollback_local_password_version = user.local_password_version

    # 4. 写正式 = 新本地密码（用步骤1暂存）
    user.local_password_hash = rc.pending_new_local_password_hash
    user.local_salt = rc.pending_new_local_salt
    user.local_password_version += 1

    # 5. 进冷却
    rc.status = "cooldown"
    rc.cooldown_until = now + timedelta(hours=COOLDOWN_HOURS)

    # 6. 清待确认态
    _clear_pending_initiate(rc)
    await db.flush()
    return True

# ── 加速：立即解除冷却（用户确认用新密码）──────────

async def accelerate_recovery(db: AsyncSession, rc: Mnemonic, user: User) -> None:
    """加速通道：清冷却 + 清 rollback（回滚窗口关闭），新密码已生效。

    accelerate 后 status=active，可用新密码登录。
    """
    rc.status = "active"
    rc.cooldown_until = None
    _clear_rollback(rc)
    await db.flush()


# ── 冻结：回滚到旧密码 ─────────────────────────────

async def freeze_recovery(db: AsyncSession, rc: Mnemonic, user: User) -> None:
    """冻结：回滚本地密码认证字段 = rollback_*（K/User Key 不变），status -> active。"""
    if rc.rollback_local_password_hash:
        user.local_password_hash = rc.rollback_local_password_hash
    if rc.rollback_local_salt:
        user.local_salt = rc.rollback_local_salt
    if rc.rollback_local_password_version is not None:
        user.local_password_version = rc.rollback_local_password_version
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
        select(Mnemonic).where(Mnemonic.user_id == user_id)
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
        select(Mnemonic).where(Mnemonic.user_id == user_id)
    )
    rc = result.scalar_one_or_none()
    if not rc or rc.rollback_local_password_hash is None:
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
