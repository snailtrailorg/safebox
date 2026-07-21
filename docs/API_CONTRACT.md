# SafeBox API 契约

所有路径前缀 `/api/v1`。除标注外，需 `Authorization: Bearer <access_token>`。

---

## 认证（SRP-6a + 2SKD）

认证基于 SRP-6a（RFC 3526 4096-bit + SHA-256）+ 2SKD（`x = PBKDF2(主密码) XOR HKDF(助记词)`）。服务端只存 SRP verifier，不存密码/助记词明文。详见 `docs/RECOVERY_MECHANISM.md`。

### POST /auth/send-code
发送验证码（邮件/短信）。无需认证。

请求：`{"target": "phone|email", "value": "user@example.com"}`
响应 200：`{"expires_in": 300}`

限流：60s 内同一目标只能发一次。

### POST /auth/register/email
注册（邮箱验证码）。客户端本地派生 SRP verifier。

请求：
```json
{
  "email": "user@example.com",
  "verification_code": "123456",
  "srp_verifier": "hex(v=g^x mod N), x=deriveX(主密码,助记词,srp_salt,邮箱)",
  "srp_salt": "hex(16字节), 客户端生成",
  "local_salt": "base64(32字节), cached_K/mnemonic_encrypted 派生用",
  "encrypted_user_key": "AES(K, UserKey), K=PBKDF2(助记词+主密码, mnemonic_salt)",
  "mnemonic_salt": "base64(32字节)",
  "kdf_settings": {"algorithm": "pbkdf2", "iterations": 600000},
  "device_name": "Web Browser",
  "device_public_key": "web",
  "device_wrapped": "web"
}
```
> 助记词不上传（客户端本地持有 + 加密缓存）。`device_*` 为占位值。

响应 201：`{"user_id": "uuid", "access_token": "jwt", "refresh_token": "jwt"}`

### POST /auth/register/phone
同上，`email` 换 `phone`。

### POST /auth/register/google
同上，加 `google_id_token`，无 `email`/`verification_code`。Google 用户也存 srp_verifier（供改密/删号 SRP 验旧密码）。

### GET /auth/salt?email=... 或 ?phone=...
获取 SRP 参数 + salt（未认证，防枚举：未注册返回确定性 fake salt，SRP verify 必失败）。

响应：
```json
{
  "srp_salt": "hex",
  "local_salt": "base64",
  "mnemonic_salt": "base64",
  "kdf_settings": {"algorithm": "pbkdf2", "iterations": 600000},
  "N": "hex(RFC 3526 4096-bit)",
  "g": "2"
}
```

### POST /auth/login/srp/challenge
SRP 第一步：客户端发 A，服务端返回 B + session_id（存 Redis TTL 5min）。

请求：`{"target_type": "email|phone", "target": "...", "A": "hex"}`
响应 200：`{"session_id": "...", "B": "hex"}`
429：登录限流（`login_rate_limited`，含 `seconds`）

### POST /auth/login/srp/verify
SRP 第二步：客户端发 M1，服务端验证后返回 M2 + token。

请求：`{"session_id": "...", "M1": "hex"}`
响应 200：
```json
{
  "access_token": "...", "refresh_token": "...",
  "local_salt": "...", "encrypted_user_key": "...", "mnemonic_salt": "...",
  "M2": "hex(服务端证据)", "devices": [...]
}
```
401：M1 不匹配（错密码/错助记词/用户不存在，统一错误防枚举）

### POST /auth/login/google
请求：`{"google_id_token": "..."}`，响应同 SRP verify（无 M2，Google 不走 SRP）。

### POST /auth/change-password
改主密码（需 Bearer + 验证码）。旧主密码由前置 SRP 登录验（fresh token），此端点只写新材料。

请求：
```json
{
  "target": "email", "value": "...", "verification_code": "123456",
  "new_srp_verifier": "hex",
  "new_srp_salt": "hex",
  "new_local_salt": "base64",
  "new_encrypted_user_key": "AES(新K, UserKey), 新K=PBKDF2(助记词+新主密码, mnemonic_salt)"
}
```
响应 200：`{"success": true, "access_token": "...", "refresh_token": "..."}`

### POST /auth/refresh-token
请求：`{"refresh_token": "..."}`
响应 200：`{"access_token": "...", "refresh_token": "..."}`

### POST /auth/logout
需 Bearer。204 No Content。

### POST /auth/register-device
需 Bearer。请求：`{"device_name": "...", "device_public_key": "...", "device_wrapped": "..."}`
响应 200：`{"device_id": "..."}`
> 保留端点，`device_*` 为占位值。

### DELETE /auth/account
需 Bearer。旧主密码由前置 SRP 登录验（fresh token）。
请求：`{"verification_code": "123456"}`
204 No Content（FK 级联删全数据，不可恢复）。

**已删除端点**：`/auth/login/email`、`/auth/login/phone`、`/auth/recovery/initiate`、所有 `/auth/recovery/*`。

---

## 同步

### GET /sync/pull?since=ISO8601&since_id=UUID&limit=100
需 Bearer。`since_id` 为上一页最后一条 id（可选），与 `since` 组成复合游标，防同 `updated_at` 跨页丢失。响应 200：
```json
{
  "items": [{"server_id": "...", "client_did": 1, "type": "login", "name": "EncryptedField JSON", "version": 2, "is_deleted": false, "updated_at": "..."}],
  "server_time": "...",
  "server_id": "最后一条 id 或 null",
  "has_more": false
}
```

### POST /sync/push
需 Bearer。请求：
```json
{
  "items": [{"client_did": 1, "server_id": "可选", "type": "login", "name": "EncryptedField JSON", "version": 1, "updated_at": "..."}]
}
```
响应 200：
```json
{"results": [{"client_did": 1, "server_id": "...", "status": "created|updated|conflict", "version": 2}]}
```

### POST /sync/delete
需 Bearer。请求：`{"server_ids": ["uuid", ...]}`
响应 200：`{"results": [{"server_id": "...", "status": "deleted|not_found"}]}`

---

## 健康检查

### GET /health
无需认证。响应 200：`{"status": "ok"}`
