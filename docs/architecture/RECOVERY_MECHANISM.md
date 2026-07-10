# SafeBox 恢复码机制完整规范

> 版本：v2.5
> 状态：定稿
> 适用范围：后端 API、前端交互、安全风控、客服流程
> 关联文档：OVERALL_PLAN.md, DATA_FLOW.md, API_CONTRACT.md, REFACTOR_PLAN.md

---

## 一、设计目标（四个必须同时满足）

| 目标 | 说明 |
| :--- | :--- |
| **目标 1：合法用户逃生** | 用户在丢失 Master Password + 邮箱/手机不可用时，仍能通过恢复码恢复账户。恢复码使用不得要求任何验证码，避免死锁。 |
| **目标 2：被盗后可拦截** | 恢复码被盗后，攻击者无法在用户不知情的情况下完成数据窃取。合法用户必须有明确的、可操作的拦截手段。 |
| **目标 3：不被骚扰拖垮** | 攻击者不能通过反复触发恢复流程来骚扰用户（频繁发告警邮件/短信）或耗尽恢复码的有效性。 |
| **目标 4：冷却期锁定账户** | 恢复即设置新密码并进入 24h 冷却期，期间账户锁定（新旧密码、旧 access token 均不可用，零窗口）。冷却到期后用新密码登录即生效。 |

---

## 二、实体定义（数据库设计参考）

### recovery_codes 表

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `recovery_code_hash` | VARCHAR(128) | 恢复码的哈希值，HMAC-SHA256(server_key, salt + normalized_mnemonic)，绝不存储明文 |
| `recovery_code_salt` | VARCHAR(64) | 该恢复码专用的盐值，作为 HMAC 消息的一部分（非 HMAC 密钥） |
| `status` | VARCHAR(32) | `active` / `cooldown` / `permanently_locked` |
| `cooldown_until` | TIMESTAMPTZ | 冷却到期时间（initiate 时 = now + 24h）。登录门：`now < cooldown_until` 则拒绝登录 |
| `rollback_auth_key_hash` | VARCHAR(128) | 旧密码 bcrypt hash（initiate 时存，freeze 回滚用） |
| `rollback_password_salt` | VARCHAR(128) | 旧 salt |
| `rollback_kdf_settings` | TEXT | 旧 kdf_settings（JSON） |
| `rollback_wrapped_user_key` | TEXT | 旧 password_wrapped |
| `pending_initiate_token` / `pending_initiate_at` | | 两步 initiate 待确认态（step1 存，step2 用后清，15min 过期）|
| `pending_new_*` | | step1 暂存新密码材料（step2 写正式后清）|
| user_keys.`recovery_wrapped` / `recovery_salt` | | 恢复码派生密钥包裹的 User Key（generate 时存，数据恢复用）|
| `monthly_initiation_count` | INTEGER | 成功发起恢复次数（+1/次，>3 永久锁定；月度重置待实现） |
| `failed_attempt_count` | INTEGER | 24 小时滑动窗口内的连续失败次数（成功后清零） |
| `failed_attempt_last_at` | TIMESTAMPTZ | 最后一次失败的时间（用于 24h 窗口判断） |
| `created_at` | TIMESTAMPTZ | 恢复码生成时间 |

### 核心技术说明：数据恢复 + 副本回滚 + 两步 initiate

**数据恢复（recovery_wrapped）**：恢复码不只是认证凭据，还派生密钥包裹 User Key。
```
generate（已登录，User Key 在内存）:
  恢复码明文 -> deriveKey(码, recovery_salt) -> 恢复密钥
  -> 用恢复密钥包裹当前 User Key -> recovery_wrapped（存 user_keys）
```
恢复时客户端用恢复码解 recovery_wrapped 拿到【旧 User Key】，用新密码重包。
**User Key 不换**，所以 Item Keys / 条目密文不动，数据可用。

**两步 initiate（防一次性提交泄露 + 状态确认）**：
```
step1 POST /initiate（恢复码 + 新密码材料）:
  验码通过 -> 建 pending_initiate_*（token 哈希 + 暂存新密码）-> 不改正式字段
  -> 返回 recovery_wrapped + recovery_salt + initiate_token（15min）
step2 POST /confirm（initiate_token + new_wrapped_user_key）:
  验 token -> 正式字段写新密码 + rollback_* 存旧 + status=cooldown
  + revoke_all_user_tokens（A 切断旧会话）+ 清 pending_initiate_*
```
客户端在两步之间：用恢复码解 recovery_wrapped 拿旧 User Key，用新密码重包。

**冷却零窗口（A + D）**：
- A：confirm 吊销所有 refresh token。
- D：冷却门（require_not_in_cooldown 依赖）挂在数据访问端点（sync/register-device/account/change-password/generate/revoke）；冷却期内拒所有 access-token 请求。accelerate/freeze（签名 token）/status（只读）豁免。**旧 access token 立即失效，不等 30min 过期**。

**副本回滚**：freeze 把正式字段回滚 = rollback_*（旧密码恢复）；accelerate/冷却后首次登录清 rollback。

---

## 三、完整流程（分阶段详解）

### 阶段 1：首次生成恢复码（安全设置页）

**触发条件**：用户已登录（通过 Master Password 认证）。

**前置校验（双重验证）**：
1. 必须通过邮箱或手机验证码（二选一）验证身份。
2. 必须输入当前 Master Password 二次确认。

**生成逻辑**：
1. 使用 `secrets.randbelow(2048)` 从 BIP39 2048 词表中均匀选取 12 个词，生成 132 bit 熵的恢复码明文。
2. `recovery_code_hash = HMAC-SHA256(server_key, salt + normalized_mnemonic)`。
3. `status = active`。
4. 如有历史恢复码存在，立即设置为 `permanently_locked`（一人一码）。
5. `monthly_initiation_count = 0, failed_attempt_count = 0`。

### 阶段 2：使用恢复码发起恢复（登录页）

**关键铁律（一票否决项）**：恢复码使用**绝对不要求**验证码。

**步骤 2.1：验证恢复码**
- 服务端 HMAC-SHA256(server_key, salt + normalized_mnemonic) 比对。
- 错误次数：24h 窗口内连续失败 ≥ 5 次 -> `permanently_locked`（计数跨请求累加）。

**步骤 2.2：立即设置新 Master Password + 进入冷却期**
- 用户设置新密码，客户端用新密码派生新密钥、重新 wrap User Key。
- 提交至服务端，`initiate`：
  - 正式字段写入新密码（auth_key_hash / password_salt / kdf_settings / password_wrapped）
  - 旧密码存入 `rollback_*`
  - `status -> cooldown`，`cooldown_until = now + 24h`
  - `monthly_initiation_count + 1`（>3 -> permanently_locked）
- 触发告警（含加速/冻结链接）。

**注意**：`users`/`user_keys` 正式字段此时**已改为新密码**。冷却期靠状态门（`is_in_cooldown`）锁定账户，而非延迟写入。

### 阶段 3：24 小时冷却期 + 实时告警

**冷却期**：账户锁定，登录被拒（`now < cooldown_until`）。新旧密码均不可登录。

**告警**：向邮箱/手机发送安全告警，含两个链接：

| 链接 | 用途 | 需要验证码？ |
| :--- | :--- | :--- |
| **我是本人，立即恢复** | accelerate：解除冷却，新密码生效 | ✅ 需要验证码 |
| **这不是我操作，立即冻结** | freeze：回滚旧密码 | ❌ 不需要 |

### 阶段 4：三个核心分支

#### 分支 A：加速通道（accelerate）

```
点击加速链接（签名 token，TTL 与冷却期一致）
  -> 输入验证码
  -> 验证码正确：status=active, 清 rollback（回滚窗口关闭）
  -> 新密码已生效，可登录
```

#### 分支 B：冻结（freeze）

```
点击冻结链接（签名 token）
  -> 正式字段回滚 = rollback_*（旧密码恢复）
  -> status=active, 清 rollback
  -> 用户使用旧 Master Password 登录
```

冻结后：恢复码保持 `active` 可再次使用（受月发起次数限制）；`monthly_initiation_count` 已 +1，不因冻结减少。

#### 分支 C：冷却期自然结束 + 首次登录

```
cooldown_until 到期
  -> 无系统动作（时间到了）
  -> 用户用新密码登录
  -> 登录门放行（now >= cooldown_until）
  -> verify_auth_key(新密码, 新 hash) 通过
  -> 清 rollback, status=active（押后清理）
```

用户无需系统"自动激活"操作，直接用新密码登录即生效。

---

## 四、状态流转图

```
  [*] -> active（首次生成，需验证码 + 主密码）
         │
         │ POST /auth/recovery/initiate（恢复码 + 新密码，无验证码）
         │   正式字段=新密码，rollback_*=旧密码
         ▼
  cooldown（冷却期 24h，账户锁定）
         │
         ├── POST /auth/recovery/accelerate（验证码 + 签名 token）
         │    -> 清 rollback -> active（新密码生效）
         │
         ├── 冷却到期 + 首次新密码登录成功
         │    -> 清 rollback -> active（新密码生效）
         │
         └── POST /auth/recovery/freeze（签名 token，无需验证码）
              -> 回滚正式=rollback_* + 清 rollback -> active（旧密码恢复）

  active -> permanently_locked（月发起 >3 次，或连续失败 ≥5 次，或主动作废）
```

---

## 五、API 端点

| 方法 | 路径 | 用途 | 关键约束 |
| :--- | :--- | :--- | :--- |
| POST | /auth/recovery/generate | 生成新恢复码（已登录） | 需验证码 + 当前密码 |
| POST | /auth/recovery/initiate | 发起恢复（验证恢复码 + 提交新密码） | 无验证码，进入冷却期，正式字段即写新密码 |
| POST | /auth/recovery/accelerate | 加速通道（验证码解除冷却） | 需验证码 + 签名 token |
| POST | /auth/recovery/freeze | 回滚旧密码 | 签名 token，无需登录 |
| GET | /auth/recovery/status | 查询当前恢复码状态（纯读） | 前端倒计时 |
| POST | /auth/recovery/revoke | 主动作废旧码（已登录） | 需验证码 + 当前密码 |
| POST | /admin/recovery/unlock | 客服解除永久锁定 | 管理员权限（未实现） |

---

## 六、测试用例

| # | 场景 | 预期 |
| :--- | :--- | :--- |
| TC-01 | 发起恢复 + accelerate + 验证码正确 | 解除冷却，新密码可登录，rollback 清空 |
| TC-02 | 发起恢复 + 不操作 + 24h 后用新密码登录 | 登录成功，rollback 清空，status=active |
| TC-03 | freeze | 正式字段回滚旧密码，旧密码可登录，新密码失效 |
| TC-04 | freeze 后用旧密码登录 | 登录成功 |
| TC-05 | 恢复码连续输入错误 5 次 | permanently_locked |
| TC-06 | 月发起恢复 >3 次 | permanently_locked |
| TC-07 | 冷却期内登录（新或旧密码） | 403 账户冷却中 |
| TC-08 | 冷却期内攻击者使用同一恢复码再次发起 | 409 流程已在处理中 |

---

## 七、核心原则

| 原则 | 说明 |
| :--- | :--- |
| 服务端只存储哈希值，不存储明文 | 恢复码生成后仅返回一次，服务端只存 HMAC 哈希 |
| 使用独立盐值，防止彩虹表攻击 | 每个恢复码有独立随机 salt |
| HMAC 使用服务端密钥 | `server_key` 为环境变量，数据库泄露后无法离线验证候选恢复码 |
| 恢复码使用不需要验证码 | 最后逃生通道，绝对不要求验证码 |
| 验证码只用于加速通道 | 加速器而非必需品，没有也能等冷却结束用新密码登录 |
| 冷却期账户锁定 | initiate 即写新密码，冷却期靠状态门锁定（新旧密码均不可登），防旧密码在恢复期被利用 |
| 副本清除允许押后 | accelerate/freeze 立即清（意图明确）；首次登录清副本允许押后（清不掉无害） |
| 登录零写入 | 登录只读状态门判断冷却，不触发激活写入（无异步尾巴） |
| 零知识边界绝不跨越 | 客服、服务器任何时候都接触不到明文密钥 |

---

## 八、版本历史

| 版本 | 日期 | 变更说明 |
| :--- | :--- | :--- |
| v2.0-final | 2026-07-07 | 初始版本 |
| v2.1-final | 2026-07-07 | 一次性完成操作；冷却期 24h；加速/冻结；自动激活 |
| v2.3-final | 2026-07-08 | HMAC 引入服务端密钥 server_key（深度防御） |
| v2.4 | 2026-07-10 | 状态机重设计：取消 pending_* 延迟写入与 auto_activate 异步尾巴；initiate 即写正式字段+存 rollback_* 副本；冷却期账户锁定；freeze 回滚旧密码；登录零写入（纯状态门）；副本清除押后到首次登录 |
| v2.5 | 2026-07-10 | 恢复 recovery_wrapped（数据恢复：恢复码派生密钥包裹 User Key，User Key 不换、数据不动）；两步 initiate（initiate 验码+返回 recovery_wrapped / confirm 验 token+提交重包）；A+D 冷却零窗口（revoke refresh + 中间件冷却门挡所有 access-token 请求）；移除 reset-password（零知识下无法恢复数据）|
