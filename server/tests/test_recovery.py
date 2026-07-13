"""恢复码服务 + API 级测试（模型 D）。"""
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from app.services.recovery_service import (
    hash_recovery_code, verify_recovery_code,
    generate_recovery_code_plaintext, generate_recovery_code_salt,
    sign_recovery_token, verify_recovery_token,
)

REG = {
    "verification_code": "123456",
    "auth_key_hash": "pbkdf2_hashed",
    "login_salt": "salt",
    "encrypted_user_key": "fake-euk",
    "recovery_salt": "rec-salt",
    "has_master_password": False,
    "recovery_code": "abandon ability able about above absent absorb abstract accuse achieve acid acoustic",
    "recovery_code_salt": "rec-code-salt",
    "device_name": "Test Device",
    "device_public_key": "device_pub",
    "device_wrapped": "device_wrapped",
}
PT = REG["recovery_code"]

# ── 纯函数测试 ──────────────────────────────────────


def test_generate_recovery_code_is_bip39():
    assert len(generate_recovery_code_plaintext().split()) == 12


def test_generate_recovery_code_unique():
    codes = {generate_recovery_code_plaintext() for _ in range(50)}
    assert len(codes) >= 45


def test_hash_and_verify():
    s = generate_recovery_code_salt()
    h = hash_recovery_code("t", s)
    assert len(h) == 64
    assert verify_recovery_code("t", s, h)
    assert not verify_recovery_code("x", s, h)


def test_hash_deterministic():
    assert hash_recovery_code("t", "s") == hash_recovery_code("t", "s")


def test_hash_case_sensitive():
    assert hash_recovery_code("A", "s") == hash_recovery_code("a", "s")


def test_hash_whitespace_sensitive():
    assert hash_recovery_code("a b", "s") == hash_recovery_code("a  b", "s")


def test_sign_and_verify_token():
    tok = sign_recovery_token({"sub": "u", "action": "a", "rc_id": "r"})
    assert verify_recovery_token(tok)


def test_verify_invalid_token():
    assert verify_recovery_token("x") is None


def test_generate_salt_unique():
    salts = {generate_recovery_code_salt() for _ in range(50)}
    assert len(salts) == 50


# ── API 级测试 ──────────────────────────────────────


def _step1(email, code=PT, nh="new_hash"):
    return {"target": "email", "value": email,
            "recovery_code": code, "new_auth_key_hash": nh, "new_login_salt": "ns"}


async def _init(client, email, code=PT):
    r = await client.post("/api/v1/auth/recovery/initiate", json=_step1(email, code))
    assert r.status_code == 200
    tok = r.json()["initiate_token"]
    r2 = await client.post("/api/v1/auth/recovery/confirm", json={"initiate_token": tok})
    assert r2.status_code == 200
    return r2


@pytest.mark.asyncio
async def test_recovery_no_permanent_lockout(client: AsyncClient):
    """恢复码 132bit 不可暴力枚举，不累积失败计数、不永久锁定。
    连错 5 次后仍可用正确恢复码发起恢复。"""
    resp = await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "lock@safebox.example.com",
    })
    assert resp.status_code in (200, 201)
    w = {**_step1("lock@safebox.example.com"), "recovery_code": "wrong " * 11 + "wrong"}
    for _ in range(5):
        assert (await client.post("/api/v1/auth/recovery/initiate", json=w)).status_code == 401
    # 正确恢复码仍可用（不锁定）
    g = _step1("lock@safebox.example.com", PT)
    assert (await client.post("/api/v1/auth/recovery/initiate", json=g)).status_code == 200


@pytest.mark.asyncio
async def test_recovery_reinitiate_during_cooldown_returns_409(client: AsyncClient):
    await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "cooldown@safebox.example.com",
    })
    p = _step1("cooldown@safebox.example.com")
    r = await client.post("/api/v1/auth/recovery/initiate", json=p)
    assert r.status_code == 200
    r2 = await client.post("/api/v1/auth/recovery/confirm", json={"initiate_token": r.json()["initiate_token"]})
    assert r2.status_code == 200
    assert (await client.post("/api/v1/auth/recovery/initiate", json=p)).status_code == 409
    w = {**p, "recovery_code": "wrong " * 11 + "wrong"}
    assert (await client.post("/api/v1/auth/recovery/initiate", json=w)).status_code == 401


@pytest.mark.asyncio
async def test_initiate_writes_new_password_and_enters_cooldown(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "init@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/api/v1/auth/recovery/initiate", json=_step1("init@safebox.example.com"))
    assert r.status_code == 200
    data = r.json()
    assert "encrypted_user_key" in data and "recovery_salt" in data and "initiate_token" in data
    r2 = await client.post("/api/v1/auth/recovery/confirm", json={"initiate_token": data["initiate_token"]})
    assert r2.status_code == 200
    assert "cooldown_until" in r2.json()
    st = await client.get("/api/v1/auth/recovery/status", headers=headers)
    assert st.json()["status"] == "cooldown"


@pytest.mark.asyncio
async def test_login_blocked_during_cooldown(client: AsyncClient):
    await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "block@safebox.example.com",
    })
    await _init(client, "block@safebox.example.com")
    lp = {"email": "block@safebox.example.com"}
    assert (await client.post("/api/v1/auth/login/email", json={**lp, "auth_key_hash": "new_hash"})).status_code == 403
    assert (await client.post("/api/v1/auth/login/email", json={**lp, "auth_key_hash": REG["auth_key_hash"]})).status_code == 403


@pytest.mark.asyncio
async def test_accelerate_clears_cooldown_and_allows_login(client: AsyncClient, db_session: AsyncSession):
    from app.models.recovery_code import RecoveryCode
    from sqlalchemy import select
    await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "acc@safebox.example.com",
    })
    rc = (await db_session.execute(select(RecoveryCode))).scalar_one()
    r = await client.post("/api/v1/auth/recovery/initiate", json=_step1("acc@safebox.example.com"))
    r2 = await client.post("/api/v1/auth/recovery/confirm", json={"initiate_token": r.json()["initiate_token"]})
    assert r2.status_code == 200
    await db_session.refresh(rc)
    cd = rc.cooldown_until.isoformat() if rc.cooldown_until else ""
    at = sign_recovery_token({"sub": str(rc.user_id), "action": "accelerate", "rc_id": str(rc.id), "cd": cd})
    assert (await client.post("/api/v1/auth/recovery/accelerate", json={
        "signed_token": at, "verification_code": "123456"})).status_code == 204
    await db_session.refresh(rc)
    assert rc.status == "active"
    lp = {"email": "acc@safebox.example.com", "auth_key_hash": "new_hash"}
    assert (await client.post("/api/v1/auth/login/email", json=lp)).status_code == 200


@pytest.mark.asyncio
async def test_freeze_rolls_back_to_old_password(client: AsyncClient, db_session: AsyncSession):
    from app.models.recovery_code import RecoveryCode
    from sqlalchemy import select
    await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "frz@safebox.example.com",
    })
    rc = (await db_session.execute(select(RecoveryCode))).scalar_one()
    r = await client.post("/api/v1/auth/recovery/initiate", json=_step1("frz@safebox.example.com"))
    r2 = await client.post("/api/v1/auth/recovery/confirm", json={"initiate_token": r.json()["initiate_token"]})
    assert r2.status_code == 200
    await db_session.refresh(rc)
    cd = rc.cooldown_until.isoformat() if rc.cooldown_until else ""
    ft = sign_recovery_token({"sub": str(rc.user_id), "action": "freeze", "rc_id": str(rc.id), "cd": cd})
    assert (await client.post("/api/v1/auth/recovery/freeze", json={"signed_token": ft})).status_code == 204
    lp = {"email": "frz@safebox.example.com"}
    assert (await client.post("/api/v1/auth/login/email", json={**lp, "auth_key_hash": REG["auth_key_hash"]})).status_code == 200
    assert (await client.post("/api/v1/auth/login/email", json={**lp, "auth_key_hash": "new_hash"})).status_code == 401


@pytest.mark.asyncio
async def test_cooldown_expired_new_password_login_clears_rollback(client: AsyncClient, db_session: AsyncSession):
    from datetime import datetime, timedelta, timezone
    from app.models.recovery_code import RecoveryCode
    from sqlalchemy import select
    await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "expire@safebox.example.com",
    })
    rc = (await db_session.execute(select(RecoveryCode))).scalar_one()
    r = await client.post("/api/v1/auth/recovery/initiate", json=_step1("expire@safebox.example.com"))
    r2 = await client.post("/api/v1/auth/recovery/confirm", json={"initiate_token": r.json()["initiate_token"]})
    assert r2.status_code == 200
    rc.cooldown_until = datetime.now(timezone.utc) - timedelta(hours=1)
    await db_session.commit()
    lp = {"email": "expire@safebox.example.com", "auth_key_hash": "new_hash"}
    assert (await client.post("/api/v1/auth/login/email", json=lp)).status_code == 200
    await db_session.refresh(rc)
    assert rc.status == "active" and rc.rollback_auth_key_hash is None
    assert (await client.post("/api/v1/auth/login/email", json={
        "email": "expire@safebox.example.com", "auth_key_hash": REG["auth_key_hash"]})).status_code == 401


@pytest.mark.asyncio
async def test_confirm_with_wrong_or_replayed_token_rejected(client: AsyncClient):
    await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "tok@safebox.example.com",
    })
    r = await client.post("/api/v1/auth/recovery/initiate", json=_step1("tok@safebox.example.com"))
    tok = r.json()["initiate_token"]
    assert (await client.post("/api/v1/auth/recovery/confirm", json={"initiate_token": "deadbeef" * 8})).status_code == 401
    assert (await client.post("/api/v1/auth/recovery/confirm", json={"initiate_token": tok})).status_code == 200
    assert (await client.post("/api/v1/auth/recovery/confirm", json={"initiate_token": tok})).status_code == 401


@pytest.mark.asyncio
async def test_step1_does_not_enter_cooldown(client: AsyncClient, db_session: AsyncSession):
    from app.models.recovery_code import RecoveryCode
    from sqlalchemy import select
    await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "s1@safebox.example.com",
    })
    r = await client.post("/api/v1/auth/recovery/initiate", json=_step1("s1@safebox.example.com"))
    assert r.status_code == 200
    rc = (await db_session.execute(select(RecoveryCode))).scalar_one()
    assert rc.status == "active" and rc.pending_initiate_token is not None


@pytest.mark.asyncio
async def test_cooldown_blocks_sync_data_access(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "cdsync@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    r = await client.post("/api/v1/auth/recovery/initiate", json=_step1("cdsync@safebox.example.com"))
    r2 = await client.post("/api/v1/auth/recovery/confirm", json={"initiate_token": r.json()["initiate_token"]})
    assert r2.status_code == 200
    since = "2020-01-01T00%3A00%3A00%2B00%3A00"
    assert (await client.get(f"/api/v1/sync/pull?since={since}", headers=headers)).status_code == 403


@pytest.mark.asyncio
async def test_reset_password_endpoint_removed(client: AsyncClient):
    assert (await client.post("/api/v1/auth/reset-password", json={})).status_code == 404
