# SafeBox 重构执行计划

> 版本: v3.3
> v3.2 → v3.3 变更:
>   - Step 6a recovery_codes 表：pending_password_wrapped → pending_wrapped_user_key（字段名和语义修正）
>   - Step 6 删除 6f/6g 旧版本残留（recovery-init/cancel/complete 端点与告警）
>   - Step 6e 重新组织告警通知（4 场景：initiate/accelerate/freeze/自动激活）
>   - Step 10 checkPasswordStrength 弱模式检测改为连续序列检测（移除以子串匹配的方式）
>   - Step 2.5 加密流程明确 AAD 拼接格式：`itemType:fieldName`
>   - Step 1b Web Worker 增加 try-catch 错误处理
>   - Deploy 回滚测试明确"开关关=只写 v1 仍读 v1+v2，用户零感知"
>   - Step 6 补充恢复码生成二次确认交互细节

---

## 执行总览

```
Wave 1 (P0) ─── 安全强化
  Step 1: KDF 可配置化（含 Web Worker）
  Step 2: AES-GCM + 字段 AAD 函数
  Step 2.5: Item Key 加密 + VaultContext 适配（重写）
  Step 4: 后端 auth_key_hash 适配
  Step 5: 前端适配
  ── 验收：全链路跑通 ──

Stage 1.5 (P1 非阻塞)
  Step 9: 注册幂等性
  Step 10: 密码强度 12+ 含复杂度校验

Wave 2 (P1) ─── 功能补全
  Step 6: 恢复码机制（BIP39 助记词 + 服务端 HMAC 验证 + 24h 冷却期 + 加速通道 + 冻结回滚）
  Step 7: GET /salt 精简
  Step 8: change-password（含邮箱验证码）+ 敏感操作验证码保护
  Step 8.5: 注销账号增加邮箱验证码

Wave 3 (P2) ─── 代码组织清理（不变）

Wave 4 (P3) ─── 体验完善（不变）

Deploy ─── Feature Flag 发布策略
```

---

## Wave 1

### Step 1: KDF 可配置化

**Step 1a — 后端 schema + model**（同 v2.0，不变）

**Step 1b — `crypto/kdf.ts` + `crypto/kdf.worker.ts`**

主线程入口 (`web/src/crypto/kdf.ts`)：

```typescript
export type KdfSettings = 
  | { algorithm: "pbkdf2"; iterations: number }
  | { algorithm: "argon2id"; memory: number; iterations: number; parallelism: number };

export const DEFAULT_KDF: KdfSettings = { algorithm: "pbkdf2", iterations: 600_000 };
export const RECOMMENDED_KDF: KdfSettings = { algorithm: "pbkdf2", iterations: 600_000 };

// 通过 Web Worker 执行 PBKDF2，避免主线程阻塞
const worker = new Worker(new URL("./kdf.worker.ts", import.meta.url));

export function deriveBits(
  password: string, salt: Uint8Array, settings: KdfSettings, length: number,
): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => resolve(e.data);
    worker.onerror = (e) => reject(e);
    worker.postMessage({ password, salt, settings, length });
  });
}

export async function deriveKey(password, salt, settings = DEFAULT_KDF): Promise<CryptoKey> {
  const bits = await deriveBits(password, salt, settings, 256);
  return crypto.subtle.importKey("raw", new Uint8Array(bits), "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** 与 Android 兼容：PBKDF2(password, salt+"auth") */
export async function deriveAuthKey(password, salt, settings = DEFAULT_KDF): Promise<string> {
  const authSalt = new Uint8Array(salt.length + 4);
  authSalt.set(salt);
  authSalt.set([0x61, 0x75, 0x74, 0x68], salt.length);
  const bits = await deriveBits(password, authSalt, settings, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}
```

Web Worker (`web/src/crypto/kdf.worker.ts`)：

```typescript
self.onmessage = async (e) => {
  try {
    const { password, salt, settings, length } = e.data;
    if (settings.algorithm === "pbkdf2") {
      const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
      const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", salt, iterations: settings.iterations, hash: "SHA-256" },
        keyMaterial, length,
      );
      self.postMessage({ success: true, data: bits });
    }
  } catch (err) {
    self.postMessage({ success: false, error: (err as Error).message });
  }
};
```

---

### Step 2: AES-GCM + 字段 AAD 函数（同 v2.0，无变化）

---

### Step 2.5: VaultContext 适配 + Item Key 加密（重写）

**目标**：条目加密引入 Item Key 层。每条条目创建时随机生成 Item Key，User Key 包裹后存储。

`web/src/context/VaultContext.tsx`：

```typescript
import { generateAesKey, aesEncrypt, aesDecrypt, importAesKey, exportAesKey } from "../crypto/aes";

// AAD 拼接规则：itemType:fieldName
// 例如 login:name, note:data, credit_card:data
// 不同 itemType 的 data 字段 AAD 不同，防止密文跨类型移动

async function encryptField(userKey, plaintext, fieldName, itemType?) {
  const itemKey = await generateAesKey();                    // 每条目一个随机 Item Key
  const itemKeyRaw = await exportAesKey(itemKey);            // 导出 raw bytes
  const encryptedKey = await aesEncrypt(userKey, itemKeyRaw); // User Key 包裹 Item Key
  const ciphertext = await aesEncryptField(itemKey, plaintext, fieldName, itemType);
  return { encrypted_key: encryptedKey, ciphertext };
}
```

条目结构变更：

```typescript
// v2 格式（纯 v2，无 encryption_version 字段）
{ type: "login",
  name: { encrypted_key: "...", ciphertext: "..." },
  data: { encrypted_key: "...", ciphertext: "..." } }
```

解密按 version 字段直接调度：

```typescript
async function decryptField(userKey, rsaPrivateKey, field, version, fieldName) {
  if (version === 2) {
    const itemKeyRaw = await aesDecrypt(userKey, field.encrypted_key);
    if (!itemKeyRaw) return null;
    const itemKey = await importAesKey(itemKeyRaw);
    const result = await aesDecryptField(itemKey, field.ciphertext, fieldName);
    if (result !== null) return new TextDecoder().decode(result);
  }
  // version === 1: 旧 RSA 格式
  return rsaDecryptString(rsaPrivateKey, field.ciphertext);
}
```

**非同布更新**：服务端 `items` 表不需要 schema 变更——`encrypted_key` 字段是前端构筑的 JSON 结构的一部分，存在 `data` TEXT 字段中。服务端不感知。

---

### Step 4: 后端 auth_key_hash（同 v2.0，无变化）

### Step 5: 前端适配（同 v2.0，无变化）

---

## Stage 1.5

### Step 9: 注册幂等性（同 v2.0，无变化）

### Step 10: 密码强度校验（重写）

**强制规则**：
- 最少 12 字符
- 至少 1 个大写字母（`/[A-Z]/`）
- 至少 1 个小写字母（`/[a-z]/`）
- 至少 1 个数字（`/[0-9]/`）
- 至少 1 个特符（`~!@#$%^&*()_+{}[]:;<>,./?'"`）
- 排除弱模式：`123`, `456`, `abc`, `Abc`, `ABC`（`password.includes()` 检查）

```typescript
function checkPasswordStrength(password: string): { ok: boolean; reason?: string } {
  if (password.length < 12) return { ok: false, reason: "最少 12 个字符" };
  if (!/[A-Z]/.test(password)) return { ok: false, reason: "需要大写字母" };
  if (!/[a-z]/.test(password)) return { ok: false, reason: "需要小写字母" };
  if (!/[0-9]/.test(password)) return { ok: false, reason: "需要数字" };
  const SPECIAL_CHARS = `~!@#$%^&*()_+{}[]:;<>,./?'"`;
  if (!password.split('').some(c => SPECIAL_CHARS.includes(c)))
    return { ok: false, reason: "需要特殊字符" };
  // 检测连续递增/递减序列（如 123、abc、CBA），避免误判合法强密码
  if (hasSequentialPattern(password))
    return { ok: false, reason: "包含连续序列，换个密码" };
  return { ok: true };
}

function hasSequentialPattern(password: string): boolean {
  for (let i = 0; i < password.length - 2; i++) {
    const a = password.charCodeAt(i);
    const b = password.charCodeAt(i + 1);
    const c = password.charCodeAt(i + 2);
    if (b === a + 1 && c === a + 2) return true;   // 递增: abc, 123
    if (b === a - 1 && c === a - 2) return true;   // 递减: cba, 321
  }
  return false;
}
```

| 文件 | 改什么 |
|------|--------|
| `web/src/config/constants.ts` | 无需改（逻辑在函数中）|
| `web/src/pages/auth/RegisterPage.tsx` | 调用 `checkPasswordStrength` 替代 `password.length < 12` |
| `web/src/pages/settings/ChangePasswordPage.tsx` | 改密页同样调用 |

---

## Wave 2

### Step 6: 恢复码机制（BIP39 助记词 + 服务端 HMAC 验证 + 24h 冷却期 + 加速通道 + 冻结回滚）

**说明**：恢复码机制改用 BIP39 12 词 + 服务端 HMAC-SHA256 验证模式，替代 v1 的 BIP39 客户端解密 recoveryWrapped 方案。详见 `RECOVERY_MECHANISM.md`。

**6a — 创建 recovery_codes 表**

**HMAC 密钥设计**：恢复码哈希使用服务端密钥 `RECOVERY_HMAC_KEY`（环境变量，32 字节 base64 编码）作为 HMAC 密钥，salt 作为消息的一部分。这样即使数据库完全泄露，没有服务端密钥也无法离线验证恢复码。

```python
def hash_recovery_code(mnemonic: str, salt: str) -> str:
    key = base64.b64decode(settings.recovery_hmac_key)
    normalized = normalize_mnemonic(mnemonic)
    message = salt.encode() + normalized.encode("utf-8")
    return hmac.new(key, message, hashlib.sha256).hexdigest()
```

```sql
CREATE TABLE recovery_codes (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID REFERENCES users(id) ON DELETE CASCADE,
    recovery_code_hash        VARCHAR(128) NOT NULL,   -- HMAC-SHA256(server_key, salt + normalized_mnemonic)
    recovery_code_salt        VARCHAR(64) NOT NULL,    -- 随机盐值，作为 HMAC 消息的一部分（非 HMAC 密钥）
    status                    VARCHAR(32) NOT NULL DEFAULT 'active',
    pending_new_auth_key_hash VARCHAR(128),       -- 新密码的 auth_key_hash（加速通道验证用）
    pending_password_salt     VARCHAR(128),       -- 新密码 salt
    pending_kdf_settings      JSONB,              -- 新 KDF 设置
    pending_wrapped_user_key  TEXT,               -- 用新密码派生的 key 包裹后的 User Key（恢复后解密保险库的核心数据）
    pending_setup_at          TIMESTAMPTZ,        -- 用户提交新密码的时间（冷却起始）
    cooldown_expires_at       TIMESTAMPTZ,        -- pending_setup_at + 24h
    failed_attempt_count       INTEGER NOT NULL DEFAULT 0,     -- 连续失败次数（24h 滑动窗口，成功后清零）
    failed_attempt_last_at     TIMESTAMPTZ,                   -- 最后一次失败的时间（用于 24h 窗口判断）
    monthly_initiation_count   INTEGER NOT NULL DEFAULT 0,    -- 当月成功发起恢复次数（每月 1 日重置）
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    consumed_at               TIMESTAMPTZ
);
CREATE INDEX idx_recovery_codes_user ON recovery_codes(user_id, status);
```

**6b — 客户端变化：注册不再生成恢复码相关字段**
- 移除注册时 `recovery_salt`、`recovery_wrapped` 的生成和上传
- 移除 `crypto/recovery.ts`（不再需要 HKDF 派生 recoveryEncKey）
- 移除 `bip39.ts` 中的 `recoveryCodeToKey`（不再需要 SHA-256 → AES）

**6c — 新增恢复码 API 端点**

| 端点 | 用途 | 关键约束 |
|------|------|---------|
| POST /auth/recovery/generate | 已登录生成新码 | 需验证码 + 当前密码 |
| POST /auth/recovery/initiate | 验证恢复码 + 提交新密码 | 无验证码，含 pending_* 字段 |
| GET /auth/recovery/status | 查询冷却期状态 | 前端倒计时 |
| POST /auth/recovery/accelerate | 加速通道立即激活 | 需验证码 + 签名 token |
| POST /auth/recovery/freeze | 终止恢复回滚旧密码 | 签名 token，无需登录 |
| POST /auth/recovery/revoke | 已登录主动作废旧码 | 需验证码 + 当前密码 |
| POST /admin/recovery/unlock | 客服解除永久锁定 | 管理员权限 |

**6d — RecoveryPage 重写**

恢复码页面包含三个子页面：生成展示页、恢复发起页、冷却期状态页。

**生成展示页（安全设置页 → 生成恢复码）**：

```typescript
// 步骤 1：用户触发生成（需验证码 + 当前密码）
async function handleGenerate() {
  const resp = await apiClient.post("/auth/recovery/generate", {
    verification_code: verifyCode,
    current_auth_key_hash: await deriveAuthKey(currentPassword, salt, kdf),
  });
  // 服务端返回 12 个 BIP39 单词，仅此一次
  setMnemonic(resp.recovery_code);  // 如 "abandon ability able about above absent absorb abstract accuse achieve acid acoustic"
}

// 步骤 2：卡片展示（3 行 × 4 词，便于抄写）
// ┌─────────────────────────────────┐
// │  1. abandon   2. ability   3. able    4. about    │
// │  5. above     6. absent    7. absorb  8. abstract │
// │  9. accuse   10. achieve  11. acid   12. acoustic │
// └─────────────────────────────────┘

// 步骤 3：二次确认（用户输入第 4 词和第 8 词）
const words = mnemonic.split(" ");
const expected1 = words[3];  // 第 4 个词
const expected2 = words[7];  // 第 8 个词
if (userInput1 !== expected1 || userInput2 !== expected2) {
  setError("单词不匹配，请重新核对"); return;
}
// 确认通过 → 提示用户妥善保存 → 关闭展示

// 规范化函数（用户输入恢复码时使用）
function normalizeMnemonic(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, " ");
}
```

**恢复发起页（登录页 → 忘记密码 → 输入恢复码）**：

```typescript
// 用户输入恢复码 + 设置新密码（一次性完成）
async function handleInitiateRecovery() {
  const code = normalizeMnemonic(userInput);  // 规范化后提交

  // 1. 客户端用新密码派生新密钥，重新 wrap User Key
  const newSalt = crypto.getRandomValues(new Uint8Array(32));
  const newPDK = await deriveKey(newPassword, newSalt, kdf);
  const newWrappedUserKey = await aesEncrypt(userKey, newPDK);

  // 2. 一次性提交
  const resp = await apiClient.post("/auth/recovery/initiate", {
    recovery_code: code,
    pending_new_auth_key_hash: await deriveAuthKey(newPassword, newSalt, kdf),
    pending_password_salt: bytesToBase64(newSalt),
    pending_kdf_settings: kdf,
    pending_wrapped_user_key: newWrappedUserKey,
  });
  setCooldownUntil(resp.cooldown_expires_at);  // 24h 倒计时
}

// 加速通道（验证码跳过剩余冷却）
async function handleAccelerate(token, verifyCode) {
  await apiClient.post("/auth/recovery/accelerate", {
    signed_token: token,
    verification_code: verifyCode,
  });
  // 新密码已激活，登录
}

// 冻结（无需登录，签名链接一键回滚）
async function handleFreeze(token) {
  await apiClient.post("/auth/recovery/freeze", {
    signed_token: token,
  });
  // 旧密码保持不变，pending_* 被丢弃
}
```

**冷却期状态页**：显示倒计时 + 加速/冻结操作入口。轮询 `GET /auth/recovery/status` 获取剩余时间。

**6e — 告警通知**
- initiate 时：邮件含两个核心链接（加速 + 冻结）
- accelerate 时：确认邮件"新密码已激活"
- freeze 时：确认邮件"冻结成功，旧密码保持不变"
- 冷却自然结束时：发送"密码已重置"提示邮件

**6f — 尝试次数限制（两个独立计数器）**

恢复码系统维护两个独立的计数器，分别应对不同的攻击场景。

**计数器 1：失败计数（防暴力枚举）**

| 属性 | 值 |
|------|----|
| 统计对象 | 恢复码输入错误的次数（哈希不匹配） |
| 窗口期 | 24 小时（无失败记录满 24 小时后自动归零） |
| 阈值 | 同一恢复码连续失败 ≥ 5 次 |
| 触发后果 | 恢复码状态 → `permanently_locked` |
| 重置条件 | 任意一次成功验证后，立即重置为 0 |

设计目的：防止攻击者通过批量尝试猜测恢复码（虽然 BIP39 12 词有 128-bit 熵，但加一道防线是深度防御的标准实践）。

示例：
```
第1次错误 → 计数=1
第2次错误 → 计数=2
第3次错误 → 计数=3
第4次错误 → 计数=4
第5次正确 → 验证通过，计数重置为 0 → 进入冷却期

第1次错误 → 计数=1
... 超过 24 小时无任何失败记录 ...
第2次错误 → 计数=1（24 小时窗口到期，自动归零后重新计数）
```

**计数器 2：月发起计数（防持久化骚扰）**

| 属性 | 值 |
|------|----|
| 统计对象 | 恢复流程成功发起的次数（恢复码正确 → 提交新密码 → 进入冷却期） |
| 重置周期 | 每月 1 日重置为 0 |
| 阈值 | 同一恢复码月发起次数 > 3 次 |
| 触发后果 | 恢复码状态 → `permanently_locked` |
| 冻结/取消是否减少计数 | 不减少。冻结或取消只终止本次恢复流程，不撤销已消耗的月配额 |

设计目的：防止攻击者持有恢复码后，通过反复发起恢复流程来骚扰用户（频繁发送告警邮件/短信，制造疲劳攻击）。

示例：
```
第1次发起 → 用户冻结 → 计数=1（冻结不减少计数）
第2次发起 → 用户冻结 → 计数=2
第3次发起 → 用户冻结 → 计数=3
第4次发起 → 计数已达到上限 → 恢复码永久锁定 → 攻击者无法继续骚扰
```

不统计以下场景：
- 恢复码输入错误（那是"失败计数"管的事）
- 加速通道验证码错误（那是验证码限流管的事）
- 用户取消冷却期（那是"取消"操作，不是"发起"）
- 用户点击冻结（那是"冻结"操作，不是"发起"）

**两个计数器的分工总结**：

| 计数器 | 防什么 | 统计什么 | 阈值 | 窗口/周期 |
|--------|--------|---------|------|----------|
| 失败计数 | 暴力枚举（猜） | 输入错误次数 | ≥ 5 次 | 24 小时滑动窗口 |
| 月发起计数 | 持久化骚扰（烦） | 成功进入冷却期的次数 | > 3 次 | 每月 1 日重置 |

为什么需要两个计数器？失败计数防"猜"，月计数防"烦"。攻击者即使拿不到数据，也可以通过反复触发告警来折磨用户，直到用户麻木或犯错。月计数在这个链条上画了一条红线——第 4 次，攻击者永久出局。


### Step 7: GET /salt 精简（同 v2.0）

### Step 8: change-password（增加邮箱验证码）+ 敏感操作验证码保护

**change-password 路由**：

```python
class ChangePasswordRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)
    current_auth_key_hash: str
    new_auth_key_hash: str
    new_password_salt: str
    new_kdf_settings: dict
    new_password_wrapped: str

@router.post("/change-password", response_model=RefreshTokenResponse)
async def change_password(req: ..., user_id = ..., db = ...):
    if not await verify_and_consume(req.target, req.value, req.verification_code):
        raise HTTPException(status_code=400, detail="验证码无效")
    user = await db.get(User, user_id)
    if not user or not verify_auth_key(req.current_auth_key_hash, user.password_hash):
        raise HTTPException(status_code=401, detail="当前密码错误")
    # ... 更新逻辑 ...
    # 发送告警
    await send_verification_email(req.value, "您的 SafeBox 密码已被修改。")
```

**前端页面 `ChangePasswordPage.tsx`**：
- Step 1：输入当前密码 + 新密码
- Step 2：点击"发送验证码"到邮箱
- Step 3：输入验证码 → 提交

### Step 8.5: 注销账号增加邮箱验证码（新增）

```python
class DeleteAccountRequest(BaseModel):
    target: str = Field(..., pattern="^(phone|email)$")
    value: str
    verification_code: str = Field(..., min_length=6, max_length=6)

@router.delete("/account", status_code=204)
async def delete_account(req: DeleteAccountRequest, user_id = ..., db = ...):
    if not await verify_and_consume(req.target, req.value, req.verification_code):
        raise HTTPException(status_code=400, detail="验证码无效")
    await db.execute(sa_delete(User).where(User.id == user_id))
    await db.commit()
    await send_verification_email(req.value, "您的 SafeBox 账户已被注销。")
```

---

## Wave 3（P2—代码组织清理）

（同 v2.0，无变化）

---

## Wave 4（P3—体验完善）

（同 v2.0，无变化）

---

## Deploy — Feature Flag 发布策略

### 核心思想

```python
# server/app/config.py
class Settings(BaseSettings):
    feature_flag_v2_crypto: bool = False   # 默认关闭
```

### 三步部署

```
Step 1: 代码部署（支持双读写，开关关）
  - 后端代码能读 v1 和 v2 条目格式
  - 后端代码只写 v1 格式
  - 注册 API 仍然写入 v1 格式
  - 验证功能正常

Step 2: 开开关（Feature Flag = true，无需部署）
  - 注册 API 开始写入 v2 格式（Item Key + AES-GCM）
  - 新增条目使用 v2 格式
  - 旧条目仍为 v1，解密时按 encryption_version 调度
  - 如有 bug，立即关闭开关，零风险

Step 3: 稳定后（数周），移除 v1 写路径代码
  - 删除 RSA 条目加密相关代码
  - 后续可删除 Feature Flag
```sql

### DB migration 策略

```sql
-- 所有新增列允许 NULL，不影响旧代码
ALTER TABLE users ADD COLUMN kdf_settings JSONB;
-- 恢复码表（v2 新增，不影响 v1 代码）
CREATE TABLE recovery_codes (...);
-- 条目表不变（encryption_version 是前端 JSON 结构的一部分，
-- 存在 items.data TEXT 字段内，后端不感知）
```

### 回滚方案

```
核心原则：开关关 = 后端仍然能读 v2+v1，但只写 v1。用户数据始终可见，零感知。

回滚步骤:
  1. 关闭 Feature Flag（不触发代码回滚，无需部署）
  2. 注册 API 降级写 v1 格式
  3. 所有现有条目（v1+v2）仍然可读 —— 旧代码也兼容 v2 读取
  4. 新写入条目为 v1 格式
  5. 用户零感知，数据零损失
  6. 如需再次打开开关，无需代码变更，仅改配置
```

### Smoke test

| 测试 | 步骤 | 期望 |
|------|------|------|
| v2 条目创建 | 开 Feature Flag 后创建条目 | IndexedDB 中 encryption_version=2 |
| v1 条目可见 | 旧条目仍可解密 | 正常显示 |
| 恢复码重置 | 输入恢复码 + 冷却期 → 设新密码 | 收到告警 + 可加速/冻结 |
| 改密 | 当前密码 + 验证码 → 新密码 | 旧密码登录失败 |
| 注销 | 验证码 → 确认 | 账号删除 + 收到告警邮件 |
| 回滚测试 | 关开关 → 无需代码部署 → 用户仍可读所有条目(v1+v2) → 新写条目为 v1 格式 | 用户零感知 |
