# SafeBox 密钥层次架构 v2（目标设计）

> 版本: v2.5
> v2.4 → v2.5 变更:
>   - 恢复码路径更新为"一次性完成所有操作"模式：initiate 时一并提交新密码，进入 pending_activation
>   - 新增 pending_new_auth_key_hash / pending_password_wrapped / pending_setup_at / cooldown_expires_at / recovery_attempt_count
>   - 新增不变式 #10（恢复码路径旧数据永不覆盖）
>   - 新增加速通道（accelerate）和冻结（freeze）分支

---

## 一、设计原则

1. **最小密钥暴露** — 每层密钥只做它该做的事，不暴露给下层。
2. **可升级的密码学** — KDF 算法和迭代数可配置，支持无缝迁移。
3. **对称优先** — 数据加密用对称密钥（认证加密 AEAD），非对称仅用于 key exchange。
4. **零知识不变** — 服务端永远不知道任何密钥明文。
5. **恢复路径安全等价** — 密码和恢复码两条路径对 User Key 的保护强度应一致。
6. **逻辑分层 ≠ 内存隔离** — 密钥分层提供"换密码不解密条目"的操作隔离。
7. **跨平台兼容优先** — 派生算法变更需同时评估 Android 端影响。无安全收益时保持兼容。
8. **未来演化的预留** — 架构决策应向未来可能的条目共享留出扩展通道。

---

## 二、密钥层次图（v2.4）

```
用户层
═══════════════════════════════════════════════════
  主密码 (password)
       │
       │ PBKDF2(password_salt)
       │ PBKDF2(password_salt+"auth")
       │ (可配置迭代数)
       │
       ▼
  passwordDerivedKey
       │
       │ AES-256-GCM (AAD)
       ▼
  ┌──────────────┐
  │ password     │
  │ WrappedKey   │
  └──────┬───────┘
         │
         ▼ AES-GCM 解密
═══════════════════════════════════════════════════
密钥层（仅在客户端内存）
═══════════════════════════════════════════════════
                  │
          ┌───────┴───────┐
          │   User Key    │   AES-256, 随机生成
          │ (AES-256)     │   加密 Item Key 链
          └───────┬───────┘   改密时只重新 wrap
                  │
          ┌───────┴───────┐
          │  Item Key 池   │   AES-256, 每条目一个随机
          │ (AES-256)     │   User Key 包裹后存于条目记录
          └───────┬───────┘   未来共享时只需重新 wrap Item Key
                  │
    ┌─────────────┼──────────────────┐
    │             │                  │
    ▼             ▼                  ▼
┌──────────┐ ┌──────────┐  ┌──────────────┐
│ RSA 私钥  │ │ 条目数据  │  │ 设备密钥      │
│ (PKCS8)  │ │ AES-GCM │  │ (跨设备)     │
│ User Key │ │ Item Key │  │ User Key     │
│ 加密     │ │ + AAD   │  │ 加密         │
└──────────┘ └──────────┘  └──────────────┘

认证路径:
  Auth Key = PBKDF2(password, password_salt + "auth", kdf_settings)
  → base64 encode → 作为 auth_key_hash 发送给服务端验证
  → 服务端做 bcrypt 二次哈希后存储
  → 与 Android CryptoManager.kt 的 deriveAuthHash() 完全一致

加密路径:
  passwordDerivedKey = PBKDF2(password, password_salt, kdf_settings)
  → AES-GCM-Decrypt(passwordWrapped, passwordDerivedKey) → User Key
  → AES-GCM-Decrypt(encryptedItemKey, User Key) → Item Key
  → AES-GCM-Decrypt(itemCiphertext, Item Key, AAD=fieldName) → 明文

恢复码路径（服务端仅验证，不参与客户端密钥派生）:
  恢复码 = BIP39 12 词（2048 词表，secrets.randbelow 选取）→  132 bit 熵
  → 服务端 HMAC-SHA256 比对 recovery_code_hash
  → 验证通过后进入 1h 冷却期
  → 冷却期满后用户设置新密码
  → 客户端用新密码重新派生 passwordDerivedKey
  → 新密码重新 wrap User Key → 更新 passwordWrapped
```

---

## 三、完整密钥明细

| 密钥 | 类型 | 长度 | 派生自 | 用途 | 生命周期 |
|------|------|------|--------|------|---------|
| User Key | 随机 AES | 256 bit | CSPRNG | 加密 Item Key + RSA 私钥 + 设备密钥 | 注册创建，改密不换 |
| Auth Key | base64 | 256 bit | PBKDF2(password, salt+"auth") | 服务端登录认证 | 每次登录派生 |
| passwordDerivedKey | AES key | 256 bit | PBKDF2(password, password_salt) | 包裹/解包 User Key | 登录时派生，不持久化 |
| recoveryCode | BIP39 12 词 | 132 bit 熵 | 服务端生成（secrets.randbelow） | 服务端验证身份凭据，**不参与密钥派生** | 生成后下载备份，服务端只存 HMAC 哈希 |
| **Item Key** | 随机 AES | 256 bit | CSPRNG | **加密单个条目数据** | **条目创建时随机生成** |
| RSA key pair | RSA-4096 | 4096 bit | CSPRNG | 解密旧条目 + 未来共享 | 注册创建，不变 |
| Device Key | 随机 AES | 256 bit | CSPRNG | 跨设备传输 User Key | 设备注册时随机 |

---

## 四、条目加密规范（v2.3）

### 加密格式

每条条目拥有一个独立的随机 Item Key。User Key 包裹 Item Key，Item Key 加密条目内容。

```typescript
// 每条条目存储结构
interface EncryptedItem {
  id: string;
  userId: string;
  type: string;
  encryption_version: number;               // 1=RSA, 2=AES-GCM+ItemKey
  icon?: EncryptedField;
  name: EncryptedField;                     // AAD = "safebox:v2:item:name"
  description?: EncryptedField;
  data: EncryptedField;                     // AAD = "safebox:v2:item:data:{type}"
  version: number;
  createdAt: string;
  updatedAt: string;
}

interface EncryptedField {
  encrypted_key: string;   // AES-GCM(User Key, Item Key) — Item Key 被 User Key 包裹
  ciphertext: string;      // AES-GCM(plaintext, Item Key, AAD=fieldName)
                           // 格式: base64(nonce(12) + ciphertext)
}
```

### Nonce 生成策略

```typescript
// Nonce: 12 字节，由 crypto.getRandomValues() 安全随机数生成
// 与密文绑定存储于 DB（nonce 前置在 ciphertext 中）
// 不可使用计数器——多端离线创建条目时计数器无法同步
const nonce = new Uint8Array(GCM_NONCE_LENGTH);
crypto.getRandomValues(nonce);
```

12 字节随机 nonce 的碰撞概率：在 2^48 次加密操作后碰撞概率达到 2^-32。对于密码管理器条目数量（<10000），碰撞可忽略。

### 解密回退策略

```typescript
async function decryptItemField(
  userKey: CryptoKey,
  rsaPrivateKey: CryptoKey,
  field: EncryptedField,
  version: number,
): Promise<string | null> {
  if (version >= 2) {
    const itemKey = await aesDecrypt(userKey, field.encrypted_key);
    if (itemKey) {
      const itemKeyKey = await importKey("raw", itemKey, "AES-GCM");
      const result = await aesDecryptField(itemKeyKey, field.ciphertext, fieldName);
      if (result !== null) return new TextDecoder().decode(result);
    }
  }
  // 回退 RSA（encryption_version = 1 或 AES-GCM 解密失败时）
  return rsaDecryptString(rsaPrivateKey, field.ciphertext);
}
```

---

## 五、恢复码路径

恢复码在 v2 中**不参与客户端密钥派生**。恢复码仅作为服务端验证凭据，使用 256-bit 随机字符串，服务端存 HMAC-SHA256 哈希。

```
恢复码 = secrets.token_urlsafe(32)  →  256 bit 熵
       │
       POST /auth/recovery/initiate
       │        同时提交新密码
       ▼ 服务端
  HMAC-SHA256(recovery_code_salt, input) VS recovery_code_hash
       │
       匹配 → pending_activation（24h 冷却期）
       │        pending_new_auth_key_hash   ← 新密码哈希
       │        pending_password_wrapped    ← 新 wrapped key
       │        cooldown_expires_at = now + 24h
       │
       ├─ 加速通道: POST /auth/recovery/accelerate
       │   验证码 + 签名链接 → 立即激活 → consumed
       │
       ├─ 冷却自然结束: cooldown_expires_at 到期
       │   → pending_* 写入 users/user_keys → consumed
       │
       └─ 冻结: POST /auth/recovery/freeze
           签名链接 → 丢弃 pending_* → 状态回退 active
```

完整流程见 `RECOVERY_MECHANISM.md`。

---

## 六、KDF 可配置性

（不变）

---

## 七、不变式（v2.3）

1. **User Key 不直接加密条目数据。** 条目数据由 Item Key 加密，User Key 加密 Item Key。
2. **换密码只重新 wrap User Key。** 所有 Item Key、条目数据、RSA 私钥不动。
3. **每个密文有唯一 AAD。**
4. **User Key extractable = true（Web Crypto API 约束）。**
5. **认证和加密使用不同的 KDF 输入域。**
6. **KDF 参数跟随账户可配置。**
7. **Nonce 使用 12 字节安全随机数（crypto.getRandomValues），不可用计数器。**
8. **User Key 在 JS 堆内存中。**
9. **条目按 encryption_version 标记格式，解密时直接调度对应解密器，不靠 try-catch。**
10. **恢复码路径旧数据永不覆盖。** 冷却期内 pending_* 与正式字段共存，冻结即回滚。
