"""SRP 测试 helper：用 srp_service 算客户端值 + 内存 FakeRedis。"""

from httpx import AsyncClient

from app.services import srp_service as srp

TEST_MNEMONIC = "abandon ability able about above absent absorb abstract accuse achieve acid acoustic"
TEST_PASSWORD = "MasterPass123!"
TEST_SRP_SALT_HEX = "00112233445566778899aabbccddeeff"


def make_srp_verifier(email: str, mnemonic: str = TEST_MNEMONIC,
                      password: str = TEST_PASSWORD, srp_salt_hex: str = TEST_SRP_SALT_HEX) -> str:
    """派生 SRP verifier v 的 hex（注册 payload 用）。"""
    srp_salt = bytes.fromhex(srp_salt_hex)
    x = srp.derive_x(password, mnemonic, srp_salt, email)
    v = srp.compute_verifier(x)
    return hex(v)[2:]


def register_payload(email: str, **overrides) -> dict:
    """生成注册 payload（含按 email 派生的 SRP verifier，删除旧 local_password_hash/mnemonic）。"""
    payload = {
        "verification_code": "123456",
        "srp_verifier": make_srp_verifier(email),
        "srp_salt": TEST_SRP_SALT_HEX,
        "local_salt": "salt",
        "encrypted_user_key": "fake-euk",
        "mnemonic_salt": "rec-salt",
        "device_name": "Test Device",
        "device_public_key": "device_pub",
        "device_wrapped": "device_wrapped",
    }
    payload.update(overrides)
    payload["email"] = email
    return payload


async def srp_login(client: AsyncClient, target_type: str, target: str,
                    mnemonic: str = TEST_MNEMONIC, password: str = TEST_PASSWORD,
                    srp_salt_hex: str = TEST_SRP_SALT_HEX, email: str = None):
    """完整 SRP 两步登录（challenge A->B，verify M1->M2+token），返回 verify 响应。

    email 用于派生 x（默认=target）。"""
    email = email or target
    a = srp.generate_private_ephemeral()
    A = srp.compute_client_public(a)
    resp = await client.post("/api/v1/auth/login/srp/challenge", json={
        "target_type": target_type, "target": target, "A": hex(A)[2:],
    })
    if resp.status_code != 200:
        return resp
    body = resp.json()
    B = int(body["B"], 16)
    session_id = body["session_id"]
    srp_salt = bytes.fromhex(srp_salt_hex)
    x = srp.derive_x(password, mnemonic, srp_salt, email)
    u = srp.compute_u(A, B)
    S = srp.compute_client_S(B, a, u, x)
    K = srp.compute_K(S)
    M1 = srp.compute_M1(A, B, K)
    return await client.post("/api/v1/auth/login/srp/verify", json={
        "session_id": session_id, "M1": M1.hex(),
    })


class FakeRedis:
    """内存 Redis mock，支持 verification_service 用到的命令（SRP session 存取 + 限流占位）。"""
    def __init__(self):
        self.store = {}

    async def setex(self, key, ttl, value):
        self.store[key] = value

    async def get(self, key):
        return self.store.get(key)

    async def getdel(self, key):
        return self.store.pop(key, None)

    async def set(self, key, value, **kw):
        self.store[key] = value
        return True

    async def incr(self, key):
        v = int(self.store.get(key, "0")) + 1
        self.store[key] = str(v)
        return v

    async def expire(self, key, ttl):
        return True

    async def delete(self, *keys):
        n = 0
        for k in keys:
            if k in self.store:
                del self.store[k]
                n += 1
        return n

    async def zadd(self, key, mapping):
        return 0

    async def zcard(self, key):
        return 0

    async def zremrangebyscore(self, key, mn, mx):
        return 0
