# SafeBox 恢复码机制

---

## 一、设计目标

| 目标 | 说明 |
| :--- | :--- |
| **合法用户逃生** | 用户丢失登录密码 + 邮箱/手机不可用时，仍能通过恢复码恢复账户。恢复码使用不要求验证码，避免死锁。 |
| **被盗后可拦截** | 恢复码被盗后，攻击者无法在用户不知情的情况下完成数据窃取。合法用户有明确的拦截手段。 |
| **不被骚扰拖垮** | 攻击者不能通过反复触发恢复流程骚扰用户或耗尽恢复码有效性。 |
| **冷却期锁定账户** | 恢复即进入 24h 冷却期，期间账户锁定（新旧密码、旧 access token 均不可用，零窗口）。 |

---

## 二、恢复码

- BIP39 12 词助记词（132bit 熵），**客户端生成**，注册时展示一次。
- 客户端上传恢复码明文给服务端，服务端计算 `HMAC-SHA256(server_key, salt + normalized_mnemonic)` 存哈希，不存明文。
- 恢复码是 K 的种子（与主密码一起派生 K），永久不变，不重生成。
- `server_key` = 环境变量 `SAFEBOX_RECOVERY_HMAC_KEY`（base64 32 字节），数据库泄露后无法离线验证。

---

## 三、两步 initiate

### 步骤 1：POST /auth/recovery/initiate

请求：`{ recovery_code, new_auth_key_hash, new_login_salt, target, value }`

服务端：
1. 按 target/value 查找用户（邮箱或手机号，用于定位账户，非发送告警邮件）。
2. 验恢复码 HMAC（恢复码 132bit 不可暴力枚举，不累积失败计数、不永久锁定。失败由 RateLimitMiddleware 100/h 防骚扰）。
3. 检查冷却期（已在 cooldown → 409）。
4. 检查 pending_initiate（已有未过期 → 409，提示查看邮件进行加速或冻结，不允许覆盖。15min 过期后可重新发起）。
5. 验通过后建待确认态（不改正式字段、不进冷却）：存 `pending_initiate_token`（sha256）、`pending_new_*`。
6. 返回 `{ encrypted_user_key, recovery_salt, initiate_token }`（15min 有效）。

客户端：
- 用恢复码[+主密码] + recovery_salt 派生 K。
- 解 encrypted_user_key 拿到 User Key（K 不变，User Key 不变，数据不动）。
- 用新登录密码重包 cached_K。
- 调步骤 2。

### 步骤 2：POST /auth/recovery/confirm

请求：`{ initiate_token }`

服务端：
1. 验 token（sha256 比对 + 15min 时效）。
2. 存旧登录密码到 `rollback_*`（auth_key_hash + login_salt + password_version）。
3. 写正式：新 auth_key_hash + login_salt + password_version+1。
4. status=cooldown, cooldown_until=now+24h。
5. revoke_all_user_tokens（切断所有旧会话）。
6. 清 pending_initiate_*。
7. 发告警邮件（含 accelerate/freeze 链接）。

**K 不变、User Key 不变、encrypted_user_key 不变，数据不动。**

---

## 四、冷却期与零窗口

### A：revoke refresh token
confirm 时吊销所有 refresh token，旧会话无法续命。

### D：中间件冷却门
`require_not_in_cooldown` 挂在数据访问端点（sync/register-device/account/change-password）。冷却期内拒所有 access-token 请求，**不等 30min 过期**。

豁免：accelerate/freeze（签名 token，不走 access token）、status（只读）。

### 冷却期行为
- 新旧密码登录：403（login 端冷却门）。
- 旧 access token 调 sync：403（D 门）。
- refresh token：401（已被 revoke）。

---

## 五、三个分支

### accelerate（验证码 + 签名 token）
```
点击加速链接 → 输入验证码 → 验证码正确
→ status=active, 清 rollback（新登录密码确认生效）
→ 可用新密码登录
```

### freeze（签名 token，无需验证码）
```
点击冻结链接 → 正式字段回滚 = rollback_*（旧登录密码 + 旧 password_version 恢复）
→ status=active, 清 rollback
→ 可用旧密码登录
```

### 冷却到期 + 首次登录
```
cooldown_until 到期 → 无系统动作
→ 用户用新密码登录 → 登录门放行 → 验证通过
→ 清 rollback, status=active
```

---

## 六、签名 token（accelerate/freeze）

confirm 成功后，服务端生成两个签名 token，通过告警邮件发送给用户：

| 项 | 说明 |
|---|---|
| 算法 | JWT HS256 |
| 密钥 | 独立 recovery_signing_key（回退到 jwt_secret_key） |
| 有效期 | 24h（与冷却期一致） |
| payload | `{sub: user_id, action: "accelerate"/"freeze", rc_id: recovery_code_id}` |
| 生成时机 | confirm 成功后，随告警邮件发送 |
| 一次性保证 | 由状态机保证（操作后 status 变 active，重放返回 409） |

用户点击邮件中的链接（含 signed_token）触发 accelerate 或 freeze。

---

## 七、API 端点

| 方法 | 路径 | 用途 |
| :--- | :--- | :--- |
| POST | /auth/recovery/initiate | 步骤 1：验恢复码，返回 encrypted_user_key + initiate_token |
| POST | /auth/recovery/confirm | 步骤 2：验 token，写正式 + 进冷却 + 吊销 token + 发告警邮件（含签名 token） |
| POST | /auth/recovery/accelerate | 验证码 + 签名 token 解除冷却 |
| POST | /auth/recovery/freeze | 签名 token 回滚旧密码 |
| GET | /auth/recovery/status | 查询状态（纯读） |

---

## 八、核心原则

| 原则 | 说明 |
| :--- | :--- |
| 服务端只存 HMAC 哈希 | 恢复码生成后仅返回一次 |
| 恢复码永久 | K 的种子，不重生成、不限次 |
| 恢复码使用不要求验证码 | 最后逃生通道 |
| 验证码只用于加速通道 | 没有也能等冷却结束用新密码登录 |
| 冷却期账户锁定 | D 门挡所有 token 访问 |
| 副本清除允许押后 | accelerate/freeze 立即清；首次登录清副本允许押后（清不掉无害） |
| 零知识边界 | 客服、服务器任何时候都接触不到明文密钥 |
