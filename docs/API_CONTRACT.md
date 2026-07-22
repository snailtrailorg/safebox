# SafeBox API 契约

所有路径前缀 `/api/v1`。除标注外，需 `Authorization: Bearer <access_token>`（access token 30min，refresh 30 天，都绑 device_id）。

认证基于 SRP-6a（RFC 3526 4096-bit + SHA-256）+ 2SKD。服务端只存 SRP verifier，不存密码/助记词明文。详见 `docs/ARCHITECTURE.md` + `docs/RECOVERY_MECHANISM.md`。

---

## 一、认证（SRP-6a）

### POST /auth/send-code
发送验证码（邮件/短信）。无需认证。验证码绑 target（email/phone），不绑 session（跨客户端共享，标准机制）。

请求：`{"target": "phone|email", "value": "user@example.com"}`
响应 200：`{"expires_in": 300}`
限流：60s 内同一 target 只能发一次。

### POST /auth/register/email
注册（邮箱验证码）。客户端本地派生 SRP verifier + 加密材料。注册建 UserDevice（从 User-Agent + IP 解析 client_name/os_name/last_auth_ip）。

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
> 助记词不上传（客户端本地持有 + 加密缓存）。`device_public_key`/`device_wrapped` 占位值。

响应 201：`{"user_id": "uuid", "access_token": "jwt", "refresh_token": "jwt", "device_id": "uuid"}`
> 注册不 SRP 握手无 K_comm；客户端助记词确认后走 SRP 登录建 K_comm + 新 token 替换。

### POST /auth/register/phone
同上，`email` 换 `phone`。

### POST /auth/register/google
同上，加 `google_id_token`，无 `email`/`verification_code`。Google 用户也存 srp_verifier（供改密/删号 SRP 验旧密码）。

### GET /auth/salt?email=... 或 ?phone=...
获取 SRP 参数 + salt。未认证，防枚举（未注册返确定性 fake salt，SRP verify 必失败）。

响应：
```json
{
  "srp_salt": "hex", "local_salt": "base64", "mnemonic_salt": "base64",
  "kdf_settings": {"algorithm": "pbkdf2", "iterations": 600000},
  "N": "hex(RFC 3526 4096-bit)", "g": "2"
}
```

### POST /auth/login/srp/challenge
SRP 第一步：客户端发 A，服务端返回 B + session_id（存 Redis TTL 5min）。

请求：`{"target_type": "email|phone", "target": "...", "A": "hex", "device_id?": "同设备", "device_name?": "新设备"}`
- `device_id`（同设备）：验未 revoked，更新 last_active_at + client_name/os_name/last_auth_ip
- `device_name`（新设备）：建 UserDevice

响应 200：`{"session_id": "...", "B": "hex"}`
429：登录限流（`login_rate_limited`，含 `seconds`）
401：传已 revoked 的 device_id -> `device_revoked`

### POST /auth/login/srp/verify
SRP 第二步：客户端发 M1，服务端验证后返回 M2 + token + 密钥材料。成功后存 K_comm（Redis session_key:{device_id} TTL 30 天）。

请求：`{"session_id": "...", "M1": "hex"}`
响应 200：
```json
{
  "access_token": "...", "refresh_token": "...",
  "local_salt": "...", "encrypted_user_key": "...", "mnemonic_salt": "...",
  "M2": "hex(服务端证据)", "device_id": "uuid(token 绑定)", "devices": [DeviceInfo...]
}
```
401：M1 不匹配（错密码/错助记词/用户不存在，统一错误防枚举）

### POST /auth/login/google
请求：`{"google_id_token": "...", "device_id?": "同设备", "device_name?": "新设备"}`
响应同 SRP verify（无 M2，Google 不走 SRP）。
> Google 登录不 SRP 握手，无 K_comm -> 认证 API 会 401（Google K 方案待定）。

### POST /auth/change-password
改主密码（需 Bearer fresh token + 验证码）。旧主密码由前置 SRP 登录验（fresh token），此端点只写新材料。

请求：
```json
{
  "target": "email", "value": "...", "verification_code": "123456",
  "new_srp_verifier": "hex", "new_srp_salt": "hex",
  "new_local_salt": "base64",
  "new_encrypted_user_key": "AES(新K, UserKey), 新K=PBKDF2(助记词+新主密码, mnemonic_salt)"
}
```
响应 200：`{"success": true, "access_token": "...", "refresh_token": "..."}`
副作用：revoke_all_user_tokens + 清**其他设备** session_key（当前 device 保留）+ 异步发通知邮件（BackgroundTasks 不阻塞）。

### POST /auth/refresh-token
请求：`{"refresh_token": "..."}`
响应 200：`{"access_token": "...", "refresh_token": "..."}`
> refresh 续 K_comm TTL（session_key:{device_id} Redis）。重放旧 refresh -> 全线失效（TokenFamily + FOR UPDATE）。

### POST /auth/logout
需 Bearer。204。撤销所有 token family + 清所有 device session_key（client 也清 cached_K/mnemonic_encrypted/session_K，决策 A）。

### DELETE /auth/account
需 Bearer fresh token。旧主密码由前置 SRP 登录验。
请求：`{"verification_code": "123456"}`
204（FK 级联删全数据，不可恢复）。

**已删除端点**：`/auth/login/email`、`/auth/login/phone`、`/auth/recovery/initiate`、所有 `/auth/recovery/*`、`/auth/register-device`（冗余，register/verify 的 _resolve_device 已建 device）。

---

## 二、设备管理 + SRP K 通信加密

### GET /auth/devices
需 Bearer。响应（K 加密密文，client 解密）：
```json
[{"id": "uuid", "device_name": "Web Browser", "device_wrapped": "web",
  "client_name": "Chrome 120", "os_name": "Fedora", "last_auth_ip": "1.2.3.4",
  "last_active_at": "...", "created_at": "...", "is_revoked": false, "is_current": true}]
```

### DELETE /auth/devices/{device_id}
需 Bearer。标记 is_revoked + 删该 device TokenFamily + Redis `device:revoked:{id}` TTL 30min（中间件查，access 立即失效）。204。
404：device_not_found（他人设备）；已 revoked 幂等返 204。

### SRP K 通信加密（对标 1Password SRP+GCM）
- **K_comm** = SRP 握手 H(S)，**session 级**（login 到 logout，TTL 30 天 = refresh 同期，refresh 续）；存 Redis `session_key:{device_id}` + client IndexedDB
- 认证 POST/PUT/DELETE body + 响应用 K_comm AES-256-GCM 加密（`nonce(12)+ct+tag`），header `X-Safebox-Encrypted: 1`
- **K 不存 -> 401 `session expired`**（不透传，强制重 SRP login 重建 K，防 downgrade）
- 缺 `X-Safebox-Encrypted` header -> **400** `encrypted body required`（非 401）；body 非合法 AES-GCM -> 400 `decrypt failed`
- 登录前 API（/salt/send-code/register/login/refresh）不加密
- middleware 纯 ASGI（BaseHTTPMiddleware call_next 不传 receive body，故纯 ASGI）
- 设备信息：challenge/verify 从 `User-Agent` + `X-Real-IP` 解析填充 device 的 client_name/os_name/last_auth_ip

---

## 三、同步

### GET /sync/pull?since=ISO8601&since_id=UUID&limit=100
需 Bearer。`since_id` 与 `since` 组成复合游标（防同 updated_at 跨页丢失）。响应 200（K 加密）：
```json
{
  "items": [{"server_id": "...", "client_did": 1, "type": "login", "name": "EncryptedField JSON", "version": 2, "is_deleted": false, "updated_at": "..."}],
  "server_time": "...", "server_id": "最后一条 id 或 null", "has_more": false
}
```

### POST /sync/push
需 Bearer。请求（K 加密 body）：
```json
{"items": [{"client_did": 1, "server_id": "可选", "type": "login", "name": "EncryptedField JSON", "version": 1, "updated_at": "..."}]}
```
响应 200（K 加密）：`{"results": [{"client_did": 1, "server_id": "...", "status": "created|updated|conflict", "version": 2}]}`

### POST /sync/delete
需 Bearer。请求：`{"server_ids": ["uuid", ...]}`
响应 200：`{"results": [{"server_id": "...", "status": "deleted|not_found"}]}`

---

## 四、健康检查

### GET /health
无需认证。响应 200：`{"status": "ok"}`
