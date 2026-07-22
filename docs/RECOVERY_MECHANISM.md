# SafeBox 助记词与 session 机制（SRP-6a + 2SKD + 三态 session）

本文档详述助记词、三态 session（login/lock/logout）、换设备、改密机制。对标 1Password 白皮书。

---

## 一、设计目标

| 目标 | 说明 |
|---|---|
| 零知识认证 | 服务端只存 SRP verifier，不存密码/助记词明文，登录过程不泄露密码（SRP-6a） |
| 助记词不上传 | 助记词=Secret Key，客户端本地持有 + 加密缓存，服务端永不接收 |
| 2SKD 双秘密 | `x = PBKDF2(主密码) XOR HKDF(助记词)`，主密码+助记词缺一不可 |
| 三态 session | login/lock/logout 对标 1Password；lock/unlock 本地不解 SRP，logout 清缓存重登 |
| K 通信加密 | SRP 握手 K_comm 加密认证通信，session 级 30 天，防路径泄密 |
| 忘主密码 = 丢失 | 主密码参与 K + x 派生，忘则无法恢复 |

---

## 二、SRP-6a + 2SKD

- **N/g**：RFC 3526 4096-bit MODP + g=2，SHA-256（`srp_service.py` + `crypto/srp.ts` 逐字节一致）
- **x 派生（2SKD）**：
  - `stretched_salt = HKDF(srp_salt, salt=邮箱, info="safebox-srp-salt", 32)`
  - `pbkdf2_out = PBKDF2-HMAC-SHA256(主密码, stretched_salt, 600_000, 32)`
  - `hkdf_out = HKDF(助记词, salt=邮箱, info="safebox-srp-auth", 32)`
  - `x = int(pbkdf2_out XOR hkdf_out)`
- **verifier**：`v = g^x mod N`（客户端派生，注册时上传，服务端存 `users.srp_verifier`）
- **握手**：`A=g^a, B=(k·v+g^b) mod N, u=H(A|B), S=(B-k·g^x)^(a+u·x), K_comm=H(S), M1=H(A|B|K_comm), M2=H(A|M1|K_comm)`

---

## 三、两种 K（不要混淆）

| K | 派生 | 用途 | 生命周期 |
|---|---|---|---|
| **派生 K** | `PBKDF2(助记词+主密码, mnemonic_salt, 600k)` | 加密 UserKey（encrypted_user_key） | 永久（主密码变才变） |
| **通信 K_comm** | `H(S)`（SRP 握手） | 加密认证 body + 响应 | session 级 30 天（login 建/logout 清） |

---

## 四、助记词

- BIP39 12 词（132bit 熵），客户端 `crypto/bip39.ts` 本地生成，注册时展示一次
- 助记词 = Secret Key，参与：
  - SRP x 派生（2SKD 的 HKDF 项）
  - 派生 K（`K = PBKDF2(助记词+主密码, mnemonic_salt)`）
- **不上传**（废除 `mnemonics` 表 + `recovery_service.py` + `/auth/recovery/initiate`）
- **加密缓存**：`mnemonic_encrypted = AES(localDerivedKey, 助记词)` 存 IndexedDB，同设备登录解出算 SRP x。`localDerivedKey = PBKDF2(主密码, local_salt)`

---

## 五、合并主密码模型

- **主密码 = 登录密码 + Passphrase 合一**，参与：
  - 派生 K（`K = PBKDF2(助记词+主密码, mnemonic_salt)`）
  - SRP x 派生（2SKD 的 PBKDF2 项）
  - 本地缓存（localDerivedKey 包裹 cached_K + mnemonic_encrypted）
- **忘主密码 = 数据丢失**：主密码是 K + x 的派生因子，忘则无法派生 K 解 UserKey，也无法算 x 登录。服务端无主密码明文，无法重置。

---

## 六、三态 session 模型（对标 1Password）

| 状态 | 触发 | 动作 | K_comm | cached_K/mnemonic_encrypted |
|---|---|---|---|---|
| **login** | 主密码+助记词（或同设备缓存取 mnemonic） | SRP 握手建 session + K_comm | 建立（client + Redis） | 保留/建立 |
| **lock** | autoLock 20min 空闲 | `keyChain.lock()` 清内存 UserKey | 不变 | 不变（IndexedDB 保留） |
| **unlock** | 锁屏输主密码 | `unlockWithPassword` 本地解 cached_K -> UserKey（不走 SRP） | 不变 | 不变 |
| **logout** | 用户主动退出 | 清整个 session（cached_K + mnemonic_encrypted + session_K + token） | 清除 | 清除 |

### 决策 A：logout 清缓存（对标 1Password）

- logout 清 cached_K + mnemonic_encrypted + session_K + token（client IndexedDB + server Redis session_key）
- 重登走**换设备流程**（RecoveryPage：助记词+主密码 SRP + recoverAndRewrap 重建缓存），不是同设备登录
- 代价：退出重登要助记词（用户须保管）；设备失守后缓存不在（减少暴露）
- `AuthContext.logout`：`apiClient.logout()`（server 撤销 token + 清 session_key）+ `keyChain.lock()` + `clearSession()`（client 清缓存）

### session 边界

- session = login 到 logout（或 refresh token 30 天过期）
- session 内 token 过期重登：mnemonic_encrypted 还在 -> 同设备登录（主密码，从缓存取 mnemonic）
- logout 后重登：mnemonic_encrypted 清 -> RecoveryPage（助记词+主密码）

---

## 七、同设备登录（LoginPage，mnemonic_encrypted 在）

1. `GET /auth/salt` -> srp_salt + local_salt + mnemonic_salt
2. 从 IndexedDB 取 `mnemonic_encrypted`，用主密码派生 localDerivedKey 解出 mnemonic
3. SRP 两步（challenge 传 `device_id` 同设备 / verify 建 K_comm）
4. `verifyM2` 验服务端
5. `unlockWithPassword`（cached_K 解 UserKey）
6. saveSession device_id + session_K

**无 mnemonic_encrypted（logout 后/换设备）**：LoginPage `srpLogin` throw `needRecovery` -> 提示走 RecoveryPage。

---

## 八、换设备 / logout 后重登（RecoveryPage，mnemonic_encrypted 无）

1. `GET /auth/salt`
2. 用户输助记词 + 主密码
3. SRP 两步（challenge 传 `device_name` 新设备建 UserDevice + verify 建 K_comm；x 含助记词故同时验主密码+助记词）
4. `recoverAndRewrap(助记词, 主密码, mnemonic_salt, encrypted_user_key, local_salt)`：
   - K = PBKDF2(助记词+主密码, mnemonic_salt)
   - UserKey = AES_Dec(K, encrypted_user_key)
   - cached_K = AES(localDerivedKey, K)
   - mnemonic_encrypted = AES(localDerivedKey, 助记词)
5. saveSession（device_id + session_K + cached_K + mnemonic_encrypted）

**助记词/主密码错**：SRP x 错 -> M1 不匹配 -> 401（与用户不存在一样，fake verifier 防枚举）。

---

## 九、改主密码（ChangePasswordPage）

主密码参与 K + x 派生，改密 = K 变 + verifier 变：

1. 输入：当前主密码 + 新主密码 + 助记词 + 验证码
2. `unlockWithPassword`（载入 UserKey 到内存）
3. **前置 SRP 登录**（验旧密码，同设备 device_id）-> fresh token + K_comm
4. `changeMasterPassword(助记词, email, mnemonic_salt, 新主密码, new_local_salt)`：
   - 新 K + new_encrypted_user_key + new_cached_K + new_mnemonic_encrypted + new_srp_verifier + new_srp_salt
5. `POST /auth/change-password`（fresh token + 验证码 + 新材料）：
   - revoke_all_user_tokens + **清其他 device session_key**（当前保留）+ 写新材料 + 异步通知邮件
6. 本地落库新材料 + 新 token（session_K 保留 fresh K，直到重登）
7. UserKey 不变，条目无需重加密

**其他设备**：session_key 清 -> K_comm 不存 -> 认证 401 -> 踢到 RecoveryPage（新密码+助记词重登）。

---

## 十、忘主密码

数据永久丢失（主密码参与 K + x 派生，仅有助记词无法解 encrypted_user_key）。无服务端重置。这不是 bug，是设计目标。

---

## 十一、API 端点

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | /auth/salt | SRP 参数 + salt（防枚举） |
| POST | /auth/login/srp/challenge | SRP 第一步：A -> session_id + B（device_id?/device_name?） |
| POST | /auth/login/srp/verify | SRP 第二步：M1 -> M2 + token + K_comm 存 |
| POST | /auth/change-password | 改密（fresh token + 验证码 + 清其他 device K） |
| POST /auth/logout | 撤销 token + 清 session_key（client 清缓存，决策 A） |
| DELETE | /auth/account | 注销（fresh token + 验证码） |
| GET /auth/devices | 设备列表（含 client_name/os_name/last_auth_ip） |
| DELETE /auth/devices/{id} | deauthorize（access 立即失效） |

**已删除**：`/auth/login/email`、`/auth/login/phone`、`/auth/recovery/initiate`、`/auth/recovery/*`、`/auth/register-device`。

---

## 十二、device deauthorize + K 通信

- device_id 绑 access/refresh token；challenge/verify 从 User-Agent + IP 填 client_name/os_name/last_auth_ip
- `DELETE /auth/devices/{id}` 撤销（is_revoked + 删 TokenFamily + Redis device:revoked TTL 30min）
- K_comm session 级 30 天（Redis session_key + client IndexedDB）；不存拒 401（防 downgrade）
- logout/change-password 清 session_key（change-password 清其他保留当前）

---

## 十三、核心原则

| 原则 | 说明 |
|---|---|
| 服务端只存 verifier | 不存密码/助记词，登录零知识（SRP-6a） |
| 助记词不上传 | = Secret Key，客户端本地持有 + 加密缓存 |
| 2SKD 双秘密 | x 需主密码+助记词，缺一不可 |
| 三态 session | login/lock/logout 对标 1Password；logout 清缓存（决策 A） |
| K 通信 session 级 | 30 天，不存拒 401，纯 ASGI middleware |
| device deauthorize | device_id 绑 token + Redis revoked（access 立即失效） |
| 主密码参与 K 派生 | 忘主密码 = 数据丢失（无重置） |
| 换设备 = SRP + recoverAndRewrap | 助记词+主密码派生 K 解密 |
| 改密需助记词+邮箱 | K 变 + verifier 变，清其他 device K，前置 SRP 验旧密码 |
| 零知识边界 | 客服/服务器任何时候都接触不到明文密钥/助记词 |
