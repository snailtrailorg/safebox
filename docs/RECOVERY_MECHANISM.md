# SafeBox 助记词与换设备机制（SRP-6a + 2SKD）

---

## 一、设计目标

| 目标 | 说明 |
| :--- | :--- |
| **零知识认证** | 服务端只存 SRP verifier，不存密码/助记词明文，登录过程不泄露密码（SRP-6a）。 |
| **助记词不上传** | 助记词=Secret Key，客户端本地持有 + 加密缓存，服务端永不接收（废除 mnemonics 表）。 |
| **2SKD 双秘密** | `x = PBKDF2(主密码) XOR HKDF(助记词)`，主密码+助记词缺一不可。 |
| **换设备登录** | 凭助记词 + 主密码在新设备解密数据（对应 1Password Emergency Kit + Master Password）。 |
| **忘主密码 = 数据丢失** | 主密码参与 K 派生，忘则无法恢复（无服务端重置）。 |

---

## 二、SRP-6a + 2SKD

- **N/g**：RFC 3526 4096-bit MODP group + g=2，SHA-256（`server/app/services/srp_service.py` 硬编码 1024 hex；前端 `web/src/crypto/srp.ts` BigInt + Web Crypto 逐字节对齐，固定向量交叉验证见 `tests/srp.test.ts`）。
- **x 派生（2SKD，对标 1Password）**：
  - `stretched_salt = HKDF(srp_salt, salt=邮箱, info="safebox-srp-salt", 32)`
  - `pbkdf2_out = PBKDF2-HMAC-SHA256(主密码, stretched_salt, 600_000, 32)`
  - `hkdf_out = HKDF(助记词, salt=邮箱, info="safebox-srp-auth", 32)`
  - `x = int(pbkdf2_out XOR hkdf_out)`
- **verifier**：`v = g^x mod N`（客户端派生，注册时上传，服务端存 `users.srp_verifier`）。
- **握手**：`A=g^a, B=(k·v+g^b) mod N, u=H(A|B), S=(B-k·g^x)^(a+u·x)=(A·v^u)^b, K=H(S), M1=H(A|B|K), M2=H(A|M1|K)`。

---

## 三、助记词

- BIP39 12 词（132bit 熵），**客户端 `web/src/crypto/bip39.ts` 本地生成**，注册时展示一次。
- 助记词 = Secret Key，参与：
  - SRP x 派生（2SKD 的 HKDF 项）
  - K 派生（`K = deriveKey(助记词+主密码, mnemonic_salt)`）
- **不上传服务端**（废除 `mnemonics` 表 + `recovery_service.py` + `/auth/recovery/initiate` 端点）。
- **加密缓存**：`mnemonic_encrypted = AES(localDerivedKey, 助记词)` 存 IndexedDB session，同设备登录解出算 SRP x（对标 1Password Secret Key 设备缓存）。`localDerivedKey = deriveKey(主密码, local_salt)`。

---

## 四、合并主密码模型

- **主密码 = 登录密码 + Passphrase 合一**，参与：
  - K 派生（`K = PBKDF2(助记词+主密码, mnemonic_salt)`）
  - SRP x 派生（2SKD 的 PBKDF2 项）
  - 本地缓存（`localDerivedKey` 包裹 `cached_K` + `mnemonic_encrypted`）
- **忘主密码 = 数据丢失**：主密码是 K + x 的派生因子，忘则无法派生 K 解密 User Key，也无法算 x 登录。服务端无主密码明文，无法重置。

---

## 五、同设备登录（LoginPage）

设备已有 `cached_K` + `mnemonic_encrypted`（注册/换设备时存）：

1. `GET /auth/salt?email=<email>` -> `srp_salt` + `local_salt` + `mnemonic_salt` + N + g
2. 从 IndexedDB 取 `mnemonic_encrypted`，用主密码派生 `localDerivedKey` 解出 `mnemonic`
3. SRP 两步：
   - `POST /auth/login/srp/challenge` {target_type, target, A} -> {session_id, B}
   - `x = deriveX(主密码, mnemonic, srp_salt, 邮箱)`；算 u/S/K/M1
   - `POST /auth/login/srp/verify` {session_id, M1} -> {token, encrypted_user_key, M2, ...}
4. `verifyM2(A, M1, K, M2)` 验证服务端
5. `keyChain.unlockWithPassword(主密码, local_salt, encrypted_user_key, cached_K)` 解 UserKey
6. 存 session，登录完成

**无 mnemonic_encrypted（首次此设备/换设备）**：提示走恢复入口（RecoveryPage）。

---

## 六、换设备登录（RecoveryPage）

新设备无本地缓存，需助记词重新派生：

1. `GET /auth/salt?email=<email>` -> srp_salt + local_salt + mnemonic_salt
2. SRP 两步登录（用输入的助记词 + 主密码算 x，x 含助记词故同时验两者）
3. `keyChain.recoverAndRewrap(助记词, 主密码, mnemonic_salt, encrypted_user_key, local_salt)`：
   - K = PBKDF2(助记词+主密码, mnemonic_salt)
   - UserKey = AES_Decrypt(K, encrypted_user_key)
   - localDerivedKey = PBKDF2(主密码, local_salt)
   - cached_K = AES(localDerivedKey, K_raw)
   - mnemonic_encrypted = AES(localDerivedKey, 助记词)
4. 存 session（含 cached_K + mnemonic_encrypted），登录完成

**助记词/主密码错**：SRP x 错 -> M1 不匹配 -> 401（与用户不存在一样返回 401，fake verifier 防枚举）。

---

## 七、改主密码（ChangePasswordPage）

主密码参与 K + x 派生，改密 = K 变 + verifier 变：

1. 用户输入：当前主密码 + 新主密码 + 助记词 + 验证码。
2. `keyChain.unlockWithPassword(当前主密码, ...)` 载入 UserKey 到内存。
3. **前置 SRP 登录**（验旧密码）：用当前密码 + 助记词走 SRP 登录拿 fresh token。
4. `keyChain.changeMasterPassword(助记词, email, mnemonic_salt, 新主密码, new_local_salt)`：
   - 新 K = PBKDF2(助记词+新主密码, mnemonic_salt)
   - new_encrypted_user_key = AES(新K, UserKey)
   - new_cached_K = AES(新localDerivedKey, 新K_raw)
   - new_mnemonic_encrypted = AES(新localDerivedKey, 助记词)
   - new_srp_verifier = g^deriveX(新主密码, 助记词, new_srp_salt, email) mod N
5. `POST /auth/change-password`（fresh token + 验证码 + 新材料）：服务端覆盖 srp_verifier/srp_salt/local_salt/encrypted_user_key，吊销旧 token。
6. 本地落库新材料 + 新 token。

**Google 用户**：用当前 token（无 email/phone 走 SRP 登录）。

---

## 八、API 端点

| 方法 | 路径 | 用途 |
| :--- | :--- | :--- |
| GET | /auth/salt | 返回 srp_salt/local_salt/mnemonic_salt/kdf_settings/N/g（未注册返回 fake salt 防枚举） |
| POST | /auth/login/srp/challenge | SRP 第一步：A -> session_id + B |
| POST | /auth/login/srp/verify | SRP 第二步：M1 -> M2 + token |
| POST | /auth/login/google | Google 登录（google_id_token，不走 SRP） |
| POST | /auth/change-password | 改主密码（fresh token + 验证码 + 新 SRP 材料） |
| DELETE | /auth/account | 注销（fresh token + 验证码） |

**已删除**：`/auth/login/email`、`/auth/login/phone`、`/auth/recovery/initiate`、所有 `/auth/recovery/*`。

---

## 九、核心原则

| 原则 | 说明 |
| :--- | :--- |
| 服务端只存 verifier | 不存密码/助记词，登录零知识（SRP-6a） |
| 助记词不上传 | = Secret Key，客户端本地持有 + 加密缓存 |
| 2SKD 双秘密 | x 需主密码+助记词，缺一不可 |
| 主密码参与 K 派生 | 忘主密码 = 数据丢失（无服务端重置） |
| 换设备 = SRP + recoverAndRewrap | 助记词+主密码派生 K 解密 |
| 改密需助记词+邮箱 | K 变 + verifier 变，前置 SRP 验旧密码 |
| 零知识边界 | 客服、服务器任何时候都接触不到明文密钥/助记词 |
