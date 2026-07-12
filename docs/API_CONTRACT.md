# SafeBox API v2（目标设计）

> 版本: v2.6
> v2.5 → v2.6 变更:
>   - 恢复码端点新增 /auth/recovery/accelerate（加速通道）
>   - /auth/recovery/initiate 请求体增加 pending 字段（一次性提交新密码）
>   - /auth/recovery/cancel 移除（合并入 freeze 语义，用户主动停止不需 cancel 端点）
>   - /auth/recovery/confirm 恢复（两步 initiate 的步骤2：验 token + 提交重包的 User Key）
>   - 新增 cooldown_until / rollback_* 字段；initiate 即写正式字段（新密码）+ 存旧密码副本

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
{"recovery_code": "abandon ability able about above absent absorb abstract accuse achieve acid acoustic"}
```

- 生成 BIP39 12 词恢复码（`secrets.randbelow(2048)` 选取），HMAC-SHA256(server_key, salt + normalized_mnemonic) 后存储
- 任何历史恢复码立即 `permanently_locked`
- 恢复码明文**仅在此响应中返回一次**，服务端只存哈希

### `POST /auth/recovery/initiate`

**用途**：验证恢复码 + 一次性提交新密码。**无 verification_code。**

```json
// Request
{"target":"email","value":"user@example.com",
 "recovery_code": "abandon ability able about above absent absorb abstract accuse achieve acid acoustic",
 "new_auth_key_hash": "...",
 "new_password_salt": "...",
 "new_kdf_settings": {...},
 "new_wrapped_user_key": "..."}          // 用新密码重新 wrap 后的 User Key

// 200
{"cooldown_until": "2026-07-08T13:00:00Z"}
// 400 - 恢复码错误
// 404 - 用户不存在
// 429 - 连续错误达 5 次 + 当月已达 3 次 -> permanently_locked
```

- 验证恢复码 -> 正式字段写新密码 + rollback_* 存旧密码 -> 进入冷却期 -> 多渠道告警
- `users.password_hash` 和 `user_keys.password_wrapped` **不变**
- 冻结时正式字段回滚 = rollback_*，旧密码恢复

### `GET /auth/recovery/status`

**用途**：查询当前恢复码状态，供前端倒计时。

```json
// 200
{"status": "none" | "active" | "cooldown" | "permanently_locked",
 "cooldown_remaining_seconds": 86400,
 "monthly_initiation_count": 1,
 "failed_attempt_count": 0}
```

### `POST /auth/recovery/accelerate`

**用途**：加速通道——通过验证码立即激活新密码，跳过剩余冷却期。

```json
// Request
{"signed_token": "一次性签名URL token",
 "verification_code": "123456"}

// 204 No Content（无响应体）
// 400 — token 无效/过期 / 验证码错误
```

- 验证签名 token（TTL 与冷却期一致 24h；一次性由状态机保证：操作后 status=active，重放返回 409）
- 验证码（5 次/小时，10 次/天）
- 通过后：清 rollback_*，status=active（新密码已生效）

### `POST /auth/recovery/freeze`

**用途**：终止恢复，回滚到旧密码。无需登录，一次性签名 URL。

```json
// Request
{"signed_token": "一次性签名URL token"}

// 204 No Content（无响应体）
// 400 — token 无效/过期
```

- 正式字段回滚 = rollback_*，清 rollback_*
- `status → active`
- `monthly_initiation_count` 保持不变（已 +1 不减少）
- 旧密码恢复（正式字段回滚 = rollback_*）

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
| 8 | POST | /auth/login/google | 无 | L1+L2 | — |
| 9 | POST | /auth/change-password | Bearer | L2 | +verification_code |
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
