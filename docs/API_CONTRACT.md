# SafeBox API 契约

所有路径前缀 `/api/v1`。除标注外，需 `Authorization: Bearer <access_token>`。

---

## 认证

### POST /auth/send-code
发送验证码（邮件/短信）。无需认证。

请求：
```json
{"target": "phone|email", "value": "user@example.com"}
```
响应 200：`{"expires_in": 300}`

限流：60s 内同一目标只能发一次。dev 模式打印到终端。

### POST /auth/register/email
注册（邮箱验证码）。

请求：
```json
{
  "email": "user@example.com",
  "verification_code": "123456",
  "local_password_hash": "PBKDF2(主密码, local_salt+\"auth\")",
  "local_salt": "base64(32字节)",
  "encrypted_user_key": "AES(K, UserKey), K=PBKDF2(助记词+主密码, mnemonic_salt)",
  "mnemonic_salt": "base64(32字节)",
  "kdf_settings": {"algorithm": "pbkdf2", "iterations": 600000},
  "mnemonic": "12词助记词明文",
  "mnemonic_hmac_salt": "hex salt",
  "device_name": "Web Browser",
  "device_public_key": "web",
  "device_wrapped": "web"
}
```
> `device_*` 为可选字段，合并主密码模型下跨设备用助记词，传占位值。

响应 201：
```json
{"user_id": "uuid", "access_token": "jwt", "refresh_token": "jwt"}
```

### POST /auth/register/phone
同上，`email` 换 `phone`。

### POST /auth/register/google
同上，加 `google_id_token`，无 `email`/`verification_code`。

### GET /auth/salt?email=... 或 ?phone=...
获取 salt（未认证，防枚举）。

响应：
```json
{
  "local_salt": "...",
  "kdf_settings": {"algorithm": "pbkdf2", "iterations": 600000},
  "mnemonic_salt": "..."
}
```

### POST /auth/login/email
请求：
```json
{"email": "...", "local_password_hash": "PBKDF2(主密码, local_salt+\"auth\")"}
```

响应 200：
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "local_salt": "...",
  "encrypted_user_key": "...",
  "mnemonic_salt": "..."
}
```
429：登录限流（`login_rate_limited`，含 `seconds` 等待秒数）

**使用场景**：
- 日常登录（已登录设备）：客户端已有本地 `cached_K`，用主密码解 cached_K → K → User Key。`encrypted_user_key` 用于刷新本地缓存（如被别处改密后）。
- 换设备（新设备，无 cached_K）：客户端需助记词 + 主密码派生 K（`K = PBKDF2(助记词+主密码, mnemonic_salt)`）解 `encrypted_user_key` 拿 User Key。忘主密码 = 数据丢失（主密码参与 K 派生，无法恢复）。

### POST /auth/login/phone
同上，加 `verification_code`。

### POST /auth/login/google
请求：`{"google_id_token": "..."}`，响应同 login/email。

### POST /auth/change-password
改主密码（需 Bearer + 验证码）。主密码参与 K 派生，故 K 变，需助记词重派生 K + 重新包裹 `encrypted_user_key`。

请求：
```json
{
  "target": "email", "value": "...", "verification_code": "123456",
  "current_local_password_hash": "...",
  "new_local_password_hash": "...",
  "new_local_salt": "...",
  "new_encrypted_user_key": "AES(新K, UserKey), 新K=PBKDF2(助记词+新主密码, mnemonic_salt)"
}
```

响应 200：
```json
{"success": true, "access_token": "...", "refresh_token": "..."}
```

### POST /auth/refresh-token
请求：`{"refresh_token": "..."}`
响应 200：`{"access_token": "...", "refresh_token": "..."}`

### POST /auth/logout
需 Bearer。204 No Content。

### POST /auth/register-device
需 Bearer。请求：`{"device_name": "...", "device_public_key": "...", "device_wrapped": "..."}`
响应 200：`{"device_id": "..."}`
> 保留端点，当前合并主密码模型中跨设备用助记词，device_public_key/device_wrapped 为占位值。

### DELETE /auth/account
需 Bearer。请求：`{"verification_code": "123456", "current_local_password_hash": "..."}`
204 No Content（FK 级联删全数据，不可恢复）。

---

## 助记词

### POST /auth/recovery/initiate
验助记词，返回 encrypted_user_key + mnemonic_salt（换设备用，无需认证）。客户端用助记词 + 主密码派生 K 解 `encrypted_user_key`。web 换设备实际走 `login + recoverAndRewrap`，本端点保留但不被 web 调用（死代码）。

请求：
```json
{
  "target": "email", "value": "...",
  "mnemonic": "12词助记词"
}
```

响应 200：
```json
{"encrypted_user_key": "...", "mnemonic_salt": "..."}
```

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
