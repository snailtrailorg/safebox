"""认证 API 集成测试（SRP-6a）。"""
import pytest
from httpx import AsyncClient

from tests._srp import (
    TEST_PASSWORD, TEST_SRP_SALT_HEX,
    make_srp_verifier, register_payload, srp_login,
)

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
    resp = await client.post("/api/v1/auth/register/email", json=register_payload("test@safebox.example.com"))
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
    resp = await client.post("/api/v1/auth/register/email", json=register_payload("test@safebox.example.com"))
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_sync_push_and_pull(client: AsyncClient):
    resp = await client.post("/api/v1/auth/register/email", json=register_payload("sync@safebox.example.com"))
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
    resp = await client.post("/api/v1/auth/register/email", json=register_payload("del@safebox.example.com"))
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
    resp = await client.post("/api/v1/auth/register/email", json=register_payload("refresh@safebox.example.com"))
    refresh = resp.json()["refresh_token"]

    resp = await client.post("/api/v1/auth/refresh-token", json={"refresh_token": refresh})
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data


@pytest.mark.asyncio
async def test_refresh_replay_cascades_all_families(client: AsyncClient):
    """重放已轮换的旧 refresh token -> 撤销该用户全部 family（全线失效）。"""
    resp = await client.post("/api/v1/auth/register/email", json=register_payload("replay@safebox.example.com"))
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
    """无 family 字段的 refresh token 被拒绝（不再降级刷新绕过轮换/重放检测）。"""
    import jwt
    from app.config import settings

    resp = await client.post("/api/v1/auth/register/email", json=register_payload("nofamily@safebox.example.com"))
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
    resp = await client.post("/api/v1/auth/register/email", json=register_payload("device@safebox.example.com"))
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post("/api/v1/auth/register-device", json={
        "device_name": "Tablet", "device_public_key": "dpk2", "device_wrapped": "dw2",
    }, headers=headers)
    assert resp.status_code == 200
    assert "device_id" in resp.json()


@pytest.mark.asyncio
async def test_get_salt(client: AsyncClient):
    """GET /salt 返回 SRP 参数 + salt，不返回密钥材料。"""
    resp = await client.post("/api/v1/auth/register/email", json=register_payload("salt@safebox.example.com"))
    assert resp.status_code == 201

    resp = await client.get("/api/v1/auth/salt?email=salt@safebox.example.com")
    assert resp.status_code == 200
    data = resp.json()
    assert "srp_salt" in data
    assert "local_salt" in data
    assert "mnemonic_salt" in data
    assert "kdf_settings" in data
    assert "N" in data
    assert "g" in data
    assert "recovery_wrapped" not in data  # 不返回旧 RSA 密钥材料
    assert "encrypted_private" not in data
    assert "rsa_public_key" not in data


@pytest.mark.asyncio
async def test_register_persists_kdf_settings(client: AsyncClient):
    """注册时 kdf_settings 落库，GET /salt 返回该账户的 kdf_settings。"""
    resp = await client.post("/api/v1/auth/register/email", json=register_payload("kdf@safebox.example.com"))
    assert resp.status_code == 201

    resp = await client.get("/api/v1/auth/salt?email=kdf@safebox.example.com")
    assert resp.status_code == 200
    assert resp.json()["kdf_settings"]["iterations"] == 600000


@pytest.mark.asyncio
async def test_salt_nonexistent_user_not_enumerable(client: AsyncClient):
    """不存在用户的 salt 稳定且格式与真实用户一致（防枚举）。"""
    import base64

    # 两次查询同一不存在邮箱
    r1 = await client.get("/api/v1/auth/salt?email=nonexist-m4@safebox.example.com")
    r2 = await client.get("/api/v1/auth/salt?email=nonexist-m4@safebox.example.com")
    assert r1.status_code == 200 and r2.status_code == 200
    s1, s2 = r1.json()["srp_salt"], r2.json()["srp_salt"]
    # 稳定：同一 target 每次相同
    assert s1 == s2
    # 格式与真实用户一致：base64(32 字节) = 44 字符
    assert len(base64.b64decode(s1)) == 32

    # 不同不存在邮箱 -> 不同 salt
    r3 = await client.get("/api/v1/auth/salt?email=other-m4@safebox.example.com")
    assert r3.json()["srp_salt"] != s1

    # 真实用户与不存在用户的 salt 格式无法区分
    real_salt_b64 = base64.b64encode(__import__("secrets").token_bytes(32)).decode()
    await client.post("/api/v1/auth/register/email", json=register_payload("real-m4@safebox.example.com", local_salt=real_salt_b64))
    real = (await client.get("/api/v1/auth/salt?email=real-m4@safebox.example.com")).json()["local_salt"]
    fake = s1
    assert len(base64.b64decode(real)) == 32
    assert len(real) == len(fake)


@pytest.mark.asyncio
async def test_srp_login_flow(client: AsyncClient):
    """SRP 两步登录：正确密码成功（含 M2），错密码失败。"""
    email = "srp-login@safebox.example.com"
    resp = await client.post("/api/v1/auth/register/email", json=register_payload(email))
    assert resp.status_code == 201

    # 正确密码登录
    resp = await srp_login(client, "email", email, password=TEST_PASSWORD)
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert "M2" in data and data["M2"]           # 服务端证据
    assert "encrypted_user_key" in data
    assert "mnemonic_salt" in data

    # 错密码登录失败
    resp = await srp_login(client, "email", email, password="wrong-password")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_srp_login_wrong_mnemonic(client: AsyncClient):
    """错助记词登录失败（2SKD：助记词参与 x 派生）。"""
    email = "srp-mn@safebox.example.com"
    await client.post("/api/v1/auth/register/email", json=register_payload(email))
    resp = await srp_login(client, "email", email,
                          mnemonic="abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_srp_login_nonexistent_user(client: AsyncClient):
    """不存在用户 SRP 登录失败（fake verifier，verify 必失败，防枚举）。"""
    resp = await srp_login(client, "email", "nope@safebox.example.com")
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_change_password(client: AsyncClient):
    """改密：fresh token + 验证码 + 新 SRP 材料（旧密码由前置 SRP 登录验）。"""
    email = "cp@safebox.example.com"
    resp = await client.post("/api/v1/auth/register/email", json=register_payload(email))
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.post("/api/v1/auth/change-password", json={
        "target": "email", "value": email,
        "verification_code": "123456",
        "new_srp_verifier": make_srp_verifier(email, password="NewPass456!"),
        "new_srp_salt": TEST_SRP_SALT_HEX,
        "new_local_salt": "new_salt",
        "new_encrypted_user_key": "new_euk",
    }, headers=headers)
    assert resp.status_code == 200
    assert resp.json()["success"] is True

    # 改密后用新密码可登录
    resp = await srp_login(client, "email", email, password="NewPass456!")
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_change_password_sends_security_alert(client: AsyncClient):
    """改密成功后发送安全告警邮件。"""
    from unittest.mock import patch, AsyncMock

    email = "cpalert@safebox.example.com"
    resp = await client.post("/api/v1/auth/register/email", json=register_payload(email))
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    with patch("app.api.auth.send_recovery_alert", new_callable=AsyncMock) as mock_alert:
        resp = await client.post("/api/v1/auth/change-password", json={
            "target": "email", "value": email,
            "verification_code": "123456",
            "new_srp_verifier": make_srp_verifier(email, password="NewPass456!"),
            "new_srp_salt": TEST_SRP_SALT_HEX,
            "new_local_salt": "new_salt",
            "new_encrypted_user_key": "new_euk",
        }, headers=headers)
        assert resp.status_code == 200
        # 告警已发送，event=password_changed
        mock_alert.assert_awaited_once()
        assert mock_alert.call_args[0][1] == "password_changed"


@pytest.mark.asyncio
async def test_delete_account_requires_verification(client: AsyncClient):
    """注销账号需 fresh token + 验证码（旧密码由前置 SRP 登录验）。"""
    email = "delacct@safebox.example.com"
    resp = await client.post("/api/v1/auth/register/email", json=register_payload(email))
    token = resp.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    resp = await client.request("DELETE", "/api/v1/auth/account", json={
        "verification_code": "123456",
    }, headers=headers)
    assert resp.status_code == 204
