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


# ── 两步 initiate helper（step1 验码 + step2 confirm）─────────

async def _initiate(client, email, recovery_code, new_hash="new_hash", new_wrapped="nw"):
    """两步 initiate：step1 返回 initiate_token；step2 confirm 写正式+进冷却。"""
    r = await client.post("/api/v1/auth/recovery/initiate", json={
        "target": "email", "value": email,
        "recovery_code": recovery_code, "new_auth_key_hash": new_hash,
        "new_password_salt": "ns", "new_kdf_settings": {"algorithm": "pbkdf2", "iterations": 600_000},
    })
    assert r.status_code == 200, r.text
    token = r.json()["initiate_token"]
    return await client.post("/api/v1/auth/recovery/confirm", json={
        "initiate_token": token, "new_wrapped_user_key": new_wrapped,
    })


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

    step1 = {
        "target": "email", "value": "cooldown@safebox.example.com",
        "recovery_code": plaintext,
        "new_auth_key_hash": "nh", "new_password_salt": "ns",
        "new_kdf_settings": {"algorithm": "pbkdf2", "iterations": 600_000},
    }

    # 首次发起：进入冷却期
    r = await _initiate(client, "cooldown@safebox.example.com", plaintext)
    assert r.status_code == 200

    # 冷却期内再次发起（同一正确码）→ 409
    r = await client.post("/api/v1/auth/recovery/initiate", json=step1)
    assert r.status_code == 409

    # 冷却期内用错误码 → 401（不泄露 pending 状态）
    r = await client.post("/api/v1/auth/recovery/initiate", json={
        **step1, "recovery_code": "wrong " * 11 + "wrong",
    })
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_initiate_writes_new_password_and_enters_cooldown(client: AsyncClient, db_session: AsyncSession):
    """initiate 直接把新密码写正式字段 + 存旧副本 + status=cooldown（v2 状态机）。"""
    from app.services.auth_service import find_user_by_email, verify_auth_key
    from app.services.recovery_service import create_recovery_code
    from app.models.recovery_code import RecoveryCode
    from sqlalchemy import select

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "init@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    user = await find_user_by_email(db_session, "init@safebox.example.com")
    plaintext, _ = await create_recovery_code(db_session, user.id)
    await db_session.commit()

    r = await _initiate(client, "init@safebox.example.com", plaintext)
    assert r.status_code == 200
    assert "cooldown_until" in r.json()

    # 正式字段已是新密码（旧密码验证失败）
    await db_session.refresh(user)
    assert not verify_auth_key(REGISTER_PAYLOAD["auth_key_hash"], user.auth_key_hash)
    assert verify_auth_key("new_hash", user.auth_key_hash)

    # 旧密码存入 rollback_*
    rc = (await db_session.execute(
        select(RecoveryCode).where(RecoveryCode.user_id == user.id)
    )).scalar_one()
    assert rc.status == "cooldown"
    assert rc.rollback_auth_key_hash is not None
    assert verify_auth_key(REGISTER_PAYLOAD["auth_key_hash"], rc.rollback_auth_key_hash)  # 旧 hash

    # /status 报告 cooldown
    r = await client.get("/api/v1/auth/recovery/status", headers=headers)
    assert r.status_code == 200
    assert r.json()["status"] == "cooldown"
    assert r.json()["cooldown_until"] is not None


@pytest.mark.asyncio
async def test_login_blocked_during_cooldown(client: AsyncClient, db_session: AsyncSession):
    """冷却期内账户锁定：新旧密码均不可登录（403）。"""
    from app.services.auth_service import find_user_by_email
    from app.services.recovery_service import create_recovery_code

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "block@safebox.example.com",
    })
    user = await find_user_by_email(db_session, "block@safebox.example.com")
    plaintext, _ = await create_recovery_code(db_session, user.id)
    await db_session.commit()

    await _initiate(client, "block@safebox.example.com", plaintext)

    # 新密码 -> 403（冷却期锁定，非 401）
    r = await client.post("/api/v1/auth/login/email", json={
        "email": "block@safebox.example.com", "auth_key_hash": "new_hash",
    })
    assert r.status_code == 403
    # 旧密码 -> 403（同样锁定）
    r = await client.post("/api/v1/auth/login/email", json={
        "email": "block@safebox.example.com", "auth_key_hash": REGISTER_PAYLOAD["auth_key_hash"],
    })
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_accelerate_clears_cooldown_and_allows_login(client: AsyncClient, db_session: AsyncSession):
    """accelerate 解除冷却 + 清副本，新密码可登录。"""
    from app.services.auth_service import find_user_by_email
    from app.services.recovery_service import create_recovery_code, sign_recovery_token
    from app.models.recovery_code import RecoveryCode
    from sqlalchemy import select

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "acc@safebox.example.com",
    })
    user = await find_user_by_email(db_session, "acc@safebox.example.com")
    plaintext, rc = await create_recovery_code(db_session, user.id)
    await db_session.commit()

    await _initiate(client, "acc@safebox.example.com", plaintext)

    # 加速（验证码被 conftest mock 为通过）
    accel_token = sign_recovery_token({"sub": str(user.id), "action": "accelerate", "rc_id": str(rc.id)})
    r = await client.post("/api/v1/auth/recovery/accelerate", json={
        "signed_token": accel_token, "verification_code": "123456",
    })
    assert r.status_code == 204

    # 冷却解除，副本清空
    await db_session.refresh(rc)
    assert rc.status == "active"
    assert rc.rollback_auth_key_hash is None

    # 新密码可登录
    r = await client.post("/api/v1/auth/login/email", json={
        "email": "acc@safebox.example.com", "auth_key_hash": "new_hash",
    })
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_freeze_rolls_back_to_old_password(client: AsyncClient, db_session: AsyncSession):
    """freeze 回滚旧密码：旧密码可登录，新密码失效。"""
    from app.services.auth_service import find_user_by_email
    from app.services.recovery_service import create_recovery_code, sign_recovery_token

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "frz@safebox.example.com",
    })
    user = await find_user_by_email(db_session, "frz@safebox.example.com")
    plaintext, rc = await create_recovery_code(db_session, user.id)
    await db_session.commit()

    await _initiate(client, "frz@safebox.example.com", plaintext)

    freeze_token = sign_recovery_token({"sub": str(user.id), "action": "freeze", "rc_id": str(rc.id)})
    r = await client.post("/api/v1/auth/recovery/freeze", json={"signed_token": freeze_token})
    assert r.status_code == 204

    # 旧密码可登录
    r = await client.post("/api/v1/auth/login/email", json={
        "email": "frz@safebox.example.com", "auth_key_hash": REGISTER_PAYLOAD["auth_key_hash"],
    })
    assert r.status_code == 200
    # 新密码失效
    r = await client.post("/api/v1/auth/login/email", json={
        "email": "frz@safebox.example.com", "auth_key_hash": "new_hash",
    })
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_cooldown_expired_new_password_login_clears_rollback(client: AsyncClient, db_session: AsyncSession):
    """冷却到期后用新密码登录 -> 成功并清副本（押后清理）。旧密码失效。"""
    from datetime import datetime, timedelta, timezone
    from app.services.auth_service import find_user_by_email
    from app.services.recovery_service import create_recovery_code
    from app.models.recovery_code import RecoveryCode
    from sqlalchemy import select

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "expire@safebox.example.com",
    })
    user = await find_user_by_email(db_session, "expire@safebox.example.com")
    plaintext, _ = await create_recovery_code(db_session, user.id)
    await db_session.commit()

    await _initiate(client, "expire@safebox.example.com", plaintext)

    # 模拟冷却到期
    rc = (await db_session.execute(
        select(RecoveryCode).where(RecoveryCode.user_id == user.id)
    )).scalar_one()
    rc.cooldown_until = datetime.now(timezone.utc) - timedelta(hours=1)
    await db_session.commit()

    # 新密码登录 -> 200（门放行 + 验证通过 + 清副本）
    r = await client.post("/api/v1/auth/login/email", json={
        "email": "expire@safebox.example.com", "auth_key_hash": "new_hash",
    })
    assert r.status_code == 200

    # 副本已清，状态 active
    await db_session.refresh(rc)
    assert rc.status == "active"
    assert rc.rollback_auth_key_hash is None

    # 旧密码失效
    r = await client.post("/api/v1/auth/login/email", json={
        "email": "expire@safebox.example.com", "auth_key_hash": REGISTER_PAYLOAD["auth_key_hash"],
    })
    assert r.status_code == 401

@pytest.mark.asyncio
async def test_confirm_with_wrong_or_replayed_token_rejected(client: AsyncClient, db_session: AsyncSession):
    """confirm：错 token / 重放已用 token -> 401（M7 两步 + 有状态 token）。"""
    from app.services.auth_service import find_user_by_email
    from app.services.recovery_service import create_recovery_code

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "tok@safebox.example.com",
    })
    user = await find_user_by_email(db_session, "tok@safebox.example.com")
    plaintext, _ = await create_recovery_code(db_session, user.id)
    await db_session.commit()

    # step1
    r = await client.post("/api/v1/auth/recovery/initiate", json={
        "target": "email", "value": "tok@safebox.example.com",
        "recovery_code": plaintext, "new_auth_key_hash": "new_hash",
        "new_password_salt": "ns", "new_kdf_settings": {"algorithm": "pbkdf2", "iterations": 600_000},
    })
    assert r.status_code == 200
    token = r.json()["initiate_token"]

    # 错 token -> 401
    r = await client.post("/api/v1/auth/recovery/confirm", json={
        "initiate_token": "deadbeef" * 8, "new_wrapped_user_key": "nw",
    })
    assert r.status_code == 401

    # 正确 token -> 200（进冷却）
    r = await client.post("/api/v1/auth/recovery/confirm", json={
        "initiate_token": token, "new_wrapped_user_key": "nw",
    })
    assert r.status_code == 200

    # 重放同一 token -> 401（已清 pending_initiate_token）
    r = await client.post("/api/v1/auth/recovery/confirm", json={
        "initiate_token": token, "new_wrapped_user_key": "nw",
    })
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_step1_does_not_enter_cooldown(client: AsyncClient, db_session: AsyncSession):
    """step1 只验码建待确认态，不改正式字段、不进冷却。"""
    from app.services.auth_service import find_user_by_email, verify_auth_key
    from app.services.recovery_service import create_recovery_code
    from app.models.recovery_code import RecoveryCode
    from sqlalchemy import select

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "s1@safebox.example.com",
    })
    user = await find_user_by_email(db_session, "s1@safebox.example.com")
    plaintext, _ = await create_recovery_code(db_session, user.id)
    await db_session.commit()

    r = await client.post("/api/v1/auth/recovery/initiate", json={
        "target": "email", "value": "s1@safebox.example.com",
        "recovery_code": plaintext, "new_auth_key_hash": "new_hash",
        "new_password_salt": "ns", "new_kdf_settings": {"algorithm": "pbkdf2", "iterations": 600_000},
    })
    assert r.status_code == 200
    assert "initiate_token" in r.json()

    # step1 后：正式字段未变（旧密码仍有效），未进冷却
    await db_session.refresh(user)
    assert verify_auth_key(REGISTER_PAYLOAD["auth_key_hash"], user.auth_key_hash)  # 旧密码
    rc = (await db_session.execute(select(RecoveryCode).where(RecoveryCode.user_id == user.id))).scalar_one()
    assert rc.status == "active"
    assert rc.pending_initiate_token is not None  # 待确认态已建


@pytest.mark.asyncio
async def test_cooldown_blocks_sync_data_access(client: AsyncClient, db_session: AsyncSession):
    """冷却期内用旧 access token 调 sync -> 403（D 冷却门，零窗口）。"""
    from app.services.auth_service import find_user_by_email
    from app.services.recovery_service import create_recovery_code

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "cdsync@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    user = await find_user_by_email(db_session, "cdsync@safebox.example.com")
    plaintext, _ = await create_recovery_code(db_session, user.id)
    await db_session.commit()

    # confirm 前能用 token 访问 sync
    r = await client.get("/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00", headers=headers)
    assert r.status_code == 200

    # 进冷却（confirm 触发 revoke + cooldown）
    r = await _initiate(client, "cdsync@safebox.example.com", plaintext)
    assert r.status_code == 200

    # 冷却期内：旧 access token 调 sync -> 403（D 门，零窗口，不等 30min）
    r = await client.get("/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00", headers=headers)
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_reset_password_endpoint_removed(client: AsyncClient):
    """reset-password 端点已移除（无法达成数据恢复）。"""
    r = await client.post("/api/v1/auth/reset-password", json={
        "target": "email", "value": "x@safebox.example.com",
        "verification_code": "123456", "new_auth_key_hash": "h",
        "new_password_salt": "s", "new_password_wrapped": "w",
    })
    assert r.status_code == 404
