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
  "local_password_hash": "PBKDF2(本地密码, local_salt+\"auth\")",
  "local_salt": "base64(32字节)",
  "encrypted_user_key": "AES(K, UserKey raw)",
  "mnemonic_salt": "base64(32字节)",
  "kdf_settings": {"algorithm": "pbkdf2", "iterations": 600000},
  "has_passphrase": false,
  "mnemonic": "12词助记词明文",
  "mnemonic_hmac_salt": "hex salt",
  "device_name": "Web Browser",
  "device_public_key": "web",
  "device_wrapped": "web"
}
```
> `device_*` 为可选字段，串行化模型下跨设备用助记词，传占位值。

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
  "mnemonic_salt": "...",
  "has_passphrase": false
}
```

### POST /auth/login/email
请求：
```json
{"email": "...", "local_password_hash": "PBKDF2(本地密码, local_salt+\"auth\")"}
```

响应 200：
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "local_salt": "...",
  "encrypted_user_key": "...",
  "mnemonic_salt": "...",
  "has_passphrase": false
}
```
403：账户恢复冷却中（`account_in_cooldown`）
429：登录限流（`login_rate_limited`，含 `seconds` 等待秒数）

**使用场景**：
- 日常登录（已登录设备）：客户端已有本地 `cached_K`，用本地密码解 cached_K → K → User Key。`encrypted_user_key` 用于刷新本地缓存（如被别处改密后）。
- 换设备（新设备，无 cached_K）：客户端需本地密码（认证）+ 助记词[+Passphrase]（派生 K）才能解 `encrypted_user_key`。仅靠本地密码无法解密。

### POST /auth/login/phone
同上，加 `verification_code`。

### POST /auth/login/google
请求：`{"google_id_token": "..."}`，响应同 login/email。

### POST /auth/verify
每次解锁校验（语义1：每次服务端校验）。需 Bearer。

请求：
```json
{"local_password_hash": "...", "local_password_version": 0}
```

响应 200：`{"local_password_version": 0, "status": "ok"}`
401：密码错误
409：密码已在别处修改（version 不符）

限流：默认 500/h（RateLimitMiddleware 统一处理，需 Bearer）。
冷却期：/verify 不查冷却状态（纯认证校验，不下发数据）。冷却期内 /verify 仍返回 200（用户可检查密码是否正确），但 sync 等数据端点被 403 挡。

### POST /auth/change-password
改本地密码（需 Bearer + 验证码）。

请求：
```json
{
  "target": "email", "value": "...", "verification_code": "123456",
  "current_local_password_hash": "...",
  "new_local_password_hash": "...",
  "new_local_salt": "..."
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
> 保留端点，当前串行化模型中跨设备用助记词，device_public_key/device_wrapped 为占位值。

### DELETE /auth/account
需 Bearer + 验证码。请求：`{"target": "email", "value": "...", "verification_code": "123456"}`
204 No Content。

---

## 助记词

### POST /auth/recovery/initiate
步骤1：验助记词，返回 encrypted_user_key + initiate_token（无需认证）。

请求：
```json
{
  "target": "email", "value": "...",
  "mnemonic": "12词助记词",
  "new_local_password_hash": "...",
  "new_local_salt": "..."
}
```

响应 200：
```json
{"encrypted_user_key": "...", "mnemonic_salt": "...", "initiate_token": "..."}
```

### POST /auth/recovery/confirm
步骤2：验 token，写正式 + 进冷却 + 吊销 token（无需认证）。

请求：`{"initiate_token": "..."}`
响应 200：`{"cooldown_until": "ISO8601"}`

### POST /auth/recovery/accelerate
验证码解除冷却（无需认证，签名 token）。

请求：`{"signed_token": "...", "verification_code": "123456"}`
204 No Content。

### POST /auth/recovery/freeze
回滚旧密码（无需认证，签名 token）。

请求：`{"signed_token": "..."}`
204 No Content。

### GET /auth/recovery/status
需 Bearer。响应 200：
```json
{"status": "active|cooldown", "cooldown_until": "ISO8601|null"}
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
