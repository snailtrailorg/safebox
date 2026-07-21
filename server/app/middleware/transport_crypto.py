"""SRP K 通信加密 middleware（纯 ASGI）。

BaseHTTPMiddleware 的 call_next 用自己的 receive wrapper（读原 body），不传
dispatch 里设的新 receive -> body 修改不传到端点。故用纯 ASGI 直接控制
scope/receive/send，确保解密后的 body 传到端点。

认证 API（access token + device_id + K）：
- POST/PUT/DELETE body：客户端 AES-GCM(K) 加密，header X-Safebox-Encrypted: 1（强制，防 downgrade）
- 响应 body：服务端 AES-GCM(K) 加密
- K 从 Redis session_key:{device_id} 取（SRP verify 时存，refresh 续）；不存 -> 401 session expired
- 无 device_id（旧 token）-> 透传（Depends 验 token）

防重放：AES-GCM nonce 随机 + GCM tag 认证完整性。
"""
import json as _json
import jwt as jwt_lib

from app.config import settings
from app.services import transport_crypto
from app.services.verification_service import get_session_key

# 登录前 + refresh + 非认证路径不加密
ENCRYPT_FREE_PREFIXES = (
    "/api/v1/auth/salt",
    "/api/v1/auth/send-code",
    "/api/v1/auth/register",
    "/api/v1/auth/login",
    "/api/v1/auth/refresh-token",
)
ENCRYPT_FREE_EXACT = {"/health", "/docs", "/redoc", "/openapi.json"}
BODY_METHODS = ("POST", "PUT", "DELETE", "PATCH")


class TransportCryptoMiddleware:
    """纯 ASGI middleware（__init__(app) + __call__(scope, receive, send)）。"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope["path"]
        if path in ENCRYPT_FREE_EXACT or any(path.startswith(p) for p in ENCRYPT_FREE_PREFIXES):
            await self.app(scope, receive, send)
            return
        if not path.startswith("/api/v1/"):
            await self.app(scope, receive, send)
            return

        headers = dict(scope["headers"])
        auth = headers.get(b"authorization", b"")
        if not auth.startswith(b"Bearer "):
            await self.app(scope, receive, send)  # 无 token（Depends 401）
            return
        token = auth[7:].decode("latin-1")
        try:
            payload = jwt_lib.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
        except Exception:
            await self.app(scope, receive, send)  # 无效 token（Depends 401）
            return
        if payload.get("type") != "access":
            await self.app(scope, receive, send)
            return
        device_id_str = payload.get("device_id")
        if not device_id_str:
            await self.app(scope, receive, send)  # 旧 token 无 device_id（透传）
            return

        K_hex = await get_session_key(device_id_str)
        if not K_hex:
            # K 不存在（session 过期/Redis 故障）-> 拒 401，强制重 SRP login 重建 K（防 downgrade）
            await self._send_json(send, 401, {"detail": "session expired"})
            return
        K = bytes.fromhex(K_hex)

        # 请求 body 解密（POST/PUT/DELETE 强制加密）
        new_receive = receive
        if scope["method"] in BODY_METHODS:
            if headers.get(b"x-safebox-encrypted") != b"1":
                await self._send_json(send, 400, {"detail": "encrypted body required"})
                return
            body = await self._read_body(receive)
            if body:
                try:
                    decrypted = transport_crypto.decrypt(K, body)
                except Exception:
                    await self._send_json(send, 400, {"detail": "decrypt failed"})
                    return
                new_receive = self._make_receive(decrypted)

        # 拦截响应加密
        await self._run_with_encrypted_response(scope, new_receive, send, K)

    async def _read_body(self, receive):
        body = b""
        more = True
        while more:
            msg = await receive()
            if msg["type"] == "http.request":
                body += msg.get("body", b"")
                more = msg.get("more_body", False)
            else:
                more = False
        return body

    def _make_receive(self, body):
        sent = [False]
        async def receive():
            if sent[0]:
                return {"type": "http.request", "body": b"", "more_body": False}
            sent[0] = True
            return {"type": "http.request", "body": body, "more_body": False}
        return receive

    async def _send_json(self, send, status, obj):
        body = _json.dumps(obj).encode()
        await send({
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        })
        await send({"type": "http.response.body", "body": body})

    async def _run_with_encrypted_response(self, scope, receive, send, K):
        status = [None]
        headers = [None]
        chunks = []
        finished = [False]

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status[0] = message["status"]
                headers[0] = message.get("headers", [])
            elif message["type"] == "http.response.body" and not finished[0]:
                chunks.append(message.get("body", b""))
                if not message.get("more_body", False):
                    finished[0] = True
                    body = b"".join(chunks)
                    st = status[0] or 200
                    hdrs = headers[0] or []
                    ct = ""
                    for k, v in hdrs:
                        if k == b"content-type":
                            ct = v.decode("latin-1", "ignore")
                    # 204 / 空 body / 事件流跳过加密
                    if st == 204 or not body or ct.startswith("text/event-stream"):
                        await send({"type": "http.response.start", "status": st, "headers": hdrs})
                        await send({"type": "http.response.body", "body": body})
                        return
                    encrypted = transport_crypto.encrypt(K, body)
                    new_hdrs = [(k, v) for k, v in hdrs if k not in (b"content-type", b"content-length")]
                    new_hdrs.append((b"content-type", b"application/octet-stream"))
                    new_hdrs.append((b"x-safebox-encrypted", b"1"))
                    new_hdrs.append((b"content-length", str(len(encrypted)).encode()))
                    await send({"type": "http.response.start", "status": st, "headers": new_hdrs})
                    await send({"type": "http.response.body", "body": encrypted})

        await self.app(scope, receive, send_wrapper)
