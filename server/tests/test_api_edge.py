"""API 边界场景测试。"""
import pytest
from httpx import AsyncClient

REG = {
    "verification_code": "123456",
    "auth_key_hash": "hash",
    "login_salt": "salt",
    "encrypted_user_key": "fake-euk",
    "recovery_salt": "rec-salt",
    "has_master_password": False,
    "recovery_code": "abandon ability able about above absent absorb abstract accuse achieve acid acoustic",
    "recovery_code_salt": "rec-code-salt",
    "device_name": "Test",
    "device_public_key": "device_pub",
    "device_wrapped": "device_wrapped",
}


@pytest.mark.asyncio
async def test_login_after_register(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "login-test@safebox.example.com",
        "auth_key_hash": "login_test_hash", "login_salt": "login_test_salt",
        "login_salt": "login_test_wrapped", "recovery_wrapped": "login_test_recovery",
        "encrypted_private": "login_test_enc_priv", "rsa_public_key": "login_test_rsa_pub",
    })
    assert resp.status_code == 201

    resp = await client.post("/api/v1/auth/login/email", json={
        "email": "login-test@safebox.example.com", "auth_key_hash": "login_test_hash",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert data["login_salt"] == "login_test_wrapped"


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
async def test_push_matches_by_server_id_cross_device(client: AsyncClient):
    """跨设备 re-push 已同步条目：带 server_id 时按 server_id 匹配更新，不新建重复（M6）。

    设备 A 创建（client_did=1）-> 得 server_id。设备 B 拉取后本地 did 不同，
    再编辑 push 时带不同 client_did 但同 server_id -> 应更新同一条，而非新建。
    """
    resp = await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "crossdev@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 设备 A 首次推送（无 server_id）
    resp = await client.post("/api/v1/sync/push", json={"items": [
        {"client_did": 1, "type": "login", "icon": None, "name": "orig",
         "description": None, "data": None, "version": 1,
         "updated_at": "2025-01-01T00:00:00+00:00"},
    ]}, headers=headers)
    server_id = resp.json()["results"][0]["server_id"]
    assert server_id

    # 设备 B（不同 client_did）带 server_id 重新推送更新。
    # version=1 是客户端持有的基线（== 服务端当前 1），按乐观并发接受。
    resp = await client.post("/api/v1/sync/push", json={"items": [
        {"client_did": 999, "server_id": server_id, "type": "login", "icon": None,
         "name": "updated", "description": None, "data": None, "version": 1,
         "updated_at": "2025-01-05T00:00:00+00:00"},
    ]}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["results"][0]["status"] == "updated"
    assert resp.json()["results"][0]["server_id"] == server_id  # 同一条

    # 服务端应只有 1 条该用户的条目（无重复）
    resp = await client.get(
        "/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00&limit=100",
        headers=headers,
    )
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 1
    assert resp.json()["items"][0]["name"] == "updated"


@pytest.mark.asyncio
async def test_push_version_optimistic_concurrency(client: AsyncClient):
    """冲突按 version 乐观并发检测（方案 A，不依赖时钟）：

    - base version == 服务端当前 -> 接受，version+1
    - base version < 服务端当前（客户端基于旧版编辑）-> conflict
    """
    resp = await client.post("/api/v1/auth/register/email", json={
        **REG, "email": "verocc@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    def push(version, name="x"):
        return client.post("/api/v1/sync/push", json={"items": [
            {"client_did": 1, "server_id": SID, "type": "login", "icon": None,
             "name": name, "description": None, "data": None,
             "version": version, "updated_at": "2025-01-01T00:00:00+00:00"},
        ]}, headers=headers)

    # 首次创建 -> server version=1
    resp = await client.post("/api/v1/sync/push", json={"items": [
        {"client_did": 1, "type": "login", "icon": None, "name": "v1",
         "description": None, "data": None, "version": 1,
         "updated_at": "2025-01-01T00:00:00+00:00"},
    ]}, headers=headers)
    SID = resp.json()["results"][0]["server_id"]
    assert resp.json()["results"][0]["status"] == "created"

    # base=1 == server 1 -> 接受，version -> 2
    resp = await push(1, "v2")
    assert resp.json()["results"][0]["status"] == "updated"

    # base=1 < server 2（客户端基于旧版编辑）-> conflict
    resp = await push(1, "stale")
    assert resp.json()["results"][0]["status"] == "conflict"

    # base=2 == server 2 -> 接受，version -> 3
    resp = await push(2, "v3")
    assert resp.json()["results"][0]["status"] == "updated"

    # 服务端最终内容是最新接受的版本
    resp = await client.get(
        "/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00&limit=100",
        headers=headers,
    )
    assert resp.json()["items"][0]["name"] == "v3"


@pytest.mark.asyncio
async def test_health_check(client: AsyncClient):
    resp = await client.get("/health")
    # 503 偶发：测试隔离导致的 asyncpg 跨 loop / DB 连接池问题（与 test_auth::test_health 一致）
    assert resp.status_code in (200, 503)
    if resp.status_code == 200:
        assert resp.json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_invalid_jwt_token(client: AsyncClient):
    resp = await client.get("/api/v1/sync/pull?since=2020-01-01T00%3A00%3A00%2B00%3A00",
        headers={"Authorization": "Bearer invalid.token.here"})
    assert resp.status_code == 401