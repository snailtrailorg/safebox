# SafeBox 架构总纲

---

## 一、核心设计：认证与解密分离

SafeBox 采用**串行化密钥模型**（类似 1Password），核心原则：**服务器不存任何密码密文**，密码被破也无法解密数据。

- 助记词（助记词 BIP39 12 词）= 密钥种子（派生 K）
- Passphrase（可选）= K 的加强因子
- 本地密码 = 仅认证 + 本地缓存保护（不参与密钥派生）

**服务器被入侵后：攻击者拿到 `encrypted_user_key`（AES 密文），但解它需 K = PBKDF2(助记词[+Passphrase])，132bit 不可暴破。弱本地密码也不怕（本地密码密文只在本地方，服务器没有）。**

---

## 二、密钥层次

```
K = PBKDF2(助记词 [+ Passphrase], mnemonic_salt, 600k)    ← 派生，永久不变
│   （K 不存服务器；助记词+Passphrase 都在客户端）
│
├── encrypted_user_key = AES(K, User Key)              ← 存服务器（K 解，K 不在服务器）
│       └── User Key（随机 AES-256）                     ← 主密钥，包裹 Item Keys
│               ├── encrypted_item_key_i = AES(User Key, itemKey_i)
│               │       └── 条目字段 = AES-GCM(itemKey_i, 明文, AAD)
│               └── （RSA 密钥对已删除，串行化 不需要）
│
└── 本地密码（可改，独立于 K）：
        ├── localDerivedKey = PBKDF2(本地密码, local_salt, 600k)
        ├── authKey = PBKDF2(本地密码, local_salt+"auth", 600k)   ← 服务端认证
        └── cached_K = AES(localDerivedKey, K)                        ← 存本地（IndexedDB/Keychain）

    移动端额外（PIN/生物识别，语义1：每次服务端校验）：
        encrypted_derivedKey = AES(PIN/生物识别, localDerivedKey)       ← 存 Keychain
```

### 三个密码

| 术语 | 性质 | 角色 | 可改 |
|---|---|---|---|
| 助记词 | 必选、永久 | K 的种子；恢复密钥；重设本地密码 | ❌ |
| Passphrase | 可选、永久 | K 的加强因子 | ❌ |
| 本地密码 | 日常用 | 本地缓存 K + 服务端认证 | ✅ |

### local_password_hash 双重哈希

- 客户端提交：`authKey = Base64(PBKDF2-SHA256(本地密码, local_salt+"auth", 600k, 256bit))`
- 服务端存储：`bcrypt(客户端提交值)`
- 验证：`bcrypt.checkpw(客户端提交值, 存储值)`
- 认证与解密分离：authKey 仅认证，不解密

---

## 三、服务器存储

### users 表
| 字段 | 说明 |
|---|---|
| `local_password_hash` | bcrypt(PBKDF2(本地密码, local_salt+"auth")) |
| `local_salt` | 本地密码派生用盐 |
| `kdf_settings` | JSON（默认 {pbkdf2, 600000}） |
| `local_password_version` | 改本地密码 +1（多设备同步） |
| `has_passphrase` | 是否设了Passphrase（UX 提示） |

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
| `status` | active / cooldown |
| `cooldown_until` | 冷却到期时间 |
| `rollback_local_password_hash` / `rollback_local_salt` | 旧本地密码副本（freeze 回滚） |
| `rollback_local_password_version` | 旧 local_password_version 副本（freeze 回滚） |
| ~~failed_attempt_count~~ | 已删除（助记词 132bit 不可暴破，无限次尝试不锁定） |
| `pending_initiate_*` | 两步 initiate 待确认态（15min） |

### 服务器不存的东西（核心）
- ❌ password_wrapped（本地密码密文）
- ❌ recovery_wrapped（助记词密文）
- ❌ encrypted_private / rsa_public_key（RSA 删除）
- ❌ K（派生值，只在客户端）
- ❌ Passphrase（客户端，服务端不知道）

---

## 四、数据流

### 注册
```
客户端:
  生成 BIP39 助记词（12 词）+ mnemonic_hmac_salt（随机 hex）
  生成 mnemonic_salt + local_salt（随机 32 字节）
  K = PBKDF2(助记词[+Passphrase], mnemonic_salt)
  User Key = 随机 AES-256
  encrypted_user_key = AES(K, User Key)
  authKey = PBKDF2(本地密码, local_salt+"auth")
  cached_K = AES(localDerivedKey, K)
  上传: local_password_hash, local_salt, kdf_settings, encrypted_user_key, mnemonic_salt,
        has_passphrase, mnemonic(明文), mnemonic_hmac_salt

服务端:
  mnemonic_hash = HMAC(server_key, salt+mnemonic)
  create_user + user_keys + mnemonic + device
  local_password_version = 0
  返回 token

客户端:
  saveSession(cached_K, encrypted_user_key, ...)
  展示助记词（仅一次，提示保存）
```

### 日常解锁（Web，已登录设备，语义1）
```
从 IndexedDB 读 cached_K, encrypted_user_key, local_salt
localDerivedKey = PBKDF2(本地密码, local_salt)
K = AES 解密(cached_K, localDerivedKey)
POST /auth/verify { authKey, local_password_version }  ← 每次服务端校验
  401 密码错 / 409 版本不符 / 200 ok
User Key = AES 解密(encrypted_user_key, K)
数据可用
```
> 注：日常解锁不需要助记词，靠本地 cached_K（注册时存）。encrypted_user_key 仅在 cached_K 丢失时（换设备/清缓存）才需用助记词派生 K 解密。

### 日常解锁（移动端，PIN/生物识别，语义1）
```
生物识别 → 解 encrypted_derivedKey → localDerivedKey
K = AES 解密(cached_K, localDerivedKey)
POST /auth/verify { authKey, local_password_version }
User Key = AES 解密(encrypted_user_key, K)
数据可用
每次解锁都要网络（语义1，一致性优先）
```

### 改本地密码
```
旧本地密码 → 解 cached_K → K（取出）
新 local_salt = 随机
新 cached_K = AES(新 localDerivedKey, K)  ← 本地
POST /auth/change-password { 旧 authKey, 新 authKey, 新 local_salt }
  local_password_version += 1
  revoke_all_user_tokens（其他设备 401）
User Key 不变，数据不动
```

### 忘本地密码恢复（两步 initiate + 冷却）
```
step1 POST /initiate { 助记词, 新 authKey, 新 local_salt }
  验助记词 HMAC → 返回 { encrypted_user_key, mnemonic_salt, initiate_token }

客户端:
  K = PBKDF2(助记词[+Passphrase], mnemonic_salt)
  User Key = AES 解密(encrypted_user_key, K)  ← 解出，K 不变
  新 cached_K = AES(新 localDerivedKey, K)

step2 POST /confirm { initiate_token }
  写正式 authKey + local_salt + local_password_version+1
  rollback 存旧 authKey+local_salt
  status=cooldown, revoke tokens, 告警邮件

冷却期内 D 门挡所有 access-token 请求（零窗口）
accelerate（验证码）: 清 cooldown + rollback（新本地密码确认）
freeze: 回滚 authKey+local_salt+local_password_version = rollback_*（旧本地密码恢复）
冷却到期 + 首次新密码登录: 清 rollback
```

### 换设备
```
新设备需要: 本地密码（认证）+ 助记词[+Passphrase]（派生 K 解密）

GET /salt → local_salt, kdf_settings, mnemonic_salt
POST /login { authKey } → encrypted_user_key
K = PBKDF2(助记词[+Passphrase], mnemonic_salt)
User Key = AES 解密(encrypted_user_key, K)
cached_K = AES(localDerivedKey, K)  ← 本地缓存
```

### cached_K 丢失（清缓存/换浏览器/隐私模式）
```
IndexedDB 的 cached_K 丢失 → 等于换设备
→ 日常登录（仅密码）无法解出 User Key
→ 用户需输入助记词[+Passphrase]走换设备流程
→ 助记词必须妥善备份（纸质/密码管理器）
```

### 登出
```
logout 只清 token（accessToken/refreshToken），不清 cached_K 等密钥材料
→ 退出后重新登录：本地有 cached_K，用密码解 cached_K → K → User Key
→ 不需要助记词（密钥材料仍在本地）
```

### 多设备改密同步
```
设备 A 改本地密码 → local_password_version+1 + revoke_all_user_tokens
设备 B（其他设备）下次 /verify：
  → local_password_version 不符 → 409
  → 前端提示"本地密码已在别处修改，请输入助记词[+Passphrase]"
  → 用户走换设备流程（重新派生 K + 设新本地密码）
```

### Google 登录
```
Google 只验证身份（ID Token），用户仍需设本地密码
注册: Google ID Token + 本地密码 + 助记词（客户端生成）→ 同标准注册流程
登录: Google ID Token → 服务端验证 → 返回 encrypted_user_key（同标准登录响应）
解锁: 同标准日常解锁（cached_K + 密码）
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
- 两步 initiate（验码→返回 encrypted_user_key→confirm 写正式+进冷却）
- 24h 冷却期（邮箱/手机告警 + accelerate/freeze 二次确认）
- A+D 冷却零窗口（revoke refresh + 中间件冷却门挡所有 access-token）
- 助记词永久不重生成（无月配额），无失败锁定（132bit 不可暴破）

---

## 七、安全标准

| 原则 | 说明 |
|---|---|
| 服务器不存密码密文 | 只有 encrypted_user_key（K 解，K 不在服务器） |
| 认证与解密分离 | authKey 仅认证，K 才解密 |
| 助记词永久 | K 的种子，不重生成、不限次 |
| 冷却期锁定 | initiate 即进冷却，D 门挡所有 token 访问 |
| 登录零写入 | 登录只读状态门，不触发激活写入 |
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
| `RECOVERY_MECHANISM.md` | 助记词机制（两步 initiate + 冷却 + accelerate/freeze） |
| `API_CONTRACT.md` | API 端点契约（请求/响应字段） |
| `FEATURE_LIST.md` | 功能清单 |
| `dev-debug.md` | 调试指南 |
| `testing/curl-test-cases.md` | curl 测试用例 |
