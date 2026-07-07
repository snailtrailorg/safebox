"""API 边界场景测试。"""
import pytest
from httpx import AsyncClient

REG = {
    "verification_code": "123456",
    "auth_key_hash": "hash",
    "password_salt": "salt",
    "password_wrapped": "wrapped",
    "recovery_wrapped": "recovery",
    "encrypted_private": "enc_priv",
    "rsa_public_key": "rsa_pub",
    "device_name": "Test",
    "device_public_key": "device_pub",
    "device_wrapped": "device_wrapped",
}


@pytest.mark.asyncio
async def test_login_after_register(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "login-test@safebox.example.com",
        "auth_key_hash": "login_test_hash", "password_salt": "login_test_salt",
        "password_wrapped": "login_test_wrapped", "recovery_wrapped": "login_test_recovery",
        "encrypted_private": "login_test_enc_priv", "rsa_public_key": "login_test_rsa_pub",
    })
    assert resp.status_code == 201

    resp = await client.post("/api/v1/auth/login/email", json={
        "email": "login-test@safebox.example.com", "auth_key_hash": "login_test_hash",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["password_wrapped"] == "login_test_wrapped"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "wrong-pw@safebox.example.com",
        "auth_key_hash": "correct_hash",
    })
    assert resp.status_code == 201

    resp = await client.post("/api/v1/auth/login/email", json={
        "email": "wrong-pw@safebox.example.com", "auth_key_hash": "wrong_hash",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient):
    resp = await client.post("/api/v1/auth/login/email", json={
        "email": "nonexistent@safebox.example.com", "auth_key_hash": "some_hash",
    })
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_sync_push_empty(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "empty-push@safebox.example.com",
    })
    token = resp.json()["access_token"]
    resp = await client.post("/api/v1/sync/push", json={"items": []},
        headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    assert resp.json()["results"] == []


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    payload = {**REG, "email": "dup@safebox.example.com"}
    resp = await client.post("/api/v1/auth/register/email", json=payload)
    assert resp.status_code == 201
    resp = await client.post("/api/v1/auth/register/email", json=payload)
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_push_multiple_item_types(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "types@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    resp = await client.post("/api/v1/sync/push", json={"items": [
        {"client_did": 1, "type": "android", "icon": None, "name": "a1", "description": None, "data": None, "version": 1, "updated_at": "2025-01-01T00:00:00+00:00"},
        {"client_did": 2, "type": "account", "icon": None, "name": "a2", "description": None, "data": None, "version": 1, "updated_at": "2025-01-02T00:00:00+00:00"},
        {"client_did": 3, "type": "file", "icon": None, "name": "a3", "description": None, "data": None, "version": 1, "updated_at": "2025-01-03T00:00:00+00:00"},
    ]}, headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()["results"]) == 3


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    resp = await client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_invalid_jwt_token(client: AsyncClient):
    resp = await client.get("/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00",
        headers={"Authorization": "Bearer invalid.token.here"})
    assert resp.status_code == 401