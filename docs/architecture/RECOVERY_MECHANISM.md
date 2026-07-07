# SafeBox 恢复码机制完整规范

> 版本：v2.2-final
> 状态：定稿
> 适用范围：后端 API、前端交互、安全风控、客服流程
> 关联文档：OVERALL_PLAN.md, DATA_FLOW.v2.md, API_CONTRACT.v2.md, REFACTOR_PLAN.md

---

## 一、设计目标（四个必须同时满足）

| 目标 | 说明 |
| :--- | :--- |
| **目标 1：合法用户逃生** | 用户在丢失 Master Password + 邮箱/手机不可用时，仍能通过恢复码恢复账户。恢复码使用不得要求任何验证码，避免死锁。 |
| **目标 2：被盗后可拦截** | 恢复码被盗后，攻击者无法在用户不知情的情况下完成数据窃取。合法用户必须有明确的、可操作的拦截手段。 |
| **目标 3：不被骚扰拖垮** | 攻击者不能通过反复触发恢复流程来骚扰用户（频繁发告警邮件/短信）或耗尽恢复码的有效性。 |
| **目标 4：一次性完成操作** | 用户发起恢复时，一次性完成"输入恢复码 + 设置新密码"的全部操作。冷却期结束后系统自动激活，用户无需二次确认。 |

---

## 二、实体定义（数据库设计参考）

### recovery_codes 表

| 字段 | 类型 | 说明 |
| :--- | :--- | :--- |
| `recovery_code_hash` | VARCHAR(128) | 恢复码的哈希值（加盐），绝不存储明文 |
| `recovery_code_salt` | VARCHAR(64) | 该恢复码专用的盐值 |
| `status` | VARCHAR(32) | `active` / `pending_activation` / `permanently_locked` / `consumed` |
| `pending_new_auth_key_hash` | VARCHAR(128) | 用户设置的新密码哈希（用于加速通道验证） |
| `pending_password_wrapped` | TEXT | 用新密钥加密后的 passwordWrapped（冷却期满后写入 user_keys） |
| `pending_setup_at` | TIMESTAMPTZ | 用户提交新密码的时间（冷却起始） |
| `cooldown_expires_at` | TIMESTAMPTZ | 冷却到期时间（pending_setup_at + 24h） |
| `recovery_attempt_count` | INTEGER | 当月已发起恢复次数（每月 1 日重置为 0） |
| `created_at` | TIMESTAMPTZ | 恢复码生成时间 |
| `consumed_at` | TIMESTAMPTZ | 消耗时间 |

### 核心技术说明：为什么冻结不需要恢复旧密码

```
冷却期内，数据库同时保留两套数据：

正常字段（users/user_keys 表）:
  password_hash       → 旧密码 bcrypt hash（不变）
  password_salt       → 旧 salt（不变）
  password_wrapped    → 旧 wrapped key（不变）

pending 字段（recovery_codes 表）:
  pending_new_auth_key_hash   → 新密码 bcrypt hash
  pending_password_wrapped     → 新 wrapped key
  pending_setup_at            → 提交时间
  cooldown_expires_at         → now + 24h

冻结操作 = 删除 pending_* 字段，什么都不恢复。
激活操作 = 把 pending_* 写入 users/user_keys 表。

旧数据从未被覆盖，所以冻结 = 天然回滚。
```

---

## 三、完整流程（分阶段详解）

### 阶段 1：首次生成恢复码（安全设置页）

**触发条件**：用户已登录（通过 Master Password 认证）。

**前置校验（双重验证）**：
1. 必须通过邮箱或手机验证码（二选一）验证身份。
2. 必须输入当前 Master Password 二次确认。

**生成逻辑**：
1. 使用 `secrets.randbelow(2048)` 从 BIP39 2048 词表中均匀选取 12 个词，生成 132 bit 熵的恢复码明文。
2. `recovery_code_hash = HMAC-SHA256(recovery_code_salt, plaintext)`。
3. `status = active`。
4. 如有历史恢复码存在，立即设置为 `permanently_locked`（一人一码）。
5. `recovery_attempt_count = 0`。

### 阶段 2：使用恢复码发起恢复（登录页）

**关键铁律（一票否决项）**：恢复码使用**绝对不要求**验证码。

**步骤 2.1：验证恢复码**
- 用户输入恢复码明文。支持粘贴，不支持密码管理器自动填充。
- 服务端 HMAC-SHA256 比对。
- 错误次数：≤ 5 次仅记录日志，≥ 5 次 → `permanently_locked`。

**步骤 2.2：立即设置新 Master Password（一次性完成全部操作）**
- 用户设置新密码（规则同注册：≥ 12 字符，大小写/数字/特符）。
- 客户端用新密码派生新密钥，重新 wrap User Key（本地操作）。
- 提交至服务端：
  - `pending_new_auth_key_hash` — 新密码 bcrypt hash
  - `pending_password_wrapped` — 新 wrapped key
  - `status → pending_activation`
  - `pending_setup_at = now()`
  - `cooldown_expires_at = now() + 24h`
  - `recovery_attempt_count + 1`
- 保险库冻结，触发告警。

**注意**：`users.password_hash` 和 `user_keys.password_wrapped` **此时不会被修改**。旧数据完整保留。

### 阶段 3：24 小时冷却期 + 实时告警

**冷却期**：保险库冻结，新密码处于 `pending_activation`。

**告警（5 秒内触发）**：向邮箱和手机发送安全告警。

**邮件必须包含两个链接**：

| 链接 | 用途 | 需要验证码？ |
| :--- | :--- | :--- |
| **我是本人，立即恢复** | 加速通道，立即激活新密码 | ✅ 需要验证码 |
| **这不是我操作，立即冻结** | 终止恢复，回滚到旧密码 | ❌ 不需要 |

### 阶段 4：三个核心分支

#### 分支 A：加速通道（点击"我是本人，立即恢复"）

```
点击加速链接（签名 + 15 分钟有效 + 一次性）
  → 输入邮箱/手机验证码
  → 验证码正确：pending_* 写入 users/user_keys，status → consumed
  → 验证码错误：可重试（5 次/小时，10 次/天）
```

此处验证码是"加速通道的钥匙"，不是"使用恢复码的前提"——即使无法接收验证码，等待 24 小时自动激活。

#### 分支 B：冻结（点击"这不是我操作，立即冻结"）

```
点击冻结链接（签名 + 15 分钟有效 + 一次性）
  → 确认冻结
  → 丢弃 pending_* 字段（物理删除或标记废弃）
  → status 回退 active
  → 旧密码保持不变（从未被覆盖）
```

**冻结后的关键状态**：
- 用户使用旧 Master Password 正常登录
- 恢复码保持在 `active`，可再次使用（受月尝试次数限制）
- `recovery_attempt_count` 已 +1，不因冻结而减少

#### 分支 C：冷却期自然结束

```
cooldown_expires_at 到期
  → 系统检查 status 仍为 pending_activation
  → pending_* 写入 users/user_keys
  → status → consumed
  → 用户使用新密码登录
```

用户无需执行任何操作。

---

## 四、状态流转图

```
  [*] → active（首次生成，需验证码 + 主密码）
         │
         │ POST /auth/recovery/initiate（输入恢复码 + 提交新密码，无验证码）
         ▼
  pending_activation（冷却期 24 小时，保险库冻结）
         │
         ├── POST /auth/recovery/accelerate（验证码 + 签名链接）
         │    → 立即激活 → consumed
         │
         ├── 冷却自然结束
         │    → 自动激活 → consumed
         │
         └── POST /auth/recovery/freeze（签名链接，无需验证码）
              → 丢弃 pending，回退 active

  active → permanently_locked（月尝试 ≥ 3 次，或连续失败 ≥ 5 次，或用户主动作废）
  permanently_locked → [*] 客服核身重置（新码 active，旧码 consumed）
```

---

## 五、API 端点

| 方法 | 路径 | 用途 | 关键约束 |
| :--- | :--- | :--- | :--- |
| POST | /auth/recovery/generate | 生成新恢复码（已登录） | 需验证码 + 当前密码 |
| POST | /auth/recovery/initiate | 发起恢复（验证恢复码 + 提交新密码） | 无验证码，进入冷却期 |
| POST | /auth/recovery/accelerate | 加速通道（验证码立即激活） | 需验证码 + 签名链接 token |
| POST | /auth/recovery/freeze | 终止恢复（回滚到旧密码） | 签名 URL，无需登录 |
| GET | /auth/recovery/status | 查询当前恢复码状态 | 前端倒计时 |
| POST | /auth/recovery/revoke | 主动作废旧码（已登录） | 需验证码 + 当前密码 |
| POST | /admin/recovery/unlock | 客服解除永久锁定 | 管理员权限 |

---

## 六、测试用例

| # | 场景 | 预期 |
| :--- | :--- | :--- |
| TC-01 | 发起恢复 + 点击加速 + 验证码正确 | 立即激活，跳过剩余冷却，旧码 consumed |
| TC-02 | 发起恢复 + 不操作 + 24 小时后 | 自动激活，旧码 consumed |
| TC-03 | 点击冻结 | 丢弃新密码，回滚旧密码，状态回退 active |
| TC-04 | 冻结后用旧密码登录 | 登录成功，保险库数据完整 |
| TC-05 | 恢复码连续输入错误 5 次 | permanently_locked |
| TC-06 | 月发起恢复次数 ≥ 3 次 | permanently_locked |
| TC-07 | 永久锁定后客服核身重置 | 系统发送重置链接，用户生成新码 |
| TC-08 | 冷却期内攻击者使用同一恢复码 | 返回"流程已在处理中，请勿重复操作" |
| TC-09 | 激活成功后旧恢复码状态 | consumed，不可再次使用 |
| TC-10 | 加速链接过期 | 提示链接已过期，引导等待冷却结束 |

---

## 七、核心原则

| 原则 | 说明 |
| :--- | :--- |
| 恢复码使用不需要验证码 | 最后逃生通道，绝对不要求验证码 |
| 验证码只用于加速通道 | 加速器而非必需品，没有也能等冷却结束自动恢复 |
| 一次性完成所有操作 | 用户输入恢复码的同时设好新密码，冷却结束自动激活 |
| 24 小时冷却期覆盖睡眠 | 足够长的窗口确保醒来后仍有时间拦截 |
| 冻结 = 回滚，不等同于作废 | 旧数据从未覆盖，冻结即恢复原状态 |
| 零知识边界绝不跨越 | 客服、服务器任何时候都接触不到明文密钥 |

---

## 八、版本历史

| 版本 | 日期 | 变更说明 |
| :--- | :--- | :--- |
| v2.0-final | 2026-07-07 | 初始版本 |
| v2.1-final | 2026-07-07 | 一次性完成所有操作；冷却期 24h；加速通道（需验证码）；冻结（无验证码）；自动激活 |
| v2.2-final | 2026-07-07 | 纯文本格式化，变量名适配代码规范 |
