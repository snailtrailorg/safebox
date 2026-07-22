# SafeBox 架构总纲

本文档是项目的逻辑骨架，其他文档（API_CONTRACT / FEATURE_LIST / RECOVERY_MECHANISM 等）对齐本文。

---

## 一、核心设计：SRP 认证 + 端到端加密 + K 通信

SafeBox 采用 **SRP-6a + 2SKD**（对标 1Password），核心原则：**服务器不存密码/助记词明文，登录零知识，通信加密防路径泄密**。

- 助记词（BIP39 12 词）= Secret Key，客户端本地持有 + 加密缓存，**不上传**
- 主密码 = K 派生因子 + SRP x 派生因子 + 本地缓存保护（合并主密码模型，忘 = 丢失）
- SRP-6a：服务端只存 verifier，登录过程不泄露密码
- SRP K 通信加密：TLS 之上第二层，认证 body + 响应 AES-GCM(K)，防反代日志/Nginx 终止点/中间人

**服务器被入侵：拿到 verifier + 密文 + session_key，但无密码/助记词 -> 无法解 UserKey -> 无法解条目；verifier 泄露无法重放（SRP）；K_comm 不解数据。忘主密码 = 数据丢失。**

---

## 二、密钥层次

```
助记词[BIP39 12 词] + 主密码
   │
   ├── 2SKD: x = PBKDF2(主密码, HKDF拉伸(srp_salt,邮箱), 600k) XOR HKDF(助记词, salt=邮箱)   ← 双秘密
   │        verifier v = g^x mod N                                                          ← 存服务器（hex）
   │
   ├── K 派生: K = PBKDF2(助记词+主密码, mnemonic_salt, 600k)   ← 永久不变，不存服务器
   │          ├── encrypted_user_key = AES(K, UserKey)          ← 存服务器
   │          │   └── UserKey（随机 AES-256）                    ← 主密钥，包裹 Item Keys
   │          │       └── encrypted_item_key_i = AES(UserKey, itemKey_i)
   │          │           └── 条目字段 = AES-GCM(itemKey_i, 明文, AAD)
   │          │
   │          └── 通信 K_comm = H(S)（SRP 握手派生，session 级 30 天）  ← 不存服务器明文，Redis session_key:{device_id}
   │
   └── 主密码（参与 K + x 派生，可改，需助记词+邮箱）:
        ├── localDerivedKey = PBKDF2(主密码, local_salt, 600k)
        ├── cached_K = AES(localDerivedKey, K)                   ← 本地 IndexedDB，lock/unlock 用
        └── mnemonic_encrypted = AES(localDerivedKey, 助记词)    ← 本地，同设备登录算 x 用
```

### 两个秘密

| 术语 | 性质 | 角色 | 可改 |
|---|---|---|---|
| 助记词 | 必选、永久 | Secret Key：参与 x 派生（2SKD）+ K 派生；换设备密钥 | ❌ |
| 主密码 | 日常用 | 参与 K + x 派生 + 本地缓存保护 | ✅（需助记词+邮箱，K 变 + verifier 变） |

### 两种 K（不要混淆）

| K | 派生 | 用途 | 生命周期 |
|---|---|---|---|
| **派生 K** | PBKDF2(助记词+主密码, mnemonic_salt) | 加密 UserKey（encrypted_user_key） | 永久（主密码变才变） |
| **通信 K_comm** | H(S)（SRP 握手） | 加密认证 body + 响应 | session 级 30 天（login 建/logout 清） |

---

## 三、三态 session 模型（对标 1Password）

| 状态 | 触发 | 动作 | session_K | cached_K/mnemonic_encrypted |
|---|---|---|---|---|
| **login** | 主密码+助记词（或同设备缓存取 mnemonic） | SRP 握手建 session + session_K | 建立（client + server Redis） | 保留/建立 |
| **lock** | autoLock 20min 空闲 | `keyChain.lock()` 清内存 UserKey | 不变 | 不变（IndexedDB 保留） |
| **unlock** | 锁屏输主密码 | `unlockWithPassword` 本地解 cached_K -> UserKey（不走 SRP） | 不变 | 不变 |
| **logout** | 用户主动退出 | 清整个 session（cached_K + mnemonic_encrypted + session_K + token） | 清除 | 清除 |

### 决策 A（对标 1Password）：logout 清缓存

- logout 清 cached_K + mnemonic_encrypted + session_K + token（client + server Redis session_key）
- 重登走**换设备流程**（RecoveryPage：助记词+主密码 SRP + recoverAndRewrap 重建缓存），不是同设备登录（主密码）
- 代价：退出重登要助记词（用户须保管）；设备失守后缓存不在（减少暴露）

### session 边界

- session = login 到 logout（或 refresh token 30 天过期）
- session 内 token 过期重登：mnemonic_encrypted 还在 -> 同设备登录（主密码，从缓存取 mnemonic）
- logout 后重登：mnemonic_encrypted 清 -> 走 RecoveryPage（助记词+主密码）

---

## 四、SRP-6a 认证

- 客户端派生 `x` -> `v = g^x mod N`，注册时上传 `v`（hex），服务端存 `users.srp_verifier`
- 登录握手：`A=g^a, B=(k·v+g^b) mod N, u=H(A|B), S=(B-k·g^x)^(a+u·x)=(A·v^u)^b, K=H(S), M1=H(A|B|K), M2=H(A|M1|K)`
- 服务端只验 M1（不存密码），返回 M2（客户端验服务端）
- RFC 3526 4096-bit N + SHA-256，`server/app/services/srp_service.py` + `web/src/crypto/srp.ts` 逐字节一致

---

## 五、SRP K 通信加密（对标 1Password SRP+GCM）

- SRP verify 后 `K_comm = H(S)` 存 Redis `session_key:{device_id}` TTL **session 级 30 天**（refresh 续）+ client IndexedDB
- 认证 POST body + 响应用 K_comm AES-256-GCM 加密（`nonce(12)+ct+tag`），header `X-Safebox-Encrypted: 1`
- **K 不存拒 401 `session expired`**（不透传，防 downgrade；强制重 SRP login 重建 K）
- middleware 纯 ASGI（`server/app/middleware/transport_crypto.py`）：BaseHTTPMiddleware 的 call_next 用自己 receive wrapper，不传 dispatch 设的 body -> 端点收密文失败；纯 ASGI 直接控制 scope/receive/send 解决
- 登录前 API（/salt/send-code/register/login/refresh）不加密
- 防重放：AES-GCM nonce 随机 + tag 认证（per-message replay 未做，与白皮书一致待改进）

---

## 六、设备 deauthorize + device info

- `device_id` 绑 access/refresh token（JWT claim）
- `UserDevice` 表：device_name + **client_name/os_name/last_auth_ip**（challenge/verify 从 `User-Agent` + `X-Real-IP` 解析填充）+ is_revoked/revoked_at/updated_at + last_active_at/created_at
- `GET /auth/devices` 列表（含 is_current/is_revoked/client_name/os_name/last_auth_ip）
- `DELETE /auth/devices/{id}` deauthorize：标记 is_revoked + 删该 device TokenFamily + Redis `device:revoked:{id}` TTL 30min（中间件 `get_current_user_id` 查，access 立即失效，解决 access 30min 重用）
- 改密时清**其他设备** session_key（当前 device 保留）-> 其他设备 K 不存 401 -> 踢到 RecoveryPage

---

## 七、服务器存储

### users 表
| 字段 | 说明 |
|---|---|
| `srp_verifier` | hex(v=g^x mod N)，2SKD x 派生 |
| `srp_salt` | hex(16字节)，x 派生用盐（客户端生成） |
| `local_salt` | base64，cached_K/mnemonic_encrypted 派生用盐 |
| `kdf_settings` | JSON（默认 {pbkdf2, 600000}） |

### user_keys 表
| 字段 | 说明 |
|---|---|
| `encrypted_user_key` | AES(K, UserKey)，K 不在服务器 |
| `mnemonic_salt` | K 派生用盐 |

### user_devices 表
| 字段 | 说明 |
|---|---|
| `device_name` | 客户端传（如 "Web Browser"） |
| `client_name`/`os_name`/`last_auth_ip` | User-Agent + IP 解析（浏览器名+版本/OS/IP） |
| `is_revoked`/`revoked_at`/`updated_at` | deauthorize 标记 |
| `last_active_at`/`created_at` | 活跃时间 |

### token_families 表
| 字段 | 说明 |
|---|---|
| `family`/`active_token_hash`/`used_at` | refresh rotation |
| `device_id` | FK user_devices（按 device 撤销） |

### Redis
| key | 用途 | TTL |
|---|---|---|
| `session_key:{device_id}` | 通信 K_comm | 30 天（refresh 续） |
| `device:revoked:{id}` | deauthorize 标记 | 30min（access 有效期） |
| `srp_session:{session_id}` | SRP 握手中间态 | 5min |
| `vc:{target}:{value}` | 验证码 | 5min |
| `loginfail:{target}:{value}` | 登录失败计数 | 1h |

### 服务器不存的东西
- ❌ 密码哈希/bcrypt（只存 SRP verifier）
- ❌ 助记词明文/mnemonic_hash（废除 mnemonics 表）
- ❌ 派生 K（只在客户端）
- ❌ 主密码明文

---

## 八、数据流

### 注册
```
客户端: 生成 BIP39 助记词（本地，不上传）+ srp_salt/mnemonic_salt/local_salt
       K = PBKDF2(助记词+主密码, mnemonic_salt); UserKey = 随机
       encrypted_user_key = AES(K, UserKey); cached_K/mnemonic_encrypted = AES(localDerivedKey, ...)
       x = deriveX(主密码, 助记词, srp_salt, 邮箱); v = g^x mod N
       上传: srp_verifier, srp_salt, local_salt, kdf_settings, encrypted_user_key, mnemonic_salt
服务端: create_user + user_keys + device（client_name/os_name/last_auth_ip from UA+IP）
       返回 token + device_id
客户端: 助记词模态展示（记下）-> 点确认 -> SRP 登录建 K_comm + session_K 存（注册不 SRP 握手无 K，故确认后 SRP 建）
```

### 同设备登录（session 内 token 过期，mnemonic_encrypted 在）
```
GET /salt -> srp_salt/local_salt/mnemonic_salt
从 IndexedDB 取 mnemonic_encrypted -> localDerivedKey 解出 mnemonic
SRP challenge（传 device_id 同设备）+ verify（算 x/S/K/M1）-> K_comm
verifyM2 验服务端 -> unlockWithPassword（cached_K 解 UserKey）
saveSession device_id + session_K
```

### 换设备 / logout 后重登（RecoveryPage，mnemonic_encrypted 无）
```
GET /salt
用户输助记词 + 主密码
SRP challenge（传 device_name 新设备建 UserDevice）+ verify -> K_comm
recoverAndRewrap: K = PBKDF2(助记词+主密码, mnemonic_salt); UserKey = AES_Dec(K, encrypted_user_key)
                 cached_K = AES(localDerivedKey, K); mnemonic_encrypted = AES(localDerivedKey, 助记词)
saveSession device_id + session_K + cached_K + mnemonic_encrypted
```

### lock/unlock（autoLock）
```
autoLock 20min -> keyChain.lock()（清内存 UserKey，不清 session）
unlock: 输主密码 -> unlockWithPassword（本地解 cached_K -> UserKey，不走 SRP，session_K 不变）
```

### logout（决策 A）
```
apiClient.logout()（server 撤销所有 token family + 清所有 device session_key）
keyChain.lock() + clearSession()（client 清 cached_K/mnemonic_encrypted/session_K/token）
重登走 RecoveryPage（助记词+主密码）
```

### 改主密码
```
前置 SRP 登录验旧密码 -> fresh token
keyChain.changeMasterPassword(助记词, email, mnemonic_salt, 新主密码, new_local_salt):
  新 K = PBKDF2(助记词+新主密码, mnemonic_salt); new_encrypted_user_key = AES(新K, UserKey)
  new_cached_K + new_mnemonic_encrypted + new_srp_verifier + new_srp_salt
POST /auth/change-password（fresh token + 验证码 + 新材料）:
  revoke_all_user_tokens + 清其他 device session_key（当前保留）+ 写新材料
本地落库新材料 + 新 token（session_K 保留 fresh K，直到重登）
UserKey 不变，条目无需重加密
```

### 忘主密码
数据永久丢失（主密码参与 K + x 派生，无服务端重置）。

### Google 登录
- Google 只验证身份（ID Token），用户仍需设主密码+助记词
- 注册: Google ID Token + srp_verifier + encrypted_user_key（identifier="google"）
- 登录: `/auth/login/google`（不走 SRP，**无 K_comm** -> Google 用户认证会 401，待 Google K 方案）

---

## 九、字段级加密（v2 EncryptedField）

```
EncryptedField = { encrypted_key, ciphertext }
  encrypted_key = AES-GCM(UserKey, ItemKey raw)
  ciphertext = AES-GCM(ItemKey, 明文, AAD="safebox:v2:item:{fieldName}:{itemType}")
  nonce = 12 字节随机, tagLength = 128 位
```
- 每条目一个随机 ItemKey（UserKey 包裹）
- name/description/data 各自独立加密
- AAD 绑定字段名+类型，防密文替换
- 文件 blob = AES-GCM(UserKey, 内容)，存 IndexedDB（不同步，仅元数据同步）

---

## 十、安全标准

| 原则 | 说明 |
|---|---|
| 服务器不存密码密文 | 只存 SRP verifier，登录零知识 |
| SRP-6a | RFC 3526 4096-bit + SHA-256，2SKD 双秘密 |
| 助记词不上传 | = Secret Key，本地持有 + 加密缓存 |
| K 通信 session 级 | 30 天，不存拒 401（防 downgrade），纯 ASGI middleware |
| 三态 session | login/lock/logout 对标 1Password，logout 清缓存（决策 A） |
| device deauthorize | device_id 绑 token + Redis revoked（access 立即失效） |
| JWT type 校验 | 中间件强制 type="access"，防 refresh 冒充 |
| refresh rotation | TokenFamily + FOR UPDATE 行锁，重放全线失效 |
| /salt 防枚举 | 不存在用户返 fake salt，SRP verify 必失败 |
| 登录限流 | 退避 0,0,1,2,4 -> 第 5 次锁 1h |

---

## 十一、不做（基于白皮书分析）

- **分享（RSA 密钥对）**：白皮书 vault sharing 专用，SafeBox 单用户
- **device_key 并行 UserKey**：白皮书 SSO 专用（无主密码），SafeBox 都有主密码，独立解会违背忘主密码=丢失
- **每请求 Ed25519 签名**：1Password 无此设计

---

## 十二、文档索引

| 文档 | 内容 |
|---|---|
| `ARCHITECTURE.md` | 本文档，架构总纲 |
| `API_CONTRACT.md` | API 端点契约 + K 通信规则 |
| `FEATURE_LIST.md` | 功能清单 + 数据模型 + 已知限制 |
| `RECOVERY_MECHANISM.md` | 三态 session + 助记词 + 换设备/改密 |
| `dev-debug.md` | 本地调试指南 |
| `testing/curl-test-cases.md` | curl 测试用例 + Phase 2 用例 |
| `DEPLOY.md` | 生产部署 |
| `CLAUDE.md` | 项目约定（部署区分 + 技术 + 测试） |
