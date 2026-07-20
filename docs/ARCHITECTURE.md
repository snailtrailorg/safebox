# SafeBox 架构总纲

---

## 一、核心设计：认证与解密分离

SafeBox 采用**合并主密码模型**（类似 1Password），核心原则：**服务器不存任何密码密文**，密码被破也无法解密数据。

- 助记词（BIP39 12 词）= 密钥种子（与主密码一起派生 K）
- 主密码 = K 派生因子 + 认证 + 本地缓存保护（主密码参与密钥派生）

**服务器被入侵后：攻击者拿到 `encrypted_user_key`（AES 密文），但解它需 K = PBKDF2(助记词+主密码)，132bit 不可暴破。忘主密码 = 数据丢失（主密码参与 K 派生，无法恢复）。**

---

## 二、密钥层次

```
K = PBKDF2(助记词 + 主密码, mnemonic_salt, 600k)    ← 派生，永久不变
│   （K 不存服务器；助记词+主密码 都在客户端）
│
├── encrypted_user_key = AES(K, User Key)              ← 存服务器（K 解，K 不在服务器）
│       └── User Key（随机 AES-256）                     ← 主密钥，包裹 Item Keys
│               ├── encrypted_item_key_i = AES(User Key, itemKey_i)
│               │       └── 条目字段 = AES-GCM(itemKey_i, 明文, AAD)
│               └── （RSA 密钥对已删除，合并主密码模型不需要）
│
└── 主密码（参与 K 派生，可改，需助记词）：
        ├── localDerivedKey = PBKDF2(主密码, local_salt, 600k)
        ├── authKey = PBKDF2(主密码, local_salt+"auth", 600k)   ← 服务端认证
        └── cached_K = AES(localDerivedKey, K)                        ← 存本地（IndexedDB/Keychain）

    移动端额外（PIN/生物识别，本地缓存保护）：
        encrypted_derivedKey = AES(PIN/生物识别, localDerivedKey)       ← 存 Keychain
```

### 两个密码

| 术语 | 性质 | 角色 | 可改 |
|---|---|---|---|
| 助记词 | 必选、永久 | 与主密码一起派生 K；换设备密钥 | ❌ |
| 主密码 | 日常用 | 与助记词一起派生 K + 本地缓存 K + 服务端认证 | ✅（需助记词，K 变） |

### local_password_hash 双重哈希

- 客户端提交：`authKey = Base64(PBKDF2-SHA256(主密码, local_salt+"auth", 600k, 256bit))`
- 服务端存储：`bcrypt(客户端提交值)`
- 验证：`bcrypt.checkpw(客户端提交值, 存储值)`
- 认证与解密分离：authKey 仅认证，不解密

---

## 三、服务器存储

### users 表
| 字段 | 说明 |
|---|---|
| `local_password_hash` | bcrypt(PBKDF2(主密码, local_salt+"auth")) |
| `local_salt` | 主密码派生用盐 |
| `kdf_settings` | JSON（默认 {pbkdf2, 600000}） |

### user_keys 表
| 字段 | 说明 |
|---|---|
| `encrypted_user_key` | AES(K, User Key)，K 不在服务器 |
| `mnemonic_salt` | K 派生用盐（注册时生成） |

### mnemonics 表
| 字段 | 说明 |
|---|---|
| `mnemonic_hash` | HMAC-SHA256(server_key, salt+mnemonic) |
| `mnemonic_hmac_salt` | HMAC 验码用盐 |

### 服务器不存的东西（核心）
- ❌ password_wrapped（主密码密文）
- ❌ recovery_wrapped（助记词密文）
- ❌ encrypted_private / rsa_public_key（RSA 删除）
- ❌ K（派生值，只在客户端）
- ❌ 主密码明文（客户端，服务端只有 bcrypt 哈希）

---

## 四、数据流

### 注册
```
客户端:
  生成 BIP39 助记词（12 词）+ mnemonic_hmac_salt（随机 hex）
  生成 mnemonic_salt + local_salt（随机 32 字节）
  K = PBKDF2(助记词+主密码, mnemonic_salt)
  User Key = 随机 AES-256
  encrypted_user_key = AES(K, User Key)
  authKey = PBKDF2(主密码, local_salt+"auth")
  cached_K = AES(localDerivedKey, K)
  上传: local_password_hash, local_salt, kdf_settings, encrypted_user_key, mnemonic_salt,
        mnemonic(明文), mnemonic_hmac_salt

服务端:
  mnemonic_hash = HMAC(server_key, salt+mnemonic)
  create_user + user_keys + mnemonic + device
  返回 token

客户端:
  saveSession(cached_K, encrypted_user_key, ...)
  展示助记词（仅一次，提示保存）
```

### 日常解锁（Web，已登录设备）
```
从 IndexedDB 读 cached_K, encrypted_user_key, local_salt
localDerivedKey = PBKDF2(主密码, local_salt)
K = AES 解密(cached_K, localDerivedKey)
User Key = AES 解密(encrypted_user_key, K)
数据可用
```
> 注：日常解锁不需要助记词，靠本地 cached_K（注册时存）。encrypted_user_key 仅在 cached_K 丢失时（换设备/清缓存）才需用助记词+主密码派生 K 解密。

### 日常解锁（移动端，PIN/生物识别）
```
生物识别 → 解 encrypted_derivedKey → localDerivedKey
K = AES 解密(cached_K, localDerivedKey)
User Key = AES 解密(encrypted_user_key, K)
数据可用
```

### 改主密码
```
需助记词（派生新 K）+ 已解锁 User Key（内存，不变）
新 local_salt = 随机
新 K = PBKDF2(助记词+新主密码, mnemonic_salt)
新 encrypted_user_key = AES(新K, User Key)  ← 重新包裹（K 变）
新 cached_K = AES(新 localDerivedKey, 新 K)  ← 本地
POST /auth/change-password { 旧 authKey, 新 authKey, 新 local_salt, new_encrypted_user_key }
  revoke_all_user_tokens（其他设备 401）
User Key 不变，条目无需重加密（K 变，其他设备需走换设备流程）
```

### 忘主密码
```
忘主密码 = 数据丢失（主密码参与 K 派生，仅有助记词无法解密 encrypted_user_key）
无冷却/加速/冻结/confirm 机制，无恢复途径
```

### 换设备
```
新设备需要: 主密码（认证 + 派生 K）+ 助记词（派生 K 解密）

GET /salt → local_salt, kdf_settings, mnemonic_salt
POST /login { authKey } → encrypted_user_key
K = PBKDF2(助记词+主密码, mnemonic_salt)
User Key = AES 解密(encrypted_user_key, K)
cached_K = AES(localDerivedKey, K)  ← 本地缓存
```

### cached_K 丢失（清缓存/换浏览器/隐私模式）
```
IndexedDB 的 cached_K 丢失 → 等于换设备
→ 日常登录（仅主密码）无法解出 User Key
→ 用户需输入助记词+主密码走换设备流程
→ 助记词必须妥善备份（纸质/密码管理器）
```

### 登出
```
logout 只清 token（accessToken/refreshToken），不清 cached_K 等密钥材料
→ 退出后重新登录：本地有 cached_K，用主密码解 cached_K → K → User Key
→ 不需要助记词（密钥材料仍在本地）
```

### 多设备改密同步
```
设备 A 改主密码 → K 变 + 重新包裹 encrypted_user_key + revoke_all_user_tokens
设备 B（其他设备）下次请求 → 401（token 已吊销）
  → 用户需在新设备走换设备流程（助记词 + 新主密码派生新 K 解 encrypted_user_key）
```

### Google 登录
```
Google 只验证身份（ID Token），用户仍需设主密码
注册: Google ID Token + 主密码 + 助记词（客户端生成）→ 同标准注册流程
登录: Google ID Token → 服务端验证 → 返回 encrypted_user_key（同标准登录响应）
解锁: 同标准日常解锁（cached_K + 主密码）
```

---

## 五、字段级加密（v2 EncryptedField）

```
EncryptedField = { encrypted_key, ciphertext }
  encrypted_key = AES-GCM(User Key, Item Key raw)
  ciphertext = AES-GCM(Item Key, 明文, AAD="safebox:v2:item:{fieldName}:{itemType}")
  nonce = 12 字节随机
  tagLength = 128 位
```

- 每条目一个随机 Item Key（User Key 包裹）
- name / description / data 各自独立加密
- AAD 绑定字段名+类型，防密文替换
- 文件 blob = AES-GCM(User Key, 文件内容)，存 IndexedDB

---

## 六、助记词机制

详见 `RECOVERY_MECHANISM.md`。

核心：
- BIP39 12 词（132bit），注册时生成，展示一次
- HMAC-SHA256(server_key, salt+mnemonic) 服务端验证
- initiate 验助记词返回 encrypted_user_key（换设备用；web 走 login + recoverAndRewrap，端点为死代码）
- 忘主密码 = 数据丢失（主密码参与 K 派生，无冷却/加速/冻结/confirm）
- 助记词永久不重生成（无月配额），无失败锁定（132bit 不可暴破）

---

## 七、安全标准

| 原则 | 说明 |
|---|---|
| 服务器不存密码密文 | 只有 encrypted_user_key（K 解，K 不在服务器） |
| 认证与解密分离 | authKey 仅认证，K 才解密 |
| 助记词永久 | 与主密码一起派生 K，不重生成、不限次 |
| bcrypt 二次哈希 | 客户端 PBKDF2 输出再 bcrypt 存储 |
| JWT type 校验 | 中间件强制 type="access"，防 refresh 冒充 |
| refresh rotation | TokenFamily + FOR UPDATE 行锁 + 重放全线失效 |
| HMAC 服务端密钥 | mnemonic_hmac_key 环境变量，数据库泄露后无法离线验证 |
| 零知识边界 | 客服、服务器任何时候都接触不到明文密钥 |

---

## 八、文档索引

| 文档 | 内容 |
|---|---|
| `ARCHITECTURE.md` | 本文档，架构总纲 |
| `RECOVERY_MECHANISM.md` | 助记词机制（换设备：验助记词返回 encrypted_user_key） |
| `API_CONTRACT.md` | API 端点契约（请求/响应字段） |
| `FEATURE_LIST.md` | 功能清单 |
| `dev-debug.md` | 调试指南 |
| `testing/curl-test-cases.md` | curl 测试用例 |
