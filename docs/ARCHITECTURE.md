# SafeBox 架构总纲

---

## 一、核心设计：SRP 认证 + 端到端加密

SafeBox 采用 **SRP-6a + 2SKD**（对标 1Password），核心原则：**服务器不存密码/助记词明文，登录零知识**。

- 助记词（BIP39 12 词）= Secret Key，客户端本地持有 + 加密缓存，**不上传**
- 主密码 = K 派生因子 + SRP x 派生因子 + 本地缓存保护
- SRP-6a：服务端只存 verifier，登录过程不泄露密码

**服务器被入侵后：攻击者拿到 verifier + encrypted_user_key，解 encrypted_user_key 需 K = PBKDF2(助记词+主密码)，132bit 不可暴破；verifier 泄露无法重放登录（SRP）。忘主密码 = 数据丢失（主密码参与 K + x 派生，无法恢复）。**

---

## 二、密钥层次

```
SRP x = PBKDF2(主密码, HKDF拉伸(srp_salt,邮箱), 600k) XOR HKDF(助记词, salt=邮箱)   ← 2SKD 双秘密
verifier v = g^x mod N                                                              ← 存服务器（hex）

K = PBKDF2(助记词 + 主密码, mnemonic_salt, 600k)    ← 派生，永久不变（K 不存服务器）
│
├── encrypted_user_key = AES(K, User Key)              ← 存服务器
│       └── User Key（随机 AES-256）                     ← 主密钥，包裹 Item Keys
│               ├── encrypted_item_key_i = AES(User Key, itemKey_i)
│               │       └── 条目字段 = AES-GCM(itemKey_i, 明文, AAD)
│
└── 主密码（参与 K + x 派生，可改，需助记词+邮箱）：
        ├── localDerivedKey = PBKDF2(主密码, local_salt, 600k)
        ├── cached_K = AES(localDerivedKey, K)                        ← 存本地 IndexedDB
        └── mnemonic_encrypted = AES(localDerivedKey, 助记词)        ← 存本地，同设备登录算 x 用
```

### 两个秘密

| 术语 | 性质 | 角色 | 可改 |
|---|---|---|---|
| 助记词 | 必选、永久 | Secret Key：参与 x 派生（2SKD）+ K 派生；换设备密钥 | ❌ |
| 主密码 | 日常用 | 参与 K + x 派生 + 本地缓存保护 | ✅（需助记词+邮箱，K 变 + verifier 变） |

### SRP-6a 认证

- 客户端派生 `x` -> `v = g^x mod N`，注册时上传 `v`（hex），服务端存 `users.srp_verifier`
- 登录握手：`A=g^a, B=(k·v+g^b) mod N, u=H(A|B), S=(B-k·g^x)^(a+u·x)=(A·v^u)^b, K=H(S), M1=H(A|B|K), M2=H(A|M1|K)`
- 服务端只验 M1（不存密码），返回 M2（客户端验服务端）
- RFC 3526 4096-bit N + SHA-256，`server/app/services/srp_service.py`（后端）+ `web/src/crypto/srp.ts`（前端 BigInt+WebCrypto）逐字节一致，固定向量交叉验证

---

## 三、服务器存储

### users 表
| 字段 | 说明 |
|---|---|
| `srp_verifier` | hex(v=g^x mod N)，2SKD x 派生 |
| `srp_salt` | hex(16字节)，x 派生用盐（客户端生成） |
| `local_salt` | base64，cached_K / mnemonic_encrypted 派生用盐 |
| `kdf_settings` | JSON（默认 {pbkdf2, 600000}） |

### user_keys 表
| 字段 | 说明 |
|---|---|
| `encrypted_user_key` | AES(K, User Key)，K 不在服务器 |
| `mnemonic_salt` | K 派生用盐（注册时生成） |

### 服务器不存的东西（核心）
- ❌ 密码哈希 / bcrypt（改 SRP，只存 verifier）
- ❌ 助记词明文 / mnemonic_hash（废除 mnemonics 表，助记词不上传）
- ❌ K（派生值，只在客户端）
- ❌ 主密码明文

---

## 四、数据流

### 注册
```
客户端:
  生成 BIP39 助记词（12 词，本地，不上传）
  生成 srp_salt(16字节) + mnemonic_salt + local_salt（随机 32 字节）
  K = PBKDF2(助记词+主密码, mnemonic_salt)
  User Key = 随机 AES-256
  encrypted_user_key = AES(K, User Key)
  cached_K = AES(localDerivedKey, K)
  mnemonic_encrypted = AES(localDerivedKey, 助记词)
  x = deriveX(主密码, 助记词, srp_salt, 邮箱); v = g^x mod N
  上传: srp_verifier, srp_salt, local_salt, kdf_settings, encrypted_user_key, mnemonic_salt

服务端:
  create_user + user_keys + device（存 srp_verifier/srp_salt）
  返回 token

客户端:
  saveSession(cached_K, mnemonic_encrypted, encrypted_user_key, ...)
  展示助记词（仅一次，提示保存）
```

### 同设备登录（Web，已缓存 mnemonic_encrypted）
```
GET /salt -> srp_salt, local_salt, mnemonic_salt, N, g
从 IndexedDB 取 mnemonic_encrypted -> localDerivedKey 解出 mnemonic
SRP challenge: A=g^a -> {session_id, B}
x = deriveX(主密码, mnemonic, srp_salt, 邮箱); 算 u/S/K/M1
SRP verify: M1 -> {token, encrypted_user_key, M2}
verifyM2 验服务端
unlockWithPassword(主密码, local_salt, encrypted_user_key, cached_K) -> User Key
```
> 无 mnemonic_encrypted（首次此设备/换设备）-> 走 RecoveryPage

### 换设备（RecoveryPage）
```
GET /salt -> srp_salt, local_salt, mnemonic_salt
SRP 两步登录（用输入的助记词 + 主密码算 x，x 含助记词故同时验两者）
recoverAndRewrap(助记词, 主密码, mnemonic_salt, encrypted_user_key, local_salt):
  K = PBKDF2(助记词+主密码, mnemonic_salt); UserKey = AES_Dec(K, encrypted_user_key)
  cached_K = AES(localDerivedKey, K); mnemonic_encrypted = AES(localDerivedKey, 助记词)
存 session（含 cached_K + mnemonic_encrypted）
```

### 改主密码
```
需助记词 + 邮箱（派生新 K + 新 x）+ 已解锁 User Key（内存，不变）
前置 SRP 登录（验旧密码）-> fresh token
新 local_salt = 随机；新 srp_salt = 随机
新 K = PBKDF2(助记词+新主密码, mnemonic_salt)
新 encrypted_user_key = AES(新K, User Key)
新 cached_K = AES(新localDerivedKey, 新K)
新 mnemonic_encrypted = AES(新localDerivedKey, 助记词)
新 v = g^deriveX(新主密码, 助记词, 新srp_salt, 邮箱) mod N
POST /auth/change-password（fresh token + 验证码 + 新材料）
  revoke_all_user_tokens（其他设备 401）
User Key 不变，条目无需重加密
```

### 忘主密码
```
忘主密码 = 数据丢失（主密码参与 K + x 派生，仅有助记词无法解密 encrypted_user_key）
无恢复途径
```

### Google 登录
```
Google 只验证身份（ID Token），用户仍需设主密码 + 助记词
注册: Google ID Token + srp_verifier + encrypted_user_key（同标准注册，identifier="google"）
登录: Google ID Token -> 服务端验证 -> 返回 encrypted_user_key（不走 SRP）
改密/删号: Google 用户用当前 token（无 email/phone 走 SRP 登录）
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
- BIP39 12 词（132bit），客户端本地生成，展示一次，**不上传服务端**
- 助记词 = Secret Key，参与 SRP x 派生（2SKD）+ K 派生
- 加密缓存 IndexedDB（`mnemonic_encrypted`），同设备登录用
- 换设备：用户输助记词，SRP 登录 + recoverAndRewrap
- 忘主密码 = 数据丢失

---

## 七、安全标准

| 原则 | 说明 |
|---|---|
| 服务器不存密码密文 | 只存 SRP verifier（v），登录零知识 |
| SRP-6a | RFC 3526 4096-bit + SHA-256，2SKD 双秘密（主密码+助记词） |
| 助记词不上传 | = Secret Key，客户端本地持有 + 加密缓存 |
| 助记词永久 | 与主密码一起派生 K + x，不重生成、不限次 |
| JWT type 校验 | 中间件强制 type="access"，防 refresh 冒充 |
| refresh rotation | TokenFamily + FOR UPDATE 行锁 + 重放全线失效 |
| 零知识边界 | 客服、服务器任何时候都接触不到明文密钥/助记词 |
| /salt 防枚举 | 不存在用户返回确定性 fake salt，SRP verify 必失败 |

---

## 九、设备 deauthorize + SRP K 通信（Phase 2）

### 设备绑定 + deauthorize
- 登录/注册建 `UserDevice`，`device_id` 绑 access/refresh token（claim）
- 中间件 `get_current_user_id` 查 Redis `device:revoked:{id}`（TTL 30min），revoked -> 401（access 立即失效，解决 30min 重用）
- `TokenFamily` 加 `device_id` 列，`revoke_device_tokens` 按 device 撤销
- `GET /auth/devices` 设备列表（含 `is_current`/`is_revoked`/`last_active_at`），`DELETE /auth/devices/{id}` deauthorize

### SRP K 通信加密（对标 1Password SRP+GCM 传输层）
- SRP verify 后 `K=H(S)` 存 Redis `session_key:{device_id}` TTL 30min（refresh 续）+ client IndexedDB
- 认证 POST body + 响应用 K AES-256-GCM 加密（`nonce(12)+ciphertext+tag`）
- `services/transport_crypto.py`（AES-GCM service，cryptography 库）+ `middleware/transport_crypto.py`（BaseHTTPMiddleware，解密认证 body + 加密响应）
- 强制 `X-Safebox-Encrypted` header（防 downgrade）；K 不存透传（兼容旧 token/测试）

### 不做（基于白皮书分析）
- 分享（RSA 密钥对）：白皮书 L412 vault sharing 专用，SafeBox 单用户
- device_key 并行 UserKey：白皮书 L1163 device key 是 SSO 专用（无主密码），SafeBox 都有主密码，独立解会违背忘主密码=数据丢失
- 每请求 Ed25519 签名：1Password 无此设计

---

## 十、文档索引

| 文档 | 内容 |
|---|---|
| `ARCHITECTURE.md` | 本文档，架构总纲 |
| `RECOVERY_MECHANISM.md` | SRP + 助记词机制（换设备/改密/同设备登录） |
| `API_CONTRACT.md` | API 端点契约（SRP challenge/verify 等） |
| `FEATURE_LIST.md` | 功能清单 |
| `dev-debug.md` | 调试指南 |
| `testing/curl-test-cases.md` | curl 测试用例 |
