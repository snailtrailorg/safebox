# SafeBox API v2（目标设计）

> 版本: v2.6
> v2.5 → v2.6 变更:
>   - 恢复码端点新增 /auth/recovery/accelerate（加速通道）
>   - /auth/recovery/initiate 请求体增加 pending 字段（一次性提交新密码）
>   - /auth/recovery/cancel 移除（合并入 freeze 语义，用户主动停止不需 cancel 端点）
>   - /auth/recovery/confirm 移除（合并入 accelerate 和自动激活）
>   - 新增 pending_new_auth_key_hash / pending_password_wrapped / pending_setup_at / cooldown_expires_at / recovery_attempt_count 字段

---

## 一、恢复码端点

### `POST /auth/recovery/generate`

**用途**：已登录用户生成新恢复码。前置校验：邮箱/手机验证码 + 当前 Master Password。

```json
// Request
Authorization: Bearer <access_token>
{"verification_code": "123456",
 "current_auth_key_hash": "..."}

// 200
{"recovery_code": "K3fX9mP2wQ7zL5nV8cR4tY1aB6eH0jU"}
```

- 生成 `secrets.token_urlsafe(32)` 恢复码，HMAC-SHA256 加盐哈希后存储
- 任何历史恢复码立即 `permanently_locked`
- 恢复码明文**仅在此响应中返回一次**，服务端只存哈希

### `POST /auth/recovery/initiate`

**用途**：验证恢复码 + 一次性提交新密码。**无 verification_code。**

```json
// Request
{"recovery_code": "K3fX9mP2wQ7zL5nV8cR4tY1aB6eH0jU",
 "pending_new_auth_key_hash": "...",        // 新密码的 bcrypt hash
 "pending_password_salt": "...",
 "pending_kdf_settings": {...},
 "pending_password_wrapped": "..."}          // 用新密码重新 wrap 后的 User Key

// 200
{"status": "pending_activation",
 "cooldown_expires_at": "2026-07-08T13:00:00Z",
 "cooldown_seconds": 86400}
// 400 — 恢复码错误
// 403 — 已有冷却期进行中
// 429 — 连续错误达 5 次 + 当月已达 3 次 → permanently_locked
```

- 验证恢复码 → 写入 pending_* 字段 → 进入冷却期 → 多渠道告警
- `users.password_hash` 和 `user_keys.password_wrapped` **不变**
- 冻结时直接丢弃 pending_*，旧数据天然可用（零恢复成本）

### `GET /auth/recovery/status`

**用途**：查询当前恢复码状态，供前端倒计时。

```json
// 200
{"status": "active" | "pending_activation" | "consumed" | "permanently_locked",
 "cooldown_remaining_seconds": 86400,
 "recovery_attempt_count": 1}
```

### `POST /auth/recovery/accelerate`

**用途**：加速通道——通过验证码立即激活新密码，跳过剩余冷却期。

```json
// Request
{"signed_token": "一次性签名URL token",
 "verification_code": "123456"}

// 200
{"success": true, "activated": true}
// 400 — token 无效/过期 / 验证码错误
```

- 验证签名 token（15 分钟有效，一次性）
- 验证码（5 次/小时，10 次/天）
- 通过后：pending_* → 写入 `users.password_hash` / `user_keys.password_wrapped`
- `status → consumed`，保险库解冻
- 前端引导用户生成新恢复码

### `POST /auth/recovery/freeze`

**用途**：终止恢复，回滚到旧密码。无需登录，一次性签名 URL。

```json
// Request
{"signed_token": "一次性签名URL token"}

// 200
{"success": true, "rolled_back": true}
// 400 — token 无效/过期
```

- 丢弃 pending_* 字段（物理删除）
- `status → active`
- `recovery_attempt_count` 保持不变（已 +1 不减少）
- 旧密码不变（从未被覆盖）

### `POST /auth/recovery/revoke`

**用途**：已登录用户主动作废旧码。

```json
// Request
Authorization: Bearer <access_token>
{"verification_code": "123456",
 "current_auth_key_hash": "..."}

// 200
{"success": true}
```

### `POST /admin/recovery/unlock`

**用途**：客服解除永久锁定。

```json
// Request
Authorization: Bearer <admin_token>
{"user_id": "uuid", "ticket_id": "CS-20260707-001"}

// 200
{"success": true, "action": "重置链接已发送至用户绑定邮箱"}
```

- 客服不能获取恢复码明文、不能解密 vault、不能设置新密码
- 系统发送重置链接至邮箱（24h 有效）

---

## 二、端点概要表

| # | 方法 | 路径 | Auth | 限流 | 变更 |
|---|------|------|------|------|------|
| 1 | GET | /auth/salt | 无 | N | — |
| 2 | POST | /auth/send-code | 无 | L2+L3 | — |
| 3 | POST | /auth/register/email | 无 | L2 | — |
| 4 | POST | /auth/register/phone | 无 | L2 | — |
| 5 | POST | /auth/register/google | 无 | L2 | — |
| 6 | POST | /auth/login/email | 无 | L1+L2 | — |
| 7 | POST | /auth/login/phone | 无 | L1+L2 | — |
| 8 | POST | /auth/login/google | 无 | L2 | — |
| 9 | POST | /auth/change-password | Bearer | L2 | +verification_code |
| 10 | POST | /auth/reset-password | 无 | L2 | — |
| 11 | POST | /auth/recovery/generate | Bearer | L2 | **v2.6** |
| 12 | POST | /auth/recovery/initiate | 无 | L2 | **v2.6** |
| 13 | GET | /auth/recovery/status | 无 | L2 | **v2.6** |
| 14 | POST | /auth/recovery/accelerate | 签名URL | L2 | **v2.6 新增** |
| 15 | POST | /auth/recovery/freeze | 签名URL | N | **v2.6** |
| 16 | POST | /auth/recovery/revoke | Bearer | L2 | **v2.6** |
| 17 | POST | /admin/recovery/unlock | Admin | L2 | **v2.6 新增** |
| 18 | POST | /auth/refresh-token | 无 | N | — |
| 19 | POST | /auth/logout | Bearer | N | — |
| 20 | DELETE | /auth/account | Bearer | N | +verification_code |
| 21 | POST | /auth/register-device | Bearer | N | — |
| 22 | GET | /sync/pull | Bearer | N | — |
| 23 | POST | /sync/push | Bearer | N | — |
| 24 | POST | /sync/delete | Bearer | N | — |
| 25 | GET | /health | 无 | N | — |
