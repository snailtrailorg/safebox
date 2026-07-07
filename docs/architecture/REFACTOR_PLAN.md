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
  Step 6: 恢复码 HKDF + 邮箱验证码保护 + 告警通知
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

export const DEFAULT_KDF: KdfSettings = { algorithm: "pbkdf2", iterations: 100_000 };
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
// v2 格式
{ type: "login", encryption_version: 2,
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

### Step 6: 恢复码机制（服务端 HMAC 验证 + 冷却期 + 冻结）

**说明**：恢复码机制改用 BIP39 12 词 + 服务端 HMAC-SHA256 验证模式，替代 v1 的 BIP39 客户端解密 recoveryWrapped 方案。详见 `RECOVERY_MECHANISM.md`。

**6a — 创建 recovery_codes 表**

```sql
CREATE TABLE recovery_codes (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   UUID REFERENCES users(id) ON DELETE CASCADE,
    recovery_code_hash        VARCHAR(128) NOT NULL,
    recovery_code_salt        VARCHAR(64) NOT NULL,
    status                    VARCHAR(32) NOT NULL DEFAULT 'active',
    pending_new_auth_key_hash VARCHAR(128),       -- 新密码的 auth_key_hash（加速通道验证用）
    pending_password_salt     VARCHAR(128),       -- 新密码 salt
    pending_kdf_settings      JSONB,              -- 新 KDF 设置
    pending_wrapped_user_key  TEXT,               -- 用新密码派生的 key 包裹后的 User Key（恢复后解密保险库的核心数据）
    pending_setup_at          TIMESTAMPTZ,        -- 用户提交新密码的时间（冷却起始）
    cooldown_expires_at       TIMESTAMPTZ,        -- pending_setup_at + 24h
    recovery_attempt_count    INTEGER NOT NULL DEFAULT 0,
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

```typescript
// 用户输入恢复码 + 设置新密码（一次性完成）
async function handleInitiateRecovery() {
  // 1. 客户端用新密码派生新密钥，重新 wrap User Key
  const newPDK = await deriveKey(newPassword, newSalt, kdf);
  const newWrappedUserKey = await aesEncrypt(userKey, newPDK);

  // 2. 一次性提交
  const resp = await apiClient.post("/auth/recovery/initiate", {
    recovery_code: code,
    pending_new_auth_key_hash: await deriveAuthKey(newPassword, newSalt, kdf),
    pending_password_salt: newSalt,
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

// 冻结（无需登录）
async function handleFreeze(token) {
  await apiClient.post("/auth/recovery/freeze", {
    signed_token: token,
  });
  // 旧密码保持不变
}
```

**6e — 告警通知**
- initiate 时：邮件含两个核心链接（加速 + 冻结）
- accelerate 时：确认邮件"新密码已激活"
- freeze 时：确认邮件"冻结成功，旧密码保持不变"
- 冷却自然结束时：发送"密码已重置"提示邮件


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
