# SafeBox 助记词与换设备机制

---

## 一、设计目标

| 目标 | 说明 |
| :--- | :--- |
| **换设备登录** | 用户在新设备上，凭助记词 + 主密码即可解密数据（对应 1Password 的 Emergency Kit + Master Password）。 |
| **忘主密码 = 数据丢失** | 主密码参与 K 派生，忘主密码无法恢复（无冷却、无回滚、无服务端重置）。用户需妥善保存助记词 + 主密码。 |
| **不被骚扰拖垮** | initiate 失败由 RateLimitMiddleware（100/h）防骚扰。助记词 132bit 不可暴力枚举，不累积失败计数、不锁定。 |

---

## 二、助记词

- BIP39 12 词助记词（132bit 熵），**客户端生成**，注册时展示一次。
- 客户端上传助记词明文给服务端，服务端计算 `HMAC-SHA256(server_key, salt + normalized_mnemonic)` 存哈希，不存明文。
- 助记词与主密码一起派生 K（`K = PBKDF2(助记词+主密码, mnemonic_salt)`），永久不变。
- `server_key` = 环境变量 `SAFEBOX_RECOVERY_HMAC_KEY`（base64 32 字节），数据库泄露后无法离线验证。

---

## 三、合并主密码模型

- **主密码 = 登录密码 + Passphrase 合一**（原 Passphrase 作为可选加密因子已并入主密码，不再分离）。
- 主密码既派生 K（加密），又派生 auth hash（`local_password_hash = PBKDF2(主密码, local_salt+"auth")`，服务端 bcrypt）。
- **K = PBKDF2(助记词 + 主密码, mnemonic_salt)**：主密码参与 K 派生，故改主密码 = K 变。
- **忘主密码 = 数据丢失**：主密码是 K 的派生因子之一，忘则无法派生 K，无法解密 User Key。服务端无主密码明文，无法重置。

---

## 四、换设备登录（RecoveryPage）

新设备无本地 `cached_K`，需助记词重新派生 K：

1. `GET /auth/salt?email=<email>` -> `local_salt` + `mnemonic_salt`
2. `local_password_hash = deriveAuthKey(主密码, local_salt)` -> `POST /auth/login/email`（服务器验主密码）
   - 响应含 `access_token` + `encrypted_user_key` + `mnemonic_salt` + `local_salt`
3. `keyChain.recoverAndRewrap(助记词, 主密码, mnemonic_salt, encrypted_user_key, local_salt)`：
   - K = PBKDF2(助记词 + 主密码, mnemonic_salt)
   - UserKey = AES_Decrypt(K, encrypted_user_key)
   - localDerivedKey = PBKDF2(主密码, local_salt)
   - cached_K = AES(localDerivedKey, K_raw)（建立本地缓存）
4. 存 session（token + local_salt + encrypted_user_key + mnemonic_salt + cached_K），登录完成。

**助记词对不对靠 recoverAndRewrap 解密成败判断**（服务器不单独验助记词，同 1Password 不验 Secret Key）。助记词错则 K 错，解密失败。

---

## 五、`/auth/recovery/initiate` 端点（保留，死代码）

```
POST /auth/recovery/initiate
请求: { target, value, mnemonic }
响应: { encrypted_user_key, mnemonic_salt }
```

- 验助记词（HMAC 比对）后返回 encrypted_user_key + mnemonic_salt。
- **web 换设备实际走 login + recoverAndRewrap**（login 也返回 encrypted_user_key，更直接），initiate 不被 web 调用。
- 保留此端点作为"仅验助记词"的独立入口（同 `recovery_service.create_mnemonic`/`generate_mnemonic_hmac_salt` 为死代码）。

---

## 六、改主密码（change-password）

主密码参与 K 派生，改主密码 = K 变：

1. 已登录（UserKey 在内存）。
2. 用户输入：助记词 + 当前主密码 + 新主密码 + 验证码。
3. `current_local_password_hash = deriveAuthKey(当前主密码, old_local_salt)`（服务端二次校验）。
4. `keyChain.changeMasterPassword(助记词, mnemonic_salt, 新主密码, new_local_salt)`：
   - 新 K = PBKDF2(助记词 + 新主密码, mnemonic_salt)
   - new_encrypted_user_key = AES(新K, UserKey)（重新包裹，UserKey 不变）
   - new_cached_K = AES(新localDerivedKey, 新K_raw)
   - new_local_password_hash = deriveAuthKey(新主密码, new_local_salt)
5. `POST /auth/change-password`：服务端验当前密码 + 验证码后，写 new_local_password_hash + new_local_salt + new_encrypted_user_key，吊销所有旧 token，返回新 token。
6. 本地落库新 local_salt + new_cached_K + new_encrypted_user_key + 新 token。

**需助记词**（派生新 K）。忘主密码则无法改密（也无法恢复）。

---

## 七、API 端点

| 方法 | 路径 | 用途 |
| :--- | :--- | :--- |
| POST | /auth/recovery/initiate | 验助记词，返回 encrypted_user_key + mnemonic_salt（web 不调，死代码） |
| POST | /auth/change-password | 改主密码（需助记词重派生 K + 重包裹 encrypted_user_key） |

**已删除**：`/auth/recovery/confirm`、`/auth/recovery/accelerate`、`/auth/recovery/freeze`、`/auth/recovery/status`、`/auth/recovery/generate`。

---

## 八、核心原则

| 原则 | 说明 |
| :--- | :--- |
| 服务端只存 HMAC 哈希 | 助记词生成后仅返回一次 |
| 助记词永久 | K 的种子，不重生成、不限次 |
| 主密码参与 K 派生 | 忘主密码 = 数据丢失（无服务端重置） |
| 换设备 = login + recoverAndRewrap | 助记词+主密码派生 K 解密，对应 1Password 模式 |
| 改密需助记词 | K 变，重新包裹 encrypted_user_key |
| 零知识边界 | 客服、服务器任何时候都接触不到明文密钥 |
