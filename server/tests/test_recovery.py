"""助记词服务 + API 级测试（主密码合并模型）。"""
import pytest
from httpx import AsyncClient
from app.services.recovery_service import (
    hash_mnemonic, verify_mnemonic,
    generate_mnemonic_plaintext, generate_mnemonic_hmac_salt,
)

REG = {
    "verification_code": "123456",
    "local_password_hash": "pbkdf2_hashed",
    "local_salt": "salt",
    "encrypted_user_key": "fake-euk",
    "mnemonic_salt": "rec-salt",
    "mnemonic": "abandon ability able about above absent absorb abstract accuse achieve acid acoustic",
    "mnemonic_hmac_salt": "rec-code-salt",
    "device_name": "Test Device",
    "device_public_key": "device_pub",
    "device_wrapped": "device_wrapped",
}
PT = REG["mnemonic"]

# ── 纯函数测试 ──────────────────────────────────────


def test_generate_mnemonic_is_bip39():
    assert len(generate_mnemonic_plaintext().split()) == 12


def test_generate_mnemonic_unique():
    codes = {generate_mnemonic_plaintext() for _ in range(50)}
    assert len(codes) >= 45


def test_hash_and_verify():
    s = generate_mnemonic_hmac_salt()
    h = hash_mnemonic("t", s)
    assert len(h) == 64
    assert verify_mnemonic("t", s, h)
    assert not verify_mnemonic("x", s, h)


def test_hash_deterministic():
    assert hash_mnemonic("t", "s") == hash_mnemonic("t", "s")


def test_hash_case_sensitive():
    assert hash_mnemonic("A", "s") == hash_mnemonic("a", "s")


def test_hash_whitespace_sensitive():
    assert hash_mnemonic("a b", "s") == hash_mnemonic("a  b", "s")


def test_generate_salt_unique():
    salts = {generate_mnemonic_hmac_salt() for _ in range(50)}
    assert len(salts) == 50


# ── API 级测试 ──────────────────────────────────────


@pytest.mark.asyncio
async def test_initiate_returns_encrypted_user_key(client: AsyncClient):
    """initiate 验助记词 -> 返回 encrypted_user_key + mnemonic_salt（换设备用）。"""
    await client.post("/api/v1/auth/register/email", json={**REG, "email": "init@safebox.example.com"})
    r = await client.post("/api/v1/auth/recovery/initiate", json={
        "target": "email", "value": "init@safebox.example.com", "mnemonic": PT})
    assert r.status_code == 200
    data = r.json()
    assert "encrypted_user_key" in data and "mnemonic_salt" in data


@pytest.mark.asyncio
async def test_initiate_wrong_mnemonic_returns_401(client: AsyncClient):
    await client.post("/api/v1/auth/register/email", json={**REG, "email": "wrong@safebox.example.com"})
    r = await client.post("/api/v1/auth/recovery/initiate", json={
        "target": "email", "value": "wrong@safebox.example.com", "mnemonic": "wrong " * 11 + "wrong"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_initiate_nonexistent_user_returns_401(client: AsyncClient):
    """不存在用户 -> 401（不返回 404，防枚举）。"""
    r = await client.post("/api/v1/auth/recovery/initiate", json={
        "target": "email", "value": "noexist@safebox.example.com", "mnemonic": PT})
    assert r.status_code == 401
