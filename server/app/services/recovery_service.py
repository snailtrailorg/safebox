"""助记词业务逻辑：生成、验证、发起恢复（换设备）。

合并主密码模型：K = PBKDF2(助记词 + 主密码, mnemonic_salt)。
助记词用于换设备（有主密码时派生 K 解 encrypted_user_key）。
忘主密码 = 数据丢失（主密码参与 K 派生，无法恢复）。
"""

from typing import Optional
import base64
import hashlib
import hmac
import secrets
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.mnemonic import Mnemonic
from app.models.user import User, UserKeys
from app.services.bip39 import generate_bip39_code


def _get_hmac_key() -> bytes:
    """从环境变量解码服务端 HMAC 密钥。"""
    key = settings.mnemonic_hmac_key
    if not key:
        raise RuntimeError("MNEMONIC_HMAC_KEY is not configured")
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
    return hmac.compare_digest(hash_mnemonic(plaintext, salt), stored_hash)


# ── 生成 ────────────────────────────────────────────

def generate_mnemonic_plaintext() -> str:
    """生成 BIP39 12 词助记词。132 bit 熵。"""
    return generate_bip39_code(12)


def generate_mnemonic_hmac_salt() -> str:
    """生成助记词 HMAC 验证用盐。"""
    return secrets.token_hex(32)


# ── 验证助记词并获取记录 ────────────────────────────

async def find_valid_mnemonic(
    db: AsyncSession, user_id: UUID, plaintext: str,
) -> Optional[Mnemonic]:
    """查找用户的助记词并验证。助记词 132bit 不可暴力枚举，不累积失败计数。"""
    result = await db.execute(
        select(Mnemonic).where(Mnemonic.user_id == user_id)
    )
    m = result.scalar_one_or_none()
    if not m:
        return None
    if not verify_mnemonic(plaintext, m.mnemonic_hmac_salt, m.mnemonic_hash):
        return None
    return m


async def _get_user_keys(db: AsyncSession, user_id: UUID) -> Optional[UserKeys]:
    result = await db.execute(select(UserKeys).where(UserKeys.user_id == user_id))
    return result.scalar_one_or_none()
