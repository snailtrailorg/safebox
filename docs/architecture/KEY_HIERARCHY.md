# SafeBox 密钥层次架构

> 版本: v0.1 (当前实现)
> 对标参考: [REFERENCE.md](./REFERENCE.md)
> 状态: 草稿 — 对应当前生产代码

---

## 一、密钥总览

```
用户输入                     客户端生成
───────────                 ─────────────
主密码 (password)            salt (32 bytes 随机)
                             masterKey (AES-256 随机)
                             RSA-4096 key pair
                             BIP39 24 词恢复码
```

### 所有密钥速查表

| 密钥名称 | 类型 | 长度 | 谁生成 | 谁知道 | 存在哪里 | 用途 |
|----------|------|------|--------|--------|---------|------|
| masterKey | AES-256 | 256 bit | 客户端注册时 | 客户端内存 only | 内存（刷新生效） | 解密 RSA 私钥、解密文件条目 |
| passwordDerivedKey | AES-256 | 256 bit | 客户端登录时派生 | 客户端 only | 不持久化 | 加密/解密 passwordWrapped |
| passwordHash | base64 字符串 | 256 bit 输出 | 客户端登录时派生 | 客户端 + 服务端(bcrypt) | 服务端 user.password_hash | API 登录认证 |
| recoveryKey | AES-256 | 256 bit | 客户端派生自 BIP39 码 | 客户端 only（知道 BIP39 码的人） | 不持久化 | 加密/解密 recoveryWrapped |
| passwordWrapped | base64 密文 | ~原 masterKey + 28B | 客户端注册时生成 | —（密文） | 服务端 user_keys | 服务端代为保管的加密 masterKey |
| recoveryWrapped | base64 密文 | ~原 masterKey + 28B | 客户端注册时生成 | —（密文） | 服务端 user_keys | 恢复码替代方案保管的加密 masterKey |
| encryptedPrivateKey | base64 密文 | ~原 RSA 私钥 + 28B | 客户端注册时生成 | —（密文） | 服务端 user_keys | 服务端保管的加密 RSA 私钥 |
| rsaPublicKey | base64 明文 | SPKI 格式 | 客户端注册时生成 | 公开 | 服务端 user_keys | 条目级加密 |
| rsaPrivateKey | CryptoKey | 4096 bit | 客户端注册时生成 | 客户端内存 only | 内存（刷新生效） | 条目级解密 |
| deviceWrapped | base64 密文 | 依设备公钥而定 | 客户端注册/添加设备时 | —（密文） | 服务端 user_devices | 跨设备共享 masterKey |
| nonce (每次加密) | 随机 bytes | 96 bit | 每次加密时 | — | 前置在密文中 | AES-GCM IV |

---

## 二、密钥层次图

```
┌─────────────────────────────────────────────────────────┐
│                    用户层（可记忆/可备份）                   │
│                                                         │
│  主密码 (password)        BIP39 恢复码 (24 词)            │
│                               │                          │
│   PBKDF2(password, salt)      SHA-256(recoveryCode)      │
│   PBKDF2(password, salt+"auth")                          │
└──────────────────────┬──────────────────┬────────────────┘
                       │                  │
                 ┌─────▼──────┐    ┌──────▼──────┐
                 │password    │    │recoveryKey  │
                 │DerivedKey  │    │(AES-256)    │
                 │(AES-256)   │    │             │
                 └──────┬─────┘    └──────┬──────┘
                        │                 │
                        ▼ AES-GCM          ▼ AES-GCM
                 ┌──────────────┐  ┌────────────────┐
                 │password      │  │recovery        │
                 │Wrapped       │  │Wrapped         │
                 │(存服务端)     │  │(存服务端)       │
                 └──────┬───────┘  └───────┬────────┘
                        │                  │
                        ▼ 解密              ▼ 解密
                  ┌──────────────────────────────┐
                  │          masterKey            │
                  │       (AES-256, 随机)          │
                  │   仅在客户端内存，永不持久化      │
                  └──────────────┬───────────────┘
                                 │
                ┌────────────────┼────────────────┐
                │                │                │
        ┌───────▼──────┐  ┌─────▼──────┐  ┌──────▼───────┐
        │AES-GCM 加密   │  │RSA 公钥    │  │AES-GCM 加密   │
        │RSA 私钥       │  │条目级加密   │  │文件条目       │
        │encrypted      │  │(分块)      │  │(AES-GCM)     │
        │PrivateKey     │  │            │  │              │
        └───────────────┘  └────────────┘  └──────────────┘
```

---

## 三、密钥生命周期

### 3.1 派生关系

```
passwordDerivedKey = PBKDF2-HMAC-SHA256(password, salt, 100K iterations)
       ↓ derived length = 256 bit → importKey("AES-GCM")

passwordHash = PBKDF2-HMAC-SHA256(password, salt + "auth", 100K iterations)
       ↓ base64 encode → 发送给服务端 → 服务端再用 bcrypt 二次哈希

recoveryKey = SHA-256(BIP39 mnemonic)
       ↓ importKey("AES-GCM")

masterKey = crypto.subtle.generateKey({name:"AES-GCM", length:256})
```

### 3.2 包装关系

```
# 密码包装：正常登录时使用
passwordWrapped = AES-256-GCM-Encrypt(masterKey, passwordDerivedKey, AAD="safebox-aes")
       ↓ 存服务端 user_keys.password_wrapped 字段

# 恢复码包装：BIP39 恢复时使用
recoveryWrapped = AES-256-GCM-Encrypt(masterKey, recoveryKey, AAD="safebox-aes")
       ↓ 存服务端 user_keys.recovery_wrapped 字段

# RSA 私钥包装：条目解密
encryptedPrivateKey = AES-256-GCM-EncryptString(masterKey, rsaPrivateKey(exported PKCS8))
       ↓ 存服务端 user_keys.encrypted_private 字段
```

### 3.3 内存生命周期

```
注册时:  generateKeys() → masterKey 进入内存
登录时:  unlockWithPassword() → 解密 passwordWrapped → masterKey 进入内存
恢复时:  unlockWithRecoveryCode() → 解密 recoveryWrapped → masterKey 进入内存
锁定:    lock() → 清空 masterKey / rsaPrivateKey
刷新/关闭标签页: 内存自然释放
```

### 3.4 服务端存储

服务端只存加密后的 blob，对明文密钥永远零知识：

| 字段 | 内容 | 服务端能否解密 |
|------|------|--------------|
| user.password_hash | bcrypt(客户端 passwordHash) | ❌ PBKDF2 + bcrypt 双层哈希 |
| user_keys.password_wrapped | AES-GCM 密文 | ❌ 不知道 passwordDerivedKey |
| user_keys.recovery_wrapped | AES-GCM 密文 | ❌ 不知道 recoveryKey |
| user_keys.encrypted_private | AES-GCM 密文 | ❌ 不知道 masterKey |
| user_keys.rsa_public_key | 明文 SPKI | ✅ 公钥，设计上应公开 |

---

## 四、与业界对比

| 维度 | SafeBox 当前 | 1Password | Bitwarden | 评价 |
|------|-------------|-----------|-----------|------|
| 条目级加密 | RSA-4096 公钥直接加密（分块）| Vault Key（AES-256 对称） | User Key（AES-256 对称） | **偏离行业标准**。RSA 分块加密复杂且慢 |
| 换密码是否需要重新加密条目 | ❌ 不需要（RSA 私钥不变） | ❌ 不需要 | ❌ 不需要 | ✅ 正确 |
| 密码派生 KDF | PBKDF2 100K 固定 | PBKDF2 650K + Argon2 | PBKDF2 600K + Argon2id | 迭代数偏低且不可配置 |
| 恢复码 KDF | SHA-256（单次） | HKDF（多 subkey） | N/A | SHA-256 缺乏 KDF 拉伸 |
| 服务端零知识 | ✅ | ✅ | ✅ | 一致 |
| Secret Key (第二因子) | ❌ 无 | ✅ | ❌ 无 | 与 Bitwarden 等价 |
| Token rotation | ✅ | ❌ 不使用 | ❌ 不使用 | **超出业界标准** |

---

## 五、当前代码中的密钥映射

| 密钥 | 前端文件 | 后端文件 | 数据库字段 |
|------|---------|---------|-----------|
| masterKey | keyManager.ts:29, 内存变量 | — | 不持久化 |
| passwordDerivedKey | pbkdf2.ts:21-33 deriveKey() | — | 不持久化 |
| passwordHash | pbkdf2.ts:37-47 deriveKeyHash() | auth_service.py:17 hash_password() | user.password_hash |
| passwordWrapped | keyManager.ts:81 | auth_service.py:148 | user_keys.password_wrapped |
| recoveryKey | bip39.ts:28-43 recoveryCodeToKey() | — | 不持久化 |
| recoveryWrapped | keyManager.ts:82 | auth_service.py:149 | user_keys.recovery_wrapped |
| rsaPublicKey | rsa.ts:26-29 encodePublicKey() | —（直接存储） | user_keys.rsa_public_key |
| rsaPrivateKey | rsa.ts:32-35 encodePrivateKey() | — | user_keys.encrypted_private |
| deviceWrapped | keyManager.ts:92 | — | user_devices.device_wrapped |

---

## 六、不变式（Invariants）

以下是重构时应始终满足的约束：

1. **masterKey 永不离开客户端内存**。不上传、不写 IndexedDB、不持久化。
2. **服务端永远不知道任何密钥的明文**。passwordHash 是 PBKDF2 再 bcrypt 的双层哈希。
3. **BIP39 恢复码可以直接解密 vault**。这是设计决策（与 1Password 不同，后者需要双重验证）。
4. **换密码只需要重新 encrypt passwordWrapped，不需要重新加密任何条目**。
5. **passwordDerivedKey 和 recoveryKey 是两条独立路径到达同一个 masterKey**。
6. **所有 AES-GCM 加密使用固定 AAD `safebox-aes`**，防止密文在字段间移动。
7. **RSA-4096 是条目加密的唯一手段**（文件条目走 AES-GCM(masterKey) 例外）。
