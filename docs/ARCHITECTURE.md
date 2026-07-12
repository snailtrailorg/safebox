# SafeBox 架构总纲

---

## 一、核心设计：认证与解密分离

SafeBox 采用**串行化密钥模型**（类似 1Password），核心原则：**服务器不存任何密码密文**，密码被破也无法解密数据。

- 恢复码（助记词 BIP39 12 词）= 密钥种子（派生 K）
- 主密码（可选）= K 的加强因子
- 登录密码 = 仅认证 + 本地缓存保护（不参与密钥派生）

**服务器被入侵后：攻击者拿到 `encrypted_user_key`（AES 密文），但解它需 K = PBKDF2(恢复码[+主密码])，132bit 不可暴破。弱登录密码也不怕（登录密码密文只在本地方，服务器没有）。**

---

## 二、密钥层次

```
K = PBKDF2(恢复码 [+ 主密码], recovery_salt, 600k)    ← 派生，永久不变
│   （K 不存服务器；恢复码+主密码 都在客户端）
│
├── encrypted_user_key = AES(K, User Key)              ← 存服务器（K 解，K 不在服务器）
│       └── User Key（随机 AES-256）                     ← 主密钥，包裹 Item Keys
│               ├── encrypted_item_key_i = AES(User Key, itemKey_i)
│               │       └── 条目字段 = AES-GCM(itemKey_i, 明文, AAD)
│               └── （RSA 密钥对已删除，串行化 不需要）
│
└── 登录密码（可改，独立于 K）：
        ├── loginDerivedKey = PBKDF2(登录密码, login_salt, 600k)
        ├── authKey = PBKDF2(登录密码, login_salt+"auth", 600k)   ← 服务端认证
        └── cached_K = AES(loginDerivedKey, K)                        ← 存本地（IndexedDB/Keychain）

    移动端额外（PIN/生物识别，语义1：每次服务端校验）：
        encrypted_derivedKey = AES(PIN/生物识别, loginDerivedKey)       ← 存 Keychain
```

### 三个密码

| 术语 | 性质 | 角色 | 可改 |
|---|---|---|---|
| 恢复码 | 必选、永久 | K 的种子；恢复密钥；重设登录密码 | ❌ |
| 主密码 | 可选、永久 | K 的加强因子 | ❌ |
| 登录密码 | 日常用 | 本地缓存 K + 服务端认证 | ✅ |

### auth_key_hash 双重哈希

- 客户端提交：`authKey = Base64(PBKDF2-SHA256(登录密码, login_salt+"auth", 600k, 256bit))`
- 服务端存储：`bcrypt(客户端提交值)`
- 验证：`bcrypt.checkpw(客户端提交值, 存储值)`
- 认证与解密分离：authKey 仅认证，不解密

---

## 三、服务器存储

### users 表
| 字段 | 说明 |
|---|---|
| `auth_key_hash` | bcrypt(PBKDF2(登录密码, login_salt+"auth")) |
| `login_salt` | 登录密码派生用盐 |
| `kdf_settings` | JSON（默认 {pbkdf2, 600000}） |
| `password_version` | 改登录密码 +1（多设备同步） |
| `has_master_password` | 是否设了主密码（UX 提示） |

### user_keys 表
| 字段 | 说明 |
|---|---|
| `encrypted_user_key` | AES(K, User Key)，K 不在服务器 |
| `recovery_salt` | K 派生用盐（注册时生成） |

### recovery_codes 表
| 字段 | 说明 |
|---|---|
| `recovery_code_hash` | HMAC-SHA256(server_key, salt+mnemonic) |
| `recovery_code_salt` | HMAC 验码用盐 |
| `status` | active / cooldown / permanently_locked |
| `cooldown_until` | 冷却到期时间 |
| `rollback_auth_key_hash` / `rollback_login_salt` | 旧登录密码副本（freeze 回滚） |
| `failed_attempt_count` / `failed_attempt_last_at` | 失败计数（≥5 锁定） |
| `pending_initiate_*` | 两步 initiate 待确认态（15min） |

### 服务器不存的东西（核心）
- ❌ password_wrapped（登录密码密文）
- ❌ recovery_wrapped（恢复码密文）
- ❌ encrypted_private / rsa_public_key（RSA 删除）
- ❌ K（派生值，只在客户端）
- ❌ 主密码（客户端，服务端不知道）

---

## 四、数据流

### 注册
```
客户端:
  生成 BIP39 恢复码 + recovery_salt + login_salt
  K = PBKDF2(恢复码[+主密码], recovery_salt)
  User Key = 随机 AES-256
  encrypted_user_key = AES(K, User Key)
  authKey = PBKDF2(登录密码, login_salt+"auth")
  cached_K = AES(loginDerivedKey, K)
  上传: auth_key_hash, login_salt, kdf_settings, encrypted_user_key, recovery_salt, has_master_password, recovery_code(明文), recovery_code_salt

服务端:
  recovery_code_hash = HMAC(server_key, salt+mnemonic)
  create_user + user_keys + recovery_code + device
  password_version = 0
  返回 token

客户端:
  saveSession(cached_K, encrypted_user_key, ...)
  展示恢复码（仅一次，提示保存）
```

### 日常解锁（Web，已登录设备，语义1）
```
从 IndexedDB 读 cached_K, encrypted_user_key, login_salt
loginDerivedKey = PBKDF2(登录密码, login_salt)
K = AES 解密(cached_K, loginDerivedKey)
POST /auth/verify { authKey, password_version }  ← 每次服务端校验
  401 密码错 / 409 版本不符 / 200 ok
User Key = AES 解密(encrypted_user_key, K)
数据可用
```

### 日常解锁（移动端，PIN/生物识别，语义1）
```
生物识别 → 解 encrypted_derivedKey → loginDerivedKey
K = AES 解密(cached_K, loginDerivedKey)
POST /auth/verify { authKey, password_version }
User Key = AES 解密(encrypted_user_key, K)
数据可用
每次解锁都要网络（语义1，一致性优先）
```

### 改登录密码
```
旧登录密码 → 解 cached_K → K（取出）
新 login_salt = 随机
新 cached_K = AES(新 loginDerivedKey, K)  ← 本地
POST /auth/change-login-password { 旧 authKey, 新 authKey, 新 login_salt }
  password_version += 1
  revoke_all_user_tokens（其他设备 401）
User Key 不变，数据不动
```

### 忘登录密码恢复（两步 initiate + 冷却）
```
step1 POST /initiate { 恢复码, 新 authKey, 新 login_salt }
  验恢复码 HMAC → 返回 { encrypted_user_key, recovery_salt, initiate_token }

客户端:
  K = PBKDF2(恢复码[+主密码], recovery_salt)
  User Key = AES 解密(encrypted_user_key, K)  ← 解出，K 不变
  新 cached_K = AES(新 loginDerivedKey, K)

step2 POST /confirm { initiate_token }
  写正式 authKey + login_salt + password_version+1
  rollback 存旧 authKey+login_salt
  status=cooldown, revoke tokens, 告警邮件

冷却期内 D 门挡所有 access-token 请求（零窗口）
accelerate（验证码）: 清 cooldown + rollback（新登录密码确认）
freeze: 回滚 authKey+login_salt = rollback_*（旧登录密码恢复）
冷却到期 + 首次新密码登录: 清 rollback
```

### 换设备
```
新设备需要: 登录密码（认证）+ 恢复码[+主密码]（派生 K 解密）

GET /salt → login_salt, kdf_settings, recovery_salt
POST /login { authKey } → encrypted_user_key
K = PBKDF2(恢复码[+主密码], recovery_salt)
User Key = AES 解密(encrypted_user_key, K)
cached_K = AES(loginDerivedKey, K)  ← 本地缓存
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

## 六、恢复码机制

详见 `RECOVERY_MECHANISM.md`。

核心：
- BIP39 12 词（132bit），注册时生成，展示一次
- HMAC-SHA256(server_key, salt+mnemonic) 服务端验证
- 两步 initiate（验码→返回 encrypted_user_key→confirm 写正式+进冷却）
- 24h 冷却期（邮箱/手机告警 + accelerate/freeze 二次确认）
- A+D 冷却零窗口（revoke refresh + 中间件冷却门挡所有 access-token）
- 恢复码永久不重生成（无月配额），≥5 次失败锁定

---

## 七、安全标准

| 原则 | 说明 |
|---|---|
| 服务器不存密码密文 | 只有 encrypted_user_key（K 解，K 不在服务器） |
| 认证与解密分离 | authKey 仅认证，K 才解密 |
| 恢复码永久 | K 的种子，不重生成、不限次 |
| 冷却期锁定 | initiate 即进冷却，D 门挡所有 token 访问 |
| 登录零写入 | 登录只读状态门，不触发激活写入 |
| bcrypt 二次哈希 | 客户端 PBKDF2 输出再 bcrypt 存储 |
| JWT type 校验 | 中间件强制 type="access"，防 refresh 冒充 |
| refresh rotation | TokenFamily + FOR UPDATE 行锁 + 重放全线失效 |
| HMAC 服务端密钥 | recovery_hmac_key 环境变量，数据库泄露后无法离线验证 |
| 零知识边界 | 客服、服务器任何时候都接触不到明文密钥 |

---

## 八、文档索引

| 文档 | 内容 |
|---|---|
| `ARCHITECTURE.md` | 本文档，架构总纲 |
| `RECOVERY_MECHANISM.md` | 恢复码机制（两步 initiate + 冷却 + accelerate/freeze） |
| `API_CONTRACT.md` | API 端点契约（请求/响应字段） |
| `FEATURE_LIST.md` | 功能清单 |
| `dev-debug.md` | 调试指南 |
| `testing/curl-test-cases.md` | curl 测试用例 |
