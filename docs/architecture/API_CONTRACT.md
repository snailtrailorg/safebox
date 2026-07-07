# SafeBox API 契约

> 版本: v0.1（当前实现）
> 基础 URL: `/api/v1`
> 鉴权: 端点的 `Auth` 列标注所需鉴权方式
> 限流: 标注 L1(邮箱退避) / L2(IP 滑动窗口) / N(无)

---

## 一、认证端点

### `GET /auth/salt`

获取用户密码 salt，用于客户端 PBKDF2 派生。

| 字段 | 值 |
|------|-----|
| Auth | 无 |
| 限流 | N |
| Query | `email` 或 `phone` |

```json
// 200: 用户存在
{"password_salt": "abc123...", "recovery_wrapped": "base64...", "encrypted_private": "base64...", "rsa_public_key": "base64..."}

// 200: 用户不存在（随机 salt 防枚举）
{"password_salt": "def456..."}
```

### `POST /auth/send-code`

发送 6 位验证码到邮箱或手机。

| 字段 | 值 |
|------|-----|
| Auth | 无 |
| 限流 | L2(IP 滑动窗口) + 60s/每目标 |
| Body | `SendCodeRequest` |

```json
// Request
{"target": "email", "value": "user@example.com"}

// 200
{"expires_in": 300}

// 429 — IP 超限
{"detail": "请求频率过高，请稍后再试"}
// 429 — 目标超限
{"detail": "验证码发送太频繁，请 60 秒后再试"}
```

### `POST /auth/register/email`

| 字段 | 值 |
|------|-----|
| Auth | 无（验证码身份验证） |
| 限流 | L2 |
| Body | `RegisterEmailRequest` |

```json
// Request
{"email": "user@example.com", "verification_code": "123456", "password_hash": "PBKDF2...", "password_salt": "base64...", "password_wrapped": "base64...", "recovery_wrapped": "base64...", "encrypted_private": "base64...", "rsa_public_key": "base64...", "device_name": "My Laptop", "device_public_key": "web", "device_wrapped": "web"}

// 201
{"user_id": "uuid", "access_token": "jwt...", "refresh_token": "jwt..."}

// 400
{"detail": "验证码无效或已过期"}
// 409
{"detail": "该邮箱已注册"}
```

### `POST /auth/register/phone`

同 `/register/email`，使用 `phone` 和 `verification_code`，返回相同结构。

### `POST /auth/register/google`

| 字段 | 值 |
|------|-----|
| Auth | 无（Google id_token 身份验证）|
| 限流 | L2 |
| Body | `RegisterGoogleRequest` |

```json
// Request
{"google_id_token": "eyJ...", "password_hash": "PBKDF2...", "password_salt": "...", "password_wrapped": "...", "recovery_wrapped": "...", "encrypted_private": "...", "rsa_public_key": "...", "device_name": "...", "device_public_key": "web", "device_wrapped": "web"}

// 201 — 同 register/email
```

### `POST /auth/login/email`

| 字段 | 值 |
|------|-----|
| Auth | 无（密码验证） |
| 限流 | L1(email 退避) + L2(IP 滑动窗口) |
| Body | `LoginEmailRequest` |

```json
// Request
{"email": "user@example.com", "password_hash": "PBKDF2..."}

// 200
{"access_token": "jwt...", "refresh_token": "jwt...", "password_salt": "base64...", "password_wrapped": "base64...", "recovery_wrapped": "base64...", "encrypted_private": "base64...", "rsa_public_key": "base64...", "devices": [{"id": "uuid", "device_name": "...", "device_wrapped": "..."}]}

// 401
{"detail": "邮箱或密码错误"}
// 429 — L1
{"detail": "登录尝试过于频繁，请 X 秒后再试"}
// 429 — L2
{"detail": "请求频率过高，请稍后再试"}
```

### `POST /auth/login/phone`

同 `/login/email`，加一个 `verification_code` 字段。返回同 `/login/email`。

### `POST /auth/login/google`

| 字段 | 值 |
|------|-----|
| Auth | 无（Google id_token） |
| 限流 | L2 |
| Body | `LoginGoogleRequest` |

```json
// Request
{"google_id_token": "eyJ..."}

// 200 — 同 login/email
```

### `POST /auth/reset-password`

通过邮箱/手机验证码重置密码。

| 字段 | 值 |
|------|-----|
| Auth | 无（验证码身份验证） |
| 限流 | L2 |
| Body | `ResetPasswordRequest` |

```json
// Request
{"target": "email", "value": "user@example.com", "verification_code": "123456", "new_password_hash": "PBKDF2...", "new_password_salt": "base64...", "new_password_wrapped": "base64..."}

// 200
{"success": true, "access_token": "...", "refresh_token": "...", "password_salt": "...", "password_wrapped": "...", "recovery_wrapped": "...", "encrypted_private": "...", "rsa_public_key": "..."}
```

### `POST /auth/recovery-reset`

通过 BIP39 恢复码重置密码（无需邮箱验证码）。

| 字段 | 值 |
|------|-----|
| Auth | 无（恢复码是身份证明） |
| 限流 | L2 |
| Body | `RecoveryResetRequest` |

```json
// Request
{"target": "email", "value": "user@example.com", "new_password_hash": "PBKDF2...", "new_password_salt": "base64...", "new_password_wrapped": "base64..."}

// 200 — 同 reset-password
// 404 — 用户不存在
```

注意：恢复码验证是纯客户端的（API 不参与），无需验证码字段。

### `POST /auth/refresh-token`

| 字段 | 值 |
|------|-----|
| Auth | 无（使用 refresh_token） |
| 限流 | N |
| Body | `RefreshTokenRequest` |

```json
// Request
{"refresh_token": "jwt..."}

// 200
{"access_token": "new-jwt...", "refresh_token": "new-jwt..."}
// 401 — token 无效或重放检测
{"detail": "refresh_token 无效或已过期"}
```

### `POST /auth/logout`

| 字段 | 值 |
|------|-----|
| Auth | Bearer token |
| 限流 | N |
| Body | 无 |

```json
// 204 — No Content
```

### `DELETE /auth/account`

| 字段 | 值 |
|------|-----|
| Auth | Bearer token |
| 限流 | N |
| Body | 无 |

```json
// 204 — No Content
```

### `POST /auth/register-device`

| 字段 | 值 |
|------|-----|
| Auth | Bearer token |
| 限流 | N |
| Body | `RegisterDeviceRequest` |

```json
// Request
{"device_name": "My Phone", "device_public_key": "base64...", "device_wrapped": "base64..."}

// 200
{"device_id": "uuid"}
```

---

## 二、同步端点

### `GET /sync/pull`

| 字段 | 值 |
|------|-----|
| Auth | Bearer token |
| 限流 | N |
| Query | `since` (ISO8601, 可选) + `limit` (默认100) |

```json
// 200
{"items": [{"id": "uuid", "client_did": 1, "type": "login", "icon": "...", "name": "...", "description": "...", "data": "...", "version": 1, "is_deleted": false, "updated_at": "ISO8601"}], "server_time": "ISO8601", "has_more": false}
```

### `POST /sync/push`

| 字段 | 值 |
|------|-----|
| Auth | Bearer token |
| 限流 | N |
| Body | `SyncPushRequest` |

```json
// Request
{"items": [{"client_did": 1, "type": "login", "icon": "...", "name": "...", "description": "...", "data": "...", "version": 1, "updated_at": "ISO8601"}]}

// 200
{"results": [{"client_did": 1, "server_id": "uuid", "status": "created"}], "items": [...]}
```

### `POST /sync/delete`

| 字段 | 值 |
|------|-----|
| Auth | Bearer token |
| 限流 | N |
| Body | `SyncDeleteRequest` |

```json
// Request
{"server_ids": ["uuid1", "uuid2"]}

// 200
{"results": [{"server_id": "uuid1", "status": "deleted"}]}
```

---

## 三、健康检查

### `GET /health`

| 字段 | 值 |
|------|-----|
| Auth | 无 |
| 限流 | N |

```json
// 200
{"status": "ok"}
```

---

## 四、端点概览表

| # | 方法 | 路径 | Auth | 限流 | 请求体 | 成功 | 失败码 |
|---|------|------|------|------|--------|------|--------|
| 1 | GET | /auth/salt | 无 | N | query | 200 | - |
| 2 | POST | /auth/send-code | 无 | L2+60s | SendCodeRequest | 200 | 429 |
| 3 | POST | /auth/register/email | 无 | L2 | RegisterEmailRequest | 201 | 400,409 |
| 4 | POST | /auth/register/phone | 无 | L2 | RegisterPhoneRequest | 201 | 400,409 |
| 5 | POST | /auth/register/google | 无 | L2 | RegisterGoogleRequest | 201 | 400,409 |
| 6 | POST | /auth/login/email | 无 | L1+L2 | LoginEmailRequest | 200 | 401,429 |
| 7 | POST | /auth/login/phone | 无 | L1+L2 | LoginPhoneRequest | 200 | 400,401,429 |
| 8 | POST | /auth/login/google | 无 | L2 | LoginGoogleRequest | 200 | 400,401 |
| 9 | POST | /auth/reset-password | 无 | L2 | ResetPasswordRequest | 200 | 400,404 |
| 10 | POST | /auth/recovery-reset | 无 | L2 | RecoveryResetRequest | 200 | 404 |
| 11 | POST | /auth/refresh-token | 无 | N | RefreshTokenRequest | 200 | 401 |
| 12 | POST | /auth/logout | Bearer | N | - | 204 | 401 |
| 13 | DELETE | /auth/account | Bearer | N | - | 204 | 401 |
| 14 | POST | /auth/register-device | Bearer | N | RegisterDeviceRequest | 200 | 401 |
| 15 | GET | /sync/pull | Bearer | N | query | 200 | 401 |
| 16 | POST | /sync/push | Bearer | N | SyncPushRequest | 200 | 401 |
| 17 | POST | /sync/delete | Bearer | N | SyncDeleteRequest | 200 | 401 |
| 18 | GET | /health | 无 | N | - | 200 | - |

---

## 五、规范约束

### 5.1 响应格式

- 成功：`2xx`，有 body（除非 204）
- 错误：`4xx`/`5xx`，body 为 `{"detail": "..."}` 或 `{"detail": [...]}`
- 204 No Content：无 body（Web API 客户端需特殊处理 `.json()` 跳过）

### 5.2 鉴权格式

```
Authorization: Bearer <access_token>
```
Access token 是 JWT，过期时间 `access_token_expire_minutes=30` 分钟。

### 5.3 限流响应

```
HTTP/1.1 429 Too Many Requests
Content-Type: application/json
{"detail": "登录尝试过于频繁，请 4 秒后再试"}
```

### 5.4 隐式状态码

| 状态码 | 场景 | 当前处理 |
|--------|------|---------|
| 422 | Pydantic 参数校验失败 | 自动（FastAPI 内置）|
| 500 | 未捕获异常 | gunicorn error log |
| 503 | 验证码发送失败 | 显式抛出 |
