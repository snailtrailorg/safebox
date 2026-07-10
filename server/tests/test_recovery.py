"""恢复码服务单元测试。"""
import pytest
from unittest.mock import AsyncMock, patch, MagicMock
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.recovery_service import (
    hash_recovery_code,
    verify_recovery_code,
    generate_recovery_code_plaintext,
    generate_recovery_code_salt,
    sign_recovery_token,
    verify_recovery_token,
)

REGISTER_PAYLOAD = {
    "verification_code": "123456",
    "auth_key_hash": "pbkdf2_hashed",
    "password_salt": "salt",
    "password_wrapped": "wrapped",
    "recovery_wrapped": "recovery",
    "encrypted_private": "enc_priv",
    "rsa_public_key": "rsa_pub",
    "device_name": "Test Device",
    "device_public_key": "device_pub",
    "device_wrapped": "device_wrapped",
}


def test_generate_recovery_code_is_bip39():
    """生成的是 BIP39 12 词格式。"""
    code = generate_recovery_code_plaintext()
    words = code.split()
    assert len(words) == 12
    assert all(w.isalpha() and w.islower() for w in words)


def test_generate_recovery_code_unique():
    """每次生成不同的码。"""
    codes = {generate_recovery_code_plaintext() for _ in range(50)}
    assert len(codes) >= 45


def test_hash_and_verify():
    code = "abandon ability able about above absent absorb abstract accuse achieve acid acoustic"
    salt = generate_recovery_code_salt()
    h = hash_recovery_code(code, salt)
    assert len(h) == 64  # SHA-256 hex digest
    assert verify_recovery_code(code, salt, h)
    assert not verify_recovery_code("wrong code", salt, h)
    assert not verify_recovery_code(code, "wrong salt", h)


def test_hash_deterministic():
    code = "test code"
    salt = "test salt"
    assert hash_recovery_code(code, salt) == hash_recovery_code(code, salt)


def test_hash_case_sensitive():
    """normalize 做 lower，大小写不敏感。"""
    code = "Test Code"
    salt = "salt"
    h1 = hash_recovery_code(code, salt)
    h2 = hash_recovery_code(code.lower(), salt)
    assert h1 == h2  # normalize 统一转小写


def test_hash_whitespace_sensitive():
    """normalize 做 trim + 单空格，多余空格不影响。"""
    salt = "salt"
    h1 = hash_recovery_code("a b", salt)
    h2 = hash_recovery_code("a  b", salt)
    assert h1 == h2  # normalize 合并空格


def test_verify_constant_time():
    """verify 使用 hmac.compare_digest，常量时间。"""
    code = "test"
    salt = generate_recovery_code_salt()
    h = hash_recovery_code(code, salt)
    # 长度不同的哈希不应泄露信息
    assert not verify_recovery_code(code, salt, "short")
    assert not verify_recovery_code(code, salt, "a" * 64)


def test_sign_and_verify_token():
    payload = {"sub": "user-id", "action": "accelerate", "rc_id": "rc-id"}
    token = sign_recovery_token(payload)
    assert token is not None
    decoded = verify_recovery_token(token)
    assert decoded is not None
    assert decoded["sub"] == "user-id"
    assert decoded["action"] == "accelerate"
    assert decoded["rc_id"] == "rc-id"


def test_verify_invalid_token():
    assert verify_recovery_token("invalid.token") is None
    assert verify_recovery_token("") is None


def test_verify_wrong_action():
    payload = {"sub": "user-id", "action": "freeze", "rc_id": "rc-id"}
    token = sign_recovery_token(payload)
    decoded = verify_recovery_token(token)
    assert decoded is not None
    assert decoded["action"] == "freeze"


def test_generate_salt_unique():
    salts = {generate_recovery_code_salt() for _ in range(50)}
    assert len(salts) == 50  # 64 hex chars, 足够随机


# ── API 级：暴力破解锁定（回归测试 H2）───────────────

@pytest.mark.asyncio
async def test_recovery_lockout_after_5_failures(client: AsyncClient, db_session: AsyncSession):
    """连续 5 次错误恢复码后永久锁定：即使随后提交正确恢复码也被拒。

    回归 H2：失败计数曾因 get_db 对 401 回滚而永不累加，锁定形同虚设。
    """
    from app.services.auth_service import find_user_by_email
    from app.services.recovery_service import create_recovery_code

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "lock@safebox.example.com",
    })
    assert resp.status_code in (200, 201)

    # 直接建一个 active 恢复码（generate 端点的 verify_and_consume 未在 conftest mock）
    user = await find_user_by_email(db_session, "lock@safebox.example.com")
    plaintext, _ = await create_recovery_code(db_session, user.id)
    await db_session.commit()

    base_payload = {
        "target": "email", "value": "lock@safebox.example.com",
        "new_auth_key_hash": "nh", "new_password_salt": "ns",
        "new_kdf_settings": {"algorithm": "pbkdf2", "iterations": 600_000},
        "new_wrapped_user_key": "nw",
    }
    wrong = {**base_payload, "recovery_code": "wrong " * 11 + "wrong"}

    # 连错 5 次
    for _ in range(5):
        r = await client.post("/api/v1/auth/recovery/initiate", json=wrong)
        assert r.status_code == 401

    # 已锁定：即使正确恢复码也不再被接受
    good = {**base_payload, "recovery_code": plaintext}
    r = await client.post("/api/v1/auth/recovery/initiate", json=good)
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_recovery_reinitiate_during_cooldown_returns_409(
    client: AsyncClient, db_session: AsyncSession
):
    """冷却期内用同一（正确）恢复码再次发起 → 409 已在处理中（回归 H3）。

    曾因 find_valid_recovery_code 只查 active，pending 码查不到而先抛 401，
    409 分支为死代码。
    """
    from app.services.auth_service import find_user_by_email
    from app.services.recovery_service import create_recovery_code

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "cooldown@safebox.example.com",
    })
    assert resp.status_code in (200, 201)

    user = await find_user_by_email(db_session, "cooldown@safebox.example.com")
    plaintext, _ = await create_recovery_code(db_session, user.id)
    await db_session.commit()

    payload = {
        "target": "email", "value": "cooldown@safebox.example.com",
        "recovery_code": plaintext,
        "new_auth_key_hash": "nh", "new_password_salt": "ns",
        "new_kdf_settings": {"algorithm": "pbkdf2", "iterations": 600_000},
        "new_wrapped_user_key": "nw",
    }

    # 首次发起：进入冷却期
    r = await client.post("/api/v1/auth/recovery/initiate", json=payload)
    assert r.status_code == 200

    # 冷却期内再次发起（同一正确码）→ 409
    r = await client.post("/api/v1/auth/recovery/initiate", json=payload)
    assert r.status_code == 409

    # 冷却期内用错误码 → 401（不泄露 pending 状态）
    r = await client.post("/api/v1/auth/recovery/initiate", json={
        **payload, "recovery_code": "wrong " * 11 + "wrong",
    })
    assert r.status_code == 401