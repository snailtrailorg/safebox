# SafeBox 串行化重设计方案（模型 D）

> 版本：v1.2（审核意见已采纳，9 条补充已整合）
> 状态：设计阶段，待审核后实施
> 作者：基于审计 + 与用户多轮讨论
> 关联：RECOVERY_MECHANISM.md, KEY_HIERARCHY.md, API_CONTRACT.md, DATA_FLOW.md

---

## 一、背景与动机

### 1.1 当前架构的并联问题

SafeBox 当前采用**并联密钥模型**：User Key 被两把独立的锁包裹：
- `password_wrapped = AES(User Key, PBKDF2(登录密码, salt))`
- `recovery_wrapped = AES(User Key, PBKDF2(恢复码, recovery_salt))`

两把锁**任选其一**能解出 User Key。这带来可用性优势（忘密码可用恢复码救回），但有致命安全代价：**`password_wrapped` 存在服务器上，服务器被入侵后可被离线暴破**--攻击者拿到 `password_wrapped` 后，对每个候选密码跑 PBKDF2 600k 再试解密，弱密码用户即暴露。

### 1.2 目标

采用**串行化**模型（类似 1Password），让服务器被入侵后**密码不可离线暴破**。但不像 1Password 那样"忘主密码 = 永失"--通过分离"密钥源"与"登录认证"，实现：
- 服务器泄露安全（无可暴破的密码密文）
- 忘登录密码可恢复（恢复码重派密钥）
- 主密码可选（用户自主选择安全/风险）

### 1.3 设计来源

经多轮讨论确定的"模型 D"--助记词（恢复码）作为密钥种子，主密码（可选）作为加强因子，登录密码仅用于本地缓存保护 + 服务端认证。

---

## 二、当前方案（并联）摘要

> 以下为调研确认的现状。

### 2.1 密钥层次
```
User Key（随机 AES-256）
  ├── password_wrapped = AES(User Key, PBKDF2(登录密码, salt))      ← 存服务器（可暴破）
  ├── recovery_wrapped = AES(User Key, PBKDF2(恢复码, recovery_salt)) ← 存服务器（132bit 不可破）
  ├── Item Key_i = AES(User Key, itemKey_i)                          ← encrypted_item_keys
  └── RSA 私钥 = AES(User Key, rsaPrivateKey)                       ← encrypted_private
```

### 2.2 服务器存储（user_keys 表）
- `password_wrapped`（**密码密文，可暴破**）
- `recovery_wrapped`
- `encrypted_private`, `rsa_public_key`

### 2.3 当前方案的已知问题（调研发现）
1. **服务器存 password_wrapped** -> 弱密码可离线暴破（核心问题）。
2. **Web 改密不处理返回的 token**（`ChangePasswordPage.tsx` 不接收 `access_token`/`refresh_token`），改密后旧 token 已吊销 -> 用户被登出（真实 bug）。
3. **登录派生忽略 kdf_settings**（`LoginPage.tsx:123` 恒用 600k 默认值），若账户 kdf 非默认则派生错。
4. **改密与恢复 confirm 无行锁**，并发写 `user_keys` 有竞态。
5. **Android 完全是 v1**（100k 迭代、无 AAD、非标准 BIP39、SHA256 恢复码、本地恢复、裸字符串条目），与 v2 服务端 10 项不兼容。
6. **device_wrapped 用途存疑**（Web 传 "web"，Android 加密方向疑似反，服务端不消费）。

---

## 三、目标方案（模型 D）设计

### 3.1 三个密码的职责

| 术语 | 性质 | 角色 | 可改 |
|---|---|---|---|
| **恢复码**（助记词 BIP39 12 词） | 必选、永久 | K 的种子之一；恢复密钥；重设登录密码 | ❌ 不可改（除非新账号） |
| **主密码**（可选） | 可选、永久 | K 的另一个种子（与恢复码一起派生 K） | ❌ 一旦设置不可改 |
| **登录密码** | 日常用、可改 | 本地包裹缓存 K + 服务端认证 | ✅ 随时改 |

### 3.2 密钥层次（核心变化）

```
K = PBKDF2(恢复码 [+ 主密码], recovery_salt, kdf_iterations)   ← 派生，永久不变
│   （K 不存服务器；恢复码+主密码 都在客户端，丢了任一都派生不出 K）
│
├── encrypted_user_key = AES(K, User Key 原始字节)              ← 存服务器（K 解，K 不在服务器）
│       │
│       └── User Key（随机 AES-256，与当前一致）                  ← 主密钥，包裹 Item Keys
│               ├── encrypted_item_key_i = AES(User Key, itemKey_i)
│               │       └── 条目字段 = AES-GCM(itemKey_i, 明文, AAD)   ← 不变
│               └── （RSA 密钥对删除，见 §10.3）
│
└── 登录密码（可改，独立于 K）：
        ├── loginDerivedKey = PBKDF2(登录密码, login_salt, kdf_iterations)
        ├── authKey = PBKDF2(登录密码, login_salt+"auth", kdf_iterations)  ← 服务端认证
        └── cached_K = AES(loginDerivedKey, K)                               ← 存本地（IndexedDB/Keychain）

    移动端额外（PIN/生物识别，语义1：每次服务端校验）：
        encrypted_derivedKey = AES(PIN/生物识别, loginDerivedKey)            ← 存 Keychain
```

### 3.3 auth_key_hash 双重哈希说明

所有涉及 authKey 的流程（注册/登录/verify/改密/恢复）统一遵循：
- **客户端提交**：`authKey = Base64(PBKDF2-SHA256(登录密码, login_salt+"auth", kdf_iterations, 256bit))`，提交 base64 字符串
- **服务端存储**：`bcrypt(客户端提交值)`（注册时 `hashpw`，存储 bcrypt hash）
- **验证方式**：`bcrypt.checkpw(客户端提交值.encode(), 存储值.encode())`（登录/verify/改密时）
- **认证与解密分离**：authKey 仅用于服务端认证（bcrypt 比对），**不用于解密**。即使 authKey 被破，也解不了 encrypted_user_key（需 K）

### 3.4 与当前方案的核心差异

| | 当前（并联） | 模型 D（串行） |
|---|---|---|
| User Key 的包裹 | password_wrapped（密码）+ recovery_wrapped（恢复码），**任选其一** | **只有** encrypted_user_key（用 K 包裹），K = 恢复码[+主密码]派生 |
| 服务器存的密码密文 | password_wrapped（**可暴破**） | **无**（登录密码的密文只在本地方） |
| 登录密码的角色 | 认证 + 解 password_wrapped | 仅认证 + 本地缓存 K（不参与密钥派生） |
| 恢复码的角色 | 备用钥匙（解 recovery_wrapped） | **密钥种子**（派生 K） |
| 换设备 | 只需登录密码（服务器下发 password_wrapped） | 登录密码（认证）+ 恢复码[+主密码]（派生 K） |
| 忘登录密码 | 恢复码解 recovery_wrapped -> 救回 | 恢复码[+主密码]重派 K -> 救回 |
| 主密码 | 无（只有登录密码） | 可选，加强 K 派生 |
| RSA 密钥对 | 保留（跨设备 + 旧条目兼容） | **删除**（调试阶段无 v1 存量，简化） |

### 3.4 已拍板的 8 个设计决定

| # | 问题 | 决定 | 理由 |
|---|---|---|---|
| 1 | 恢复冷却期 | **保留** | 应用绑定邮箱/手机，冷却期配合告警做二次确认；rollback 存旧 authKey+login_salt（不含 wrapped，因 K/User Key 不变） |
| 2 | 恢复码生成时机 | **注册时生成** | K 依赖恢复码，注册时必须派生 K，无恢复码无法注册 |
| 3 | 主密码二次确认 | **与恢复码一起做保存提示** | 注册时展示恢复码（一次）+ 若设了主密码，一并提示保存 |
| 4 | recovery_salt 生成 | **注册时客户端生成**，存服务端 user_keys.recovery_salt | 和 login_salt 一致，客户端随机 32 字节；忘登录密码恢复时服务端返回 |
| 5 | 移动端 PIN | **保护 loginDerivedKey**（存 Keychain，硬件 PIN 限次数） | 破 PIN = K 暴露，但需拿到设备 + 破硬件 PIN（限次数），与业界一致 |
| 6 | Google 登录 | **= 登录密码登录**（Google 只验证身份，用户仍设登录密码） | Google 是身份验证方式之一，登录密码独立（用户自设） |
| 7 | /auth/verify 端点 | **新增**，校验 authKey + password_version，不下发密钥，限流 L1 | 语义1：每次解锁服务端校验，及时检测别处改密 |
| 8 | RSA 密钥对 | **删除** | 调试阶段无 v1 存量；跨设备用恢复码[+主密码]；简化密钥层次 |

---

## 四、数据模型变更

### 4.1 服务器 `users` 表

| 字段 | 当前 | 模型 D | 变化 |
|---|---|---|---|
| `auth_key_hash` | bcrypt(PBKDF2(登录密码, salt+"auth")) | 不变（bcrypt(PBKDF2(登录密码, login_salt+"auth"))） | salt 改名 |
| `password_salt` | 登录密码的 salt | -> `login_salt`（重命名） | 重命名 |
| `kdf_settings` | JSON | 不变 | 不变 |
| `password_version` | **无** | **新增** INTEGER DEFAULT 0 | 改登录密码 +1 |
| `has_master_password` | **无** | **新增** BOOLEAN DEFAULT FALSE | UX 提示用 |

### 4.2 服务器 `user_keys` 表

| 字段 | 当前 | 模型 D | 变化 |
|---|---|---|---|
| `password_wrapped` | AES(User Key, PBKDF2(密码)) | **删除** | 核心变化：不再存密码密文 |
| `recovery_wrapped` | AES(User Key, PBKDF2(恢复码)) | **删除** | K 是派生的，不需要包裹 |
| `recovery_salt` | 恢复码派生用 salt | **保留**（注册时生成，K 派生用） | 保留 |
| `encrypted_user_key` | **无** | **新增** = AES(K, User Key) | 替代 password_wrapped + recovery_wrapped |
| `encrypted_private` | AES(User Key, RSA 私钥) | **删除** | RSA 删除 |
| `rsa_public_key` | SPKI base64 | **删除** | RSA 删除 |

### 4.3 服务器 `recovery_codes` 表

| 字段 | 当前 | 模型 D | 变化 |
|---|---|---|---|
| `recovery_code_hash` | HMAC(server_key, salt+mnemonic)，server_key = 环境变量 `SAFEBOX_RECOVERY_HMAC_KEY`（base64 32 字节） | 不变 | 不变 |
| `recovery_code_salt` | HMAC 验码用 salt | 不变 | 不变 |
| `status` | active/cooldown/permanently_locked | 不变（冷却期保留） | 不变 |
| `cooldown_until` | 冷却到期时间 | 不变 | 不变 |
| `rollback_auth_key_hash` | 旧 bcrypt hash | **保留**（freeze 回滚旧登录密码用） | 语义调整：回滚登录密码，非密钥 |
| `rollback_login_salt` | **无** | **新增**（旧 login_salt） | 新增 |
| `rollback_kdf_settings` | 旧 kdf | **删除** | 恢复不改 KDF（KDF 是 K 派生参数，注册时定死） |
| `rollback_wrapped_user_key` | 旧 password_wrapped | **删除**（模型 D 下恢复不改 K/User Key，只改登录密码认证字段；freeze 回滚的是登录密码，无需回滚密钥包裹） | 删除 |
| `pending_initiate_*` | 两步 initiate 待确认 | 保留 | 保留 |
| `monthly_initiation_count` | 发起计数 | **删除** | 恢复码是 K 的种子，永久不重生成；若因配额锁定会导致用户无法派生 K = 数据永失，故不能有轻量配额。保留 failed_attempt_count（≥5 锁定防暴力枚举） |

### 4.4 服务器不存的东西（核心）

- ❌ `password_wrapped`（登录密码密文 -> 删除）
- ❌ `recovery_wrapped`（恢复码密文 -> 删除）
- ❌ `encrypted_private` / `rsa_public_key`（RSA 删除）
- ❌ K（派生值，只在客户端）
- ❌ 主密码（客户端，服务端不知道）

### 4.5 本地存储（Web IndexedDB）

| 字段 | 当前 | 模型 D | 变化 |
|---|---|---|---|
| `passwordWrapped` | AES(User Key, 登录密码) | **删除** | 不再存服务器密文 |
| `cached_K` | **无** | **新增** = AES(K, PBKDF2(登录密码)) | 新增 |
| `login_salt` | passwordSalt | login_salt（重命名） | 重命名 |
| `encrypted_user_key` | **无** | **新增**（登录时获取，缓存本地） | 新增 |
| `recovery_salt` | **无** | **新增**（注册时生成，缓存本地） | 新增 |
| `password_version` | **无** | **新增**（本地记录，对比服务端） | 新增 |
| `encryptedPrivate`, `rsaPublicKey` | RSA 材料 | **删除** | RSA 删除 |

### 4.6 本地存储（Android Keychain / DataStore）

| 字段 | 当前 | 模型 D |
|---|---|---|
| `cached_K` | **无** | AES(K, PBKDF2(登录密码)) |
| `encrypted_derivedKey` | **无** | AES(PIN/生物识别, PBKDF2(登录密码)) |
| `encrypted_user_key` | **无** | 从服务器获取 |
| `password_version` | **无** | 本地记录 |
| `recovery_salt` | **无** | 注册时生成，缓存 |

---

## 五、全流程设计

### 5.1 注册

```
用户输入: 登录密码 + [主密码（可选）]

客户端:
  1. 恢复码 = 服务端生成 BIP39 12 词（展示一次，提示保存）
     （或客户端生成后上传 recovery_code_hash，由服务端验证后存——见 §10.1 待细化）
  2. 生成 User Key（随机 AES-256）
  3. 生成 recovery_salt（随机 32 字节）          ← K 派生用
  4. 生成 login_salt（随机 32 字节）              ← 登录密码派生用
  5. K = PBKDF2(恢复码 [+ 主密码], recovery_salt)  ← 派生主密钥
  6. encrypted_user_key = AES(K, User Key raw)    ← 用 K 包裹 User Key
  7. authKey = PBKDF2(登录密码, login_salt+"auth") ← 认证
  8. loginDerivedKey = PBKDF2(登录密码, login_salt) ← 本地缓存用
  9. cached_K = AES(loginDerivedKey, K)           ← 本地缓存 K
  10. has_master_password = (主密码 != null)

上传服务端:
  auth_key_hash, login_salt, kdf_settings,
  encrypted_user_key, recovery_salt,
  has_master_password,
  recovery_code_hash, recovery_code_salt（验恢复码用）

服务端:
  create_user_with_keys 落库上述字段
  password_version = 0
  签发 access_token + refresh_token

客户端:
  saveSession(cached_K, encrypted_user_key, login_salt, recovery_salt, password_version=0, ...)
  展示恢复码 [+ 主密码提示]（一次，提示保存）
  login(存 token)
```

**与当前差异**：
- 恢复码注册时就生成（当前是后续 generate）。
- 新增 K 派生 + encrypted_user_key（替代 password_wrapped + recovery_wrapped）。
- 登录密码不再包裹 User Key（改为缓存 K）。
- 可选主密码参与 K 派生。
- RSA 全部删除。

### 5.2 日常解锁（Web，已登录设备，语义1）

```
用户输入: 登录密码

客户端:
  1. 从本地 IndexedDB 读: cached_K, login_salt, kdf_settings, encrypted_user_key, password_version
  2. loginDerivedKey = PBKDF2(登录密码, login_salt, kdf_settings)    ← 修复：传 kdf_settings
  3. K = AES 解密(cached_K, loginDerivedKey)
  4. authKey = PBKDF2(登录密码, login_salt+"auth", kdf_settings)
  5. POST /auth/verify { auth_key_hash: authKey, password_version: 本地记录 }
     - 服务端校验 authKey（bcrypt 比对）
     - 若 authKey 不匹配 -> 401 INVALID_CREDENTIALS（密码错误，提示重试）
     - 若 password_version != 服务端 -> 409 PASSWORD_CHANGED_ELSEWHERE（版本不符，引导用户输入恢复码+主密码）
     - 若都通过 -> 200 { password_version }（正常）
  6. User Key = AES 解密(encrypted_user_key, K)   ← 本地缓存
  7. keyChain.setUserKey(User Key) -> 数据可用
```

**与当前差异**：
- 不再从服务器拿 password_wrapped（改用本地 cached_K + encrypted_user_key）。
- 新增 /auth/verify（每次校验 authKey + password_version，语义1）。
- 解密链路：登录密码 -> loginDerivedKey -> K -> User Key（多一层 K）。
- 修复 kdf_settings 传递 bug。

### 5.3 日常解锁（移动端，PIN/生物识别，语义1）

```
用户: 生物识别 / PIN

客户端:
  1. 从 Keychain 读: encrypted_derivedKey, cached_K, encrypted_user_key, password_version
  2. loginDerivedKey = 生物识别 解 encrypted_derivedKey（Keychain 硬件保护）
  3. K = AES 解密(cached_K, loginDerivedKey)
  4. authKey = PBKDF2(登录密码, login_salt+"auth")   ← 从 loginDerivedKey 派生？还是缓存？
     （注：PIN 解锁后需 authKey 做 /verify；loginDerivedKey 可派生 authKey，
       但需 login_salt + kdf_settings；这些缓存在本地）
  5. POST /auth/verify { auth_key_hash: authKey, password_version }
     - 版本不符 -> 拒绝，提示重新输入恢复码+主密码
  6. User Key = AES 解密(encrypted_user_key, K)
  7. 数据可用
```

**PIN 安全性**：PIN 保护 loginDerivedKey（存 Keychain，硬件 PIN 限次数）。破 PIN = loginDerivedKey = K 暴露，但需拿到设备 + 破硬件 PIN（限次数）。与 1Password/Bitwarden 移动端一致。

### 5.4 改登录密码（当前设备）

```
用户已登录，输入: 旧登录密码 + 新登录密码

客户端:
  1. 旧 loginDerivedKey = PBKDF2(旧登录密码, login_salt)
  2. K = AES 解密(cached_K, 旧 loginDerivedKey)   ← 取出 K
  3. 新 login_salt = 随机 32 字节
  4. 新 loginDerivedKey = PBKDF2(新登录密码, 新 login_salt)
  5. 新 cached_K = AES(新 loginDerivedKey, K)      ← 重新包裹 K（本地）
  6. 新 authKey = PBKDF2(新登录密码, 新 login_salt+"auth")

  7. POST /auth/change-login-password {
       current_auth_key_hash: 旧 authKey,
       new_auth_key_hash: 新 authKey,
       new_login_salt: 新 login_salt
     }
     服务端:
       - 校验旧 authKey
       - 更新 auth_key_hash = bcrypt(新 authKey)
       - 更新 login_salt = 新 login_salt
       - password_version += 1
       - revoke_all_user_tokens（切断其他设备）
       - 返回新 access_token + refresh_token

  8. 客户端:
     - 更新本地 cached_K（新登录密码包裹的 K）
     - 更新 login_salt, password_version
     - 更新 token（处理返回的 access_token/refresh_token）← 修复当前 bug

  User Key 不变（encrypted_user_key 不变），K 不变，数据不动。
```

**与当前差异**：
- 当前改密：旧密码解 password_wrapped -> User Key -> 新密码重包 password_wrapped -> 上传。
- 模型 D：旧登录密码解 cached_K -> K -> 新登录密码重包 cached_K（**本地**）-> 服务端只更新 authKey + login_salt + password_version。
- **服务端不存任何密钥密文**（encrypted_user_key 不变，K 不变）。
- **修复当前 bug**：处理返回的 token。

**其他设备**：
- password_version +1 -> 其他设备下次 /verify 时版本不符 -> 提示"登录密码已在别处修改，请重新输入恢复码[+主密码]"。
- 其他设备需重新走"换设备"流程（恢复码[+主密码]重派 K + 设新登录密码）。

### 5.5 忘登录密码恢复（冷却期保留）

```
用户输入: 恢复码 [+ 主密码（若设了）] + 新登录密码

步骤1 POST /auth/recovery/initiate { recovery_code, ... }
  服务端:
    - 验恢复码 HMAC（find_valid_recovery_code）
    - 检查冷却期（已在 cooldown -> 409）
    - 检查 pending_initiate（已有未过期的 -> 409，提示"已有恢复进行中，请查看邮件进行加速或冻结"，不允许覆盖）
    - 验通过 -> 建 pending_initiate_*（不改正式字段）
    - 返回 { encrypted_user_key, recovery_salt, initiate_token }

  客户端:
    - K = PBKDF2(恢复码 [+ 主密码], recovery_salt)   ← 客户端派生 K
    - User Key = AES 解密(encrypted_user_key, K)      ← 解出 User Key
    - 新 login_salt = 随机
    - 新 loginDerivedKey = PBKDF2(新登录密码, 新 login_salt)
    - 新 cached_K = AES(新 loginDerivedKey, K)        ← 重新缓存 K
    - 新 authKey = PBKDF2(新登录密码, 新 login_salt+"auth")

步骤2 POST /auth/recovery/confirm { initiate_token, new_auth_key_hash, new_login_salt }
  服务端:
    - 验 initiate_token
    - rollback_auth_key_hash = 旧 auth_key_hash       ← 旧登录密码（供 freeze 回滚）
    - rollback_login_salt = 旧 login_salt
    - 更新 auth_key_hash = bcrypt(新 authKey)
    - 更新 login_salt = 新 login_salt
    - password_version += 1
    - status = cooldown, cooldown_until = now + 24h
    - revoke_all_user_tokens
    - 返回 cooldown_until

  客户端:
    - 存 cached_K, encrypted_user_key, login_salt, recovery_salt, password_version

冷却期内:
  - D 门（require_not_in_cooldown）挂 sync 等数据端点 -> 旧 access token 被挡（零窗口）
  - accelerate（验证码）: 清 cooldown + 清 rollback（新登录密码确认生效）
  - freeze: 回滚 auth_key_hash + login_salt = rollback_*（旧登录密码恢复），清 rollback
  - 冷却到期 + 首次新密码登录成功: 清 rollback
```

**与当前差异**：
- 当前恢复：解 recovery_wrapped -> User Key -> 新密码重包 password_wrapped -> 上传。
- 模型 D：解 encrypted_user_key（用 K=恢复码[+主密码]派生）-> User Key -> 新登录密码重包 cached_K（**本地**）-> 服务端只更新 authKey + login_salt + password_version。
- **User Key 不变、K 不变、数据不动**。
- rollback 只存旧登录密码（authKey hash + login_salt），不存旧 wrapped（K/User Key 不变，无需回滚密钥）。
- 冷却期 + accelerate/freeze 保留（邮箱/手机告警 + 二次确认）。

### 5.6 换设备

```
新设备，用户输入: 登录密码 + 恢复码 [+ 主密码]

客户端:
  1. GET /auth/salt?email=... -> { login_salt, kdf_settings, recovery_salt, has_master_password }
     （/salt 返回 login_salt + kdf_settings + recovery_salt；防枚举假盐保留）
  
  2. authKey = PBKDF2(登录密码, login_salt+"auth")
  3. POST /auth/login { auth_key_hash: authKey }
     - 服务端认证 -> 返回 { encrypted_user_key, encrypted_token, password_version, ... }
  
  4. K = PBKDF2(恢复码 [+ 主密码], recovery_salt)   ← 恢复码从用户输入
  5. User Key = AES 解密(encrypted_user_key, K)      ← 解出 User Key
  
  6. loginDerivedKey = PBKDF2(登录密码, login_salt)
  7. cached_K = AES(loginDerivedKey, K)              ← 本地缓存 K
  8. 移动端: encrypted_derivedKey = AES(PIN/生物识别, loginDerivedKey)
  
  9. 数据可用（User Key 解 Item Keys -> 条目明文）
```

**与当前差异**：
- 当前换设备：只需登录密码（服务器下发 password_wrapped，密码解）。
- 模型 D：登录密码（认证）+ 恢复码[+主密码]（派生 K 解密）。**两者都要**。
- /salt 额外返回 recovery_salt（换设备时客户端派生 K 用）。

### 5.7 多设备改密同步

```
设备 A 改登录密码:
  - password_version +1（服务端）
  - revoke_all_user_tokens

设备 B（其他已登录设备）下次解锁（/verify）:
  1. POST /auth/verify { authKey, password_version=本地记录 }
     - 服务端: authKey 不匹配（设备 B 还用旧登录密码派生）-> 401
     - 或: password_version 不符 -> 返回 "password_changed"
  2. 客户端: 锁定本地 K，提示"登录密码已在别处修改，请重新输入恢复码[+主密码]"
  3. 用户输入恢复码[+主密码] -> 走换设备流程（重新派生 K + 设新登录密码）
```

**语义1（每次服务端校验）保证**：设备 B 在下次解锁时立即发现密码变了，不会继续用旧数据。

---

## 六、逐场景对比（当前 vs 模型 D）

### 6.1 服务器被入侵

| | 当前（并联） | 模型 D（串行） |
|---|---|---|
| 攻击者拿到 | password_wrapped, recovery_wrapped | encrypted_user_key（用 K 包裹） |
| 可离线暴破 | password_wrapped（密码弱即破）❌ | encrypted_user_key 需 K = 恢复码[+主密码]，132bit 不可破 ✅ |
| 弱密码用户 | ❌ 暴露 | ✅ 安全（登录密码密文不在服务器） |
| 结论 | 不安全 | **安全** |

### 6.2 登录密码失窃

| | 当前 | 模型 D |
|---|---|---|
| 攻击者能做什么 | 服务器拿 password_wrapped（认证）+ 密码解 -> 全部数据 ❌ | 认证通过拿 encrypted_user_key，但解需 K（恢复码[+主密码]）❌ 不可解 |
| 需配合什么 | 单独即可 | 需偷设备（本地 cached_K）或恢复码 |
| 结论 | 致命 | **不致命** |

### 6.3 忘登录密码

| | 当前 | 模型 D |
|---|---|---|
| 恢复路径 | 恢复码解 recovery_wrapped -> User Key | 恢复码[+主密码]派生 K -> 解 encrypted_user_key -> User Key |
| 数据 | 保住 | 保住 |
| 结论 | ✅ 可恢复 | ✅ 可恢复 |

### 6.4 换设备

| | 当前 | 模型 D |
|---|---|---|
| 需要 | 登录密码 | 登录密码 + 恢复码[+主密码] |
| 体验 | 简单（密码即可） | 需助记词（像 1Password 的 Emergency Kit） |

### 6.5 改登录密码

| | 当前 | 模型 D |
|---|---|---|
| 服务端改什么 | auth_key_hash + password_salt + password_wrapped | auth_key_hash + login_salt + password_version |
| User Key | 不变 | 不变 |
| 其他设备 | refresh 被吊销 -> 401 登出 | /verify 版本不符 -> 提示重新输入恢复码 |
| Web bug | 不处理返回 token（当前有 bug） | **修复**（处理返回 token） |

### 6.6 恢复码失窃

| | 当前 | 模型 D |
|---|---|---|
| 攻击者能做什么 | 解 recovery_wrapped -> User Key | 派生 K（若有主密码则不够） |
| 有主密码时 | 仍可解（recovery_wrapped 不含主密码）❌ | K 需主密码，恢复码单独不解 ✅ |
| 无主密码时 | 可解 | 可解（等同当前） |
| 结论 | 无主密码加强 | **主密码可选加强** |

### 6.7 忘主密码（若设了）

| | 当前 | 模型 D |
|---|---|---|
| 后果 | 无主密码概念 | K 永远派生不出 -> 数据永失 |
| 结论 | - | 用户自选承担，注册时强警告 |

---

## 七、安全分析

### 7.1 服务器泄露后的攻击面

```
攻击者拿到（模型 D）:
  - encrypted_user_key = AES(K, User Key)    ← 密文
  - recovery_code_hash = HMAC(server_key, salt+mnemonic)  ← 不可逆
  - auth_key_hash = bcrypt(PBKDF2(登录密码))  ← 可暴破 authKey，但 authKey 是 PBKDF2 600k 输出，再 bcrypt，极慢
  - login_salt, recovery_salt, kdf_settings  ← 公开参数

攻击 encrypted_user_key:
  需 K = PBKDF2(恢复码[+主密码], recovery_salt)
  恢复码 132bit -> 不可暴破
  若有主密码 -> 更不可破
  -> ✅ 安全

攻击 auth_key_hash:
  需暴破 authKey = PBKDF2(登录密码, salt+"auth", 600k)
  再 bcrypt 比对
  慢，但弱密码理论可破（破出 authKey 不等于破出 K，authKey 只用于认证，不用于解密）
  -> 即使破出 authKey，也解不了 encrypted_user_key（缺 K）
  -> ✅ 数据安全（认证凭据被破不等于数据被破）
```

**关键**：模型 D 下，认证凭据（authKey）与解密密钥（K）**完全分离**。破 authKey 只能伪造认证，不能解密数据。这是串联的核心优势。

### 7.2 离线攻击对比

| 攻击目标 | 当前（并联） | 模型 D |
|---|---|---|
| password_wrapped | PBKDF2(密码) -> 取决于密码强度 | **不存在** |
| encrypted_user_key | 不存在 | 需 K（恢复码 132bit）-> 不可破 |
| recovery_wrapped | 需恢复码 132bit -> 不可破 | **不存在** |
| auth_key_hash | bcrypt(PBKDF2) -> 慢，但破出无用（不解密） | 同左，破出无用 |

### 7.3 威胁模型总结

| 威胁 | 当前 | 模型 D |
|---|---|---|
| 服务器被入侵 + 弱密码 | ❌ 数据泄露 | ✅ 安全 |
| 服务器被入侵 + 强密码 | ✅ 安全 | ✅ 安全 |
| 登录密码失窃（无设备） | ❌ 可拿数据 | ✅ 不能拿数据 |
| 登录密码失窃 + 偷设备 | ❌ | ⚠️ PIN 破 -> K -> 数据（需破硬件 PIN） |
| 恢复码失窃 | ❌ 可拿数据 | ⚠️ 无主密码时可拿；有主密码时不可 |
| 忘登录密码 | ✅ 可恢复 | ✅ 可恢复 |
| 忘主密码 | - | ❌ 永失 |
| 丢恢复码 | 登录密码仍能用 | 登录密码仍能用；忘登录密码就永失 |

---

## 八、改动清单

### 8.1 后端

| 文件 | 改动 |
|---|---|
| `models/user.py` | users: password_salt->login_salt，加 password_version, has_master_password；user_keys: 删 password_wrapped+recovery_wrapped+encrypted_private+rsa_public_key，加 encrypted_user_key，保留 recovery_salt |
| `models/recovery_code.py` | 删 rollback_wrapped_user_key, monthly_initiation_count；rollback 加 rollback_login_salt；保留冷却期/pending_* |
| `services/auth_service.py` | create_user_with_keys 接收新字段（encrypted_user_key, recovery_salt, login_salt, has_master_password, recovery_code_hash/salt）；删 password_wrapped/recovery_wrapped/RSA |
| `services/recovery_service.py` | initiate 返回 encrypted_user_key + recovery_salt（替代 recovery_wrapped）；confirm 更新 authKey+login_salt+password_version（不写 password_wrapped）；rollback 存旧 authKey+login_salt |
| `api/auth.py` | 注册端点改字段；新增 POST /auth/verify（校验 authKey+password_version，限流 L1）；改密端点改逻辑（不写 password_wrapped，写 authKey+login_salt+password_version）；login 响应改返回 encrypted_user_key（替代 password_wrapped）；GET /salt 返回 recovery_salt |
| `api/recovery.py` | initiate/confirm 适配新密钥层次 |
| `middleware/__init__.py` | 冷却门保留（挂 sync 等数据端点，不变） |
| `schemas/auth.py` | 全部 Request/Response 适配新字段 |
| 迁移 | 删库重建（调试阶段） |

### 8.2 Web

| 文件 | 改动 |
|---|---|
| `crypto/kdf.ts` | 不变（PBKDF2 仍在） |
| `crypto/rsa.ts` | **删除** |
| `keychain/keyChain.ts` | generateKeys: 新增 K 派生 + encrypted_user_key；删 RSA 生成；unlockWithPassword: 改为解 cached_K -> K -> encrypted_user_key -> User Key；新增 unlockWithRecoveryCode（恢复码派生 K）；删 loadRsaKeys |
| `db/sessionStore.ts` | SessionData: 删 passwordWrapped/encryptedPrivate/rsaPublicKey，加 cached_K, encrypted_user_key, login_salt, recovery_salt, password_version |
| `pages/auth/RegisterPage.tsx` | 生成恢复码 + 派生 K + 可选主密码 + encrypted_user_key；删 RSA；展示恢复码一次 |
| `pages/auth/LoginPage.tsx` | 改密钥解密链路（loginDerivedKey -> K -> User Key）；修复 kdf_settings 传递；删 loadRsaKeys |
| `pages/auth/RecoveryPage.tsx` | 恢复流程改：解 encrypted_user_key（用 K=恢复码[+主密码]） |
| `pages/settings/ChangePasswordPage.tsx` | 改密逻辑改：解 cached_K -> K -> 新登录密码重包 cached_K；**处理返回 token** |
| `services/api.ts` | 新增 verifyRecovery/verifyLogin；改 login/changePassword 字段 |
| `types/api.ts, domain.ts` | 适配新字段，删 RSA 类型 |

### 8.3 Android（必须同步改）

| 文件 | 改动 |
|---|---|
| `CryptoManager.kt` | PBKDF2 100k->600k；AES 加 AAD；恢复码标准 BIP39 + PBKDF2 派生（删 SHA256）；实现 deriveAuthHash（salt+"auth"） |
| `KeyManager.kt` | generateKeys 改新密钥层次（K 派生 + encrypted_user_key）；注册时生成恢复码；删 RSA |
| `SessionManager.kt` | DataStore 改存 cached_K, encrypted_user_key, password_version, recovery_salt |
| `AuthRepository.kt` | 注册/登录/恢复全改调 v2 端点；删本地恢复；删 reset-password；加 /verify |
| `ApiService.kt, Dtos.kt` | 全面对齐 v2 字段 |
| `Entities.kt` | Item 改 EncryptedField（Room schema 升级） |
| `SyncRepository.kt` | 适配 EncryptedField |

> Android 改动量巨大（等于重写加密层 + 数据层），建议**单独阶段**做。

---

## 九、迁移路径

### 9.1 调试阶段（当前）

- 版本号保持 1，**删库重建**。
- 现有数据不保留（无生产用户）。
- 直接全量切到模型 D。

### 9.2 实施顺序建议

1. **后端**：模型 + 服务 + 端点 + 测试（含 /verify、注册、登录、改密、恢复两步、冷却门）。
2. **Web**：crypto/keychain/pages/tests。
3. **Android**：单独阶段（改动量最大）。

---

## 十、风险与取舍

### 10.1 安全取舍

| 收益 | 代价 |
|---|---|
| 服务器泄露不暴露密码 | 换设备需恢复码[+主密码] |
| 认证与解密分离（破 authKey 不解密） | 忘主密码（若设）= 永失 |
| 主密码可选加强 | 本地缓存管理（IndexedDB 丢 = 换设备） |
| 移动端 PIN 快速解锁 | 移动端离线不可用（语义1，每次校验） |

### 10.2 实现风险

1. **本地缓存可靠性**（Web IndexedDB）：清浏览器数据 = 丢 cached_K = 等于换设备，需恢复码。比 1Password 的 Keychain 脆弱。
2. **移动端 PIN 安全**：破 PIN = K 暴露（PIN 保护 loginDerivedKey）。需硬件 PIN 限次数（Keychain/Keystore）。
3. **Android 改动量**：等于重写，风险高。
4. **主密码不可改/不可取消**：一旦设置，永久锁定。用户误设后无法取消。UX 必须强警告（"此密码无法找回、无法取消，忘记=数据永失"）+ 二次确认。不实现"重置主密码"（复杂且罕见，需新账号级操作）。
4. **恢复码永久不换**：M9/M12 的"3 次配额/重生成"约束消解（恢复码永久，不重生成，不限次），但恢复码泄露后无法轮换（除非新账号）。
5. **password_version 一致性**：多设备同步依赖版本号，需保证 /verify 可靠。
6. **移动端离线不可用**：语义1（每次服务端校验）是设计决策，移动端离线无法解锁。这不是待实现特性，而是安全性优先于离线可用性的取舍。

### 10.3 RSA 删除的影响

- 删除 `encrypted_private` / `rsa_public_key` / `crypto/rsa.ts` / `loadRsaKeys` / `encryptItemData` 等。
- 跨设备：用恢复码[+主密码]派生 K（不再用 RSA 传 User Key）。
- v1 旧条目兼容：调试阶段无存量，不需要 RSA 解旧条目。若将来需要，再加回。
- 密钥层次简化：K -> User Key -> Item Keys，无 RSA 层。

### 10.4 恢复码生成的服务端 vs 客户端

当前：服务端生成 BIP39（`generate_bip39_code`），返回明文一次。
模型 D：恢复码注册时就要有（派生 K）。两种方式：
- (a) 服务端生成 + 返回明文（当前模式）：客户端拿到明文后派生 K。
- (b) 客户端生成：客户端生成 BIP39，上传 `recovery_code_hash`（HMAC），服务端只存哈希。

**建议 (a)**（保持当前模式）：服务端生成 BIP39，返回明文一次，客户端用明文派生 K + 上传 `recovery_code_hash`。服务端不存明文。

---

## 十一、总结

模型 D 是一个**安全性接近 1Password 串联、可用性优于 1Password**（忘登录密码可恢复）的方案。核心改进：

1. **服务器不存密码密文**（删 password_wrapped + recovery_wrapped，只存 encrypted_user_key）。
2. **认证与解密分离**（authKey 只认证，K 才解密）。
3. **登录密码可改可恢复**（不参与 K 派生，改密/忘密码不影响密钥）。
4. **主密码可选加强**（用户自主安全/风险）。
5. **移动端 PIN + 服务端校验**（语义1，一致性优先）。
6. **恢复码注册时生成**（永久，不重生成，消解 M9/M12）。
7. **RSA 删除**（简化密钥层次）。
8. **冷却期保留**（邮箱/手机告警 + 二次确认）。

代价：换设备需恢复码[+主密码]、忘主密码永失、移动端离线不可用、Android 需大改。

---

## 附录：术语对照

| 模型 D 术语 | 当前 SafeBox 术语 | 1Password 术语 |
|---|---|---|
| 恢复码（助记词） | 恢复码 | Secret Key（部分） |
| 主密码（可选） | 无 | Secret Key（部分）+ Master Password |
| 登录密码 | 主密码/密码 | Master Password |
| K | User Key | MUK |
| encrypted_user_key | password_wrapped + recovery_wrapped | 加密的 Vault Key |
| cached_K | 无（password_wrapped 直接存） | 本地 Keychain 缓存 |
