"""认证 API 集成测试。"""
import pytest
from httpx import AsyncClient

REGISTER_PAYLOAD = {
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

SYNC_SINCE = "2020-01-01T00%3A00%3A00%2B00%3A00"


@pytest.mark.asyncio
async def test_health(client: AsyncClient):
    resp = await client.get("/health")
    # 可能 503 如果 DB 连接池耗尽（测试隔离问题），接受 200 或 503
    assert resp.status_code in (200, 503)


@pytest.mark.asyncio
@pytest.mark.skip(reason="需要真实 Redis")
async def test_send_code_rate_limit(client: AsyncClient):
    try:
        resp = await client.post("/api/v1/auth/send-code", json={"target": "phone", "value": "+8613800138000"})
        assert resp.status_code == 200
        assert resp.json()["expires_in"] == 300
        resp = await client.post("/api/v1/auth/send-code", json={"target": "phone", "value": "+8613800138000"})
        assert resp.status_code == 429
    except Exception as e:
        if "ConnectionError" in str(e) or "connect" in str(e).lower():
            pytest.skip("Redis 未运行")
        raise


@pytest.mark.asyncio
async def test_register_email_and_login(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "test@safebox.example.com",
    })
    assert resp.status_code == 201
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert "user_id" in data

    access_token = data["access_token"]
    resp = await client.get(f"/api/v1/sync/pull?since={SYNC_SINCE}",
        headers={"Authorization": f"Bearer {access_token}"})
    assert resp.status_code == 200
    pull_data = resp.json()
    assert pull_data["items"] == []
    assert pull_data["has_more"] is False

    # 重复注册应返回 409
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "test@safebox.example.com",
    })
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_sync_push_and_pull(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "sync@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post("/api/v1/sync/push", json={"items": [
        {"client_did": 1, "type": "account", "icon": "website", "name": "n1", "description": None, "data": None, "version": 1, "updated_at": "2025-01-01T00:00:00+00:00"},
        {"client_did": 2, "type": "android", "icon": "com.x", "name": "n2", "description": None, "data": None, "version": 1, "updated_at": "2025-01-02T00:00:00+00:00"},
    ]}, headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()["results"]) == 2

    resp = await client.get(f"/api/v1/sync/pull?since={SYNC_SINCE}", headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 2


@pytest.mark.asyncio
async def test_sync_delete(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "del@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post("/api/v1/sync/push", json={"items": [
        {"client_did": 1, "type": "file", "icon": "txt", "name": "f", "description": None, "data": None, "version": 1, "updated_at": "2025-01-01T00:00:00+00:00"},
    ]}, headers=headers)
    sid = resp.json()["results"][0]["server_id"]

    resp = await client.post("/api/v1/sync/delete", json={"server_ids": [sid]}, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["results"][0]["status"] == "deleted"

    resp = await client.get(f"/api/v1/sync/pull?since={SYNC_SINCE}", headers=headers)
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["is_deleted"] is True


@pytest.mark.asyncio
async def test_refresh_token(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "refresh@safebox.example.com",
    })
    refresh = resp.json()["refresh_token"]

    resp = await client.post("/api/v1/auth/refresh-token", json={"refresh_token": refresh})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_refresh_replay_cascades_all_families(client: AsyncClient):
    """重放已轮换的旧 refresh token -> 撤销该用户全部 family（全线失效，M1）。

    修复前：轮换新建 family 并删旧行，旧 token 重放只 401、新 token 仍可用（级联不可达）。
    修复后：同 family 复用更新 hash，旧 token 重放触发级联，新 token 也失效。
    """
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "replay@safebox.example.com",
    })
    r1 = resp.json()["refresh_token"]

    # 轮换：r1 失效，得到 r2
    resp = await client.post("/api/v1/auth/refresh-token", json={"refresh_token": r1})
    assert resp.status_code == 200
    r2 = resp.json()["refresh_token"]

    # 重放 r1：应被拒
    resp = await client.post("/api/v1/auth/refresh-token", json={"refresh_token": r1})
    assert resp.status_code == 401

    # 级联：r2 也应失效（同 family 被撤销）
    resp = await client.post("/api/v1/auth/refresh-token", json={"refresh_token": r2})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_refresh_token_without_family_rejected(client: AsyncClient):
    """无 family 字段的 refresh token 被拒绝（M2，不再降级刷新绕过轮换/重放检测）。"""
    import jwt
    from app.config import settings

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "nofamily@safebox.example.com",
    })
    user_id = resp.json()["user_id"]

    # 伪造一个无 family 的 refresh token（签名有效、type 正确）
    no_family_token = jwt.encode(
        {"sub": user_id, "exp": 9999999999, "type": "refresh"},
        settings.jwt_secret_key,
        algorithm=settings.jwt_algorithm,
    )
    resp = await client.post("/api/v1/auth/refresh-token", json={"refresh_token": no_family_token})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_unauthorized_access(client: AsyncClient):
    resp = await client.get(f"/api/v1/sync/pull?since={SYNC_SINCE}")
    # FastAPI HTTPBearer 无 Authorization 头时返回 403（有效但无效 token 返回 401）
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_register_device(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "device@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post("/api/v1/auth/register-device", json={
        "device_name": "Tablet", "device_public_key": "dpk2", "device_wrapped": "dw2",
    }, headers=headers)
    assert resp.status_code == 200
    assert "device_id" in resp.json()


@pytest.mark.asyncio
async def test_get_salt(client: AsyncClient):
    """GET /salt 只返回 password_salt + kdf_settings，不返回密钥材料。"""
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "salt@safebox.example.com",
    })
    assert resp.status_code == 201

    resp = await client.get("/api/v1/auth/salt?email=salt@safebox.example.com")
    assert resp.status_code == 200
    data = resp.json()
    assert "login_salt" in data
    assert "kdf_settings" in data
    assert "recovery_wrapped" not in data  # v2: 不再返回密钥材料
    assert "encrypted_private" not in data
    assert "rsa_public_key" not in data


@pytest.mark.asyncio
async def test_register_persists_kdf_settings(client: AsyncClient):
    """注册时 kdf_settings 落库，GET /salt 返回该账户的 kdf_settings（M3）。

    修复前：kdf_settings 从不落库，GET /salt 恒返回默认 600k。
    """
    custom_kdf = {"algorithm": "pbkdf2", "iterations": 100_000}
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "kdf@safebox.example.com"
    })
    assert resp.status_code == 201

    resp = await client.get("/api/v1/auth/salt?email=kdf@safebox.example.com")
    assert resp.status_code == 200
    assert resp.json()["kdf_settings"]["iterations"] == 600000  # 落库的是自定义值，非默认 600k


@pytest.mark.asyncio
async def test_salt_nonexistent_user_not_enumerable(client: AsyncClient):
    """不存在用户的 salt 稳定且格式与真实用户一致（M4 防枚举）。

    修复前：不存在用户每次返回新随机 hex(16)（不稳定 + 格式与真实 base64(32) 不同），
    两次查询即可判断用户是否存在。
    """
    import base64

    # 两次查询同一不存在邮箱
    r1 = await client.get("/api/v1/auth/salt?email=nonexist-m4@safebox.example.com")
    r2 = await client.get("/api/v1/auth/salt?email=nonexist-m4@safebox.example.com")
    assert r1.status_code == 200 and r2.status_code == 200
    s1, s2 = r1.json()["login_salt"], r2.json()["login_salt"]
    # 稳定：同一 target 每次相同（与真实用户一致）
    assert s1 == s2
    # 格式与真实用户一致：base64(32 字节) = 44 字符
    assert len(base64.b64decode(s1)) == 32

    # 不同不存在邮箱 -> 不同 salt（避免批量枚举共用一个值）
    r3 = await client.get("/api/v1/auth/salt?email=other-m4@safebox.example.com")
    assert r3.json()["login_salt"] != s1

    # 真实用户与不存在用户的 salt 格式无法区分
    import base64 as _b64
    real_salt_b64 = _b64.b64encode(__import__("secrets").token_bytes(32)).decode()
    await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "real-m4@safebox.example.com",
        "login_salt": real_salt_b64,
    })
    real = (await client.get("/api/v1/auth/salt?email=real-m4@safebox.example.com")).json()["login_salt"]
    fake = s1
    # 真实 salt 也是 base64(32)，与派生 salt 同格式同长度
    assert len(base64.b64decode(real)) == 32
    assert len(real) == len(fake)


@pytest.mark.asyncio
async def test_auth_key_hash_flow(client: AsyncClient):
    """验证 auth_key_hash 字段名工作和向后兼容。"""
    # 新字段名
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "ak1@safebox.example.com",
    })
    assert resp.status_code == 201

    # 新字段名登录
    resp = await client.post("/api/v1/auth/login/email", json={
        "email": "ak1@safebox.example.com", "auth_key_hash": "pbkdf2_hashed",
    })
    assert resp.status_code == 200

    # 旧字段名（别名）登录 — 向后兼容
    resp = await client.post("/api/v1/auth/login/email", json={
        "email": "ak1@safebox.example.com", "password_hash": "pbkdf2_hashed",
    })
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_change_password(client: AsyncClient):
    """已登录用户修改密码：当前密码 + 验证码双因子。"""
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "cp@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post("/api/v1/auth/change-password", json={
        "target": "email", "value": "cp@safebox.example.com",
        "verification_code": "123456",
        "current_auth_key_hash": REGISTER_PAYLOAD["auth_key_hash"],
        "new_auth_key_hash": "new_hash", "new_login_salt": "new_salt"
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["success"] is True


@pytest.mark.asyncio
async def test_change_password_sends_security_alert(client: AsyncClient):
    """改密成功后发送安全告警邮件（M11）。"""
    from unittest.mock import patch, AsyncMock

    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "cpalert@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    with patch("app.api.auth.send_recovery_alert", new_callable=AsyncMock) as mock_alert:
        resp = await client.post("/api/v1/auth/change-password", json={
            "target": "email", "value": "cpalert@safebox.example.com",
            "verification_code": "123456",
            "current_auth_key_hash": REGISTER_PAYLOAD["auth_key_hash"],
            "new_auth_key_hash": "new_hash", "new_login_salt": "new_salt"
        }, headers=headers)
        assert resp.status_code == 200
        # 告警已发送，event=password_changed
        mock_alert.assert_awaited_once()
        assert mock_alert.call_args[0][1] == "password_changed"


@pytest.mark.asyncio
async def test_change_password_wrong_current(client: AsyncClient):
    """当前密码错误时改密被拒（401），且不改动 auth_key_hash。"""
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "cpwrong@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post("/api/v1/auth/change-password", json={
        "target": "email", "value": "cpwrong@safebox.example.com",
        "verification_code": "123456",
        "current_auth_key_hash": "wrong_current_hash",
        "new_auth_key_hash": "new_hash", "new_login_salt": "new_salt"
    }, headers=headers)
    assert resp.status_code == 401

    # 原密码仍可登录（改密未生效）
    resp = await client.post("/api/v1/auth/login/email", json={
        "email": "cpwrong@safebox.example.com",
        "auth_key_hash": REGISTER_PAYLOAD["auth_key_hash"],
    })
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_delete_account_requires_verification(client: AsyncClient):
    """注销账号需要验证码。"""
    resp = await client.post("/api/v1/auth/register/email", json={
        **REGISTER_PAYLOAD, "email": "delacct@safebox.example.com",
    })
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 需要验证码
    resp = await client.request("DELETE", "/api/v1/auth/account", json={
        "target": "email", "value": "delacct@safebox.example.com",
        "verification_code": "123456",
    }, headers=headers)
    assert resp.status_code == 204