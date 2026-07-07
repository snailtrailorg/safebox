# SafeBox 数据流文档

> 版本：v0.1（当前实现）
> 覆盖路径：注册 / 登录 / 恢复 / 改密 / 注销
> 每路径包含：前置条件 → 请求 → 处理 → 响应 → 后置条件

---

## 路径 1：Email 注册

```
用户                              Web 客户端                 FastAPI 服务端                Redis            PostgreSQL
───                              ─────────                 ──────────────                ─────            ──────────
  ① 填写邮箱 + 密码
  ② 点击"获取验证码"
                                 ③ POST /auth/send-code
                                    {target:"email", value}
                                                             ④ check_ip_rate(client_ip)  → ZADD iprate:{ip}
                                                             ⑤ check_rate_limit(email)   → GET vc_rl:email:{email}
                                                             ⑥ IF ok: SETEX vc:email:{email}
                                                             ⑦ send_verification_email()
  ⑧ 收到验证码
  ⑨ 输入验证码
                                 ⑩ 生成密钥：
                                    salt = generateSalt()
                                    masterKey = new AES-256
                                    passwordDerivedKey = PBKDF2(password, salt)
                                    passwordHash = PBKDF2(password, salt+"auth")
                                    rsaKeyPair = new RSA-4096
                                    recoveryCode = BIP39 24-word
                                    recoveryKey = SHA-256(recoveryCode)
                                    passwordWrapped = AES-GCM(masterKey, passwordDerivedKey)
                                    recoveryWrapped = AES-GCM(masterKey, recoveryKey)
                                    encryptedPrivateKey = AES-GCM(masterKey, rsaPrivateKey)

                                 ⑪ POST /auth/register/email
                                    {email, verification_code, password_hash, password_salt,
                                     password_wrapped, recovery_wrapped, encrypted_private, rsa_public_key}
                                                             ⑫ verify_and_consume(email)  → GETDEL vc:email:{email}
                                                             ⑬ find_user_by_email()
                                                             ⑭ clear_login_failures(email) → DEL loginfail:email:{email}
                                                             ⑮ hash_password(client_hash) [bcrypt]
                                                             ⑯ INSERT user + user_keys + user_device
                                                             ⑰ create_access_token + create_refresh_token
                                                                                              → INSERT token_families
  ⑱ 收到响应 {access_token,     ← ⑱ 返回 {user_id, access_token, refresh_token}
     refresh_token}
  ⑲ saveSession → IndexedDB
  ⑳ login() → AuthContext
  ㉑ navigate("/")
  ㉒ 显示恢复码 → 提示用户抄写
```

### 前置条件
- 邮箱没有被注册过（返回 409 如果已存在）
- 验证码已发送且未过期（5 分钟有效）
- 用户设备上 Web Crypto API 可用

### 失败路径

| 条件 | 错误码 | 说明 |
|------|--------|------|
| 验证码无效/过期 | 400 | GETDEL 返回 nil 或不匹配 |
| 邮箱已注册 | 409 | find_user_by_email 返回非空 |
| IP 超限 | 429 | check_ip_rate 返回 True |
| 验证码发送超限 | 429 | check_rate_limit 返回 False |
| 邮件发送失败 | 503 | send_verification_email 返回 False |

### 后置条件
- 客户端内存中有 masterKey / rsaPrivateKey
- IndexedDB 中存有 session (email, passwordSalt, passwordWrapped, ...)
- 服务端 DB 中创建新用户、密钥记录、设备记录、初始 token family
- Redis 中的验证码已消费（GETDEL）
- 该邮箱的登录失败记录已清除

---

## 路径 2：Email 登录

```
用户                        Web 客户端                 FastAPI 服务端                Redis                PostgreSQL
───                        ─────────                 ──────────────                ─────                ──────────
  ① 输入邮箱 + 密码
                            ② GET /auth/salt?email=michael%40...
                                                                                     ← SELECT user.password_salt
                            ③ passwordDerivedKey = PBKDF2(password, salt)
                              passwordHash = PBKDF2(password, salt+"auth")
                            ④ POST /auth/login/email
                               {email, password_hash}
                                                                  ⑤ check_ip_rate(client_ip) → ZADD iprate:{ip}
                                                                  ⑥ get_login_wait(email)     → GET loginfail:email:{email}
                                                                  ⑦ IF wait>0 → record_login_failure → 429
                                                                  ⑧ find_user_by_email()      ← SELECT user + user_keys + user_devices
                                                                  ⑨ IF not user: hash_password(虚假) + record_login_failure → 401
                                                                  ⑩ verify_password(client_hash, stored_hash)
                                                                  ⑪ IF fail: record_login_failure → 401
                                                                  ⑫ clear_login_failures() → DEL loginfail:email:{email}
                                                                  ⑬ create_access_token + create_refresh_token
                                                                                                                                   → INSERT token_families
                            ⑭ 收到响应 {access_token, refresh_token, password_wrapped, ...}
                            ⑮ unlockWithPassword(password, passwordWrapped)
                               → 解密得到 masterKey
                            ⑯ loadRsaKeys() → 解密 RSA 私钥
                            ⑰ saveSession → IndexedDB
                            ⑱ login() → AuthContext
                            ⑲ navigate("/")
```

### 前置条件
- 邮箱已注册
- 密码正确（以服务端 bcrypt 验证为准）
- 未超过限流阈值（L1 email + L2 IP）

### 失败路径

| 条件 | 错误码 | 说明 |
|------|--------|------|
| IP 超限 | 429 | check_ip_rate → True |
| email 限流中 | 429 | get_login_wait > 0 |
| 邮箱不存在 | 401 | 恒等时间防止枚举（跑假 bcrypt） |
| 密码错误 | 401 | bcrypt.checkpw 失败 |

### 后置条件
- 客户端内存：masterKey / RSA key pair
- IndexedDB：新的 refresh token
- 服务端：新的 token family 条目（旧 token 仍有效，直到 rotation 或 logout）

---

## 路径 3：恢复码重置密码

```
用户                        Web 客户端                        FastAPI 服务端              Redis                PostgreSQL
───                        ─────────                        ──────────────              ─────                ──────────
① 输入邮箱 + BIP39 恢复码
                            ② GET /auth/salt?email=...
                            ③ unlockWithRecoveryCode(code, recoveryWrapped)
                               → SHA-256(code) → recoveryKey
                               → AES-GCM-Decrypt(recoveryWrapped, recoveryKey) → masterKey ✅
                               → loadRsaKeys() → RSA 私钥
                            ④ 提示：恢复到 masterKey 成功
⑤ 输入新密码
                            ⑥ 新 salt + 新 PBKDF2 → newDerivedKey + newHash
                              newPasswordWrapped = AES-GCM(masterKey, newDerivedKey)
                            ⑦ POST /auth/recovery-reset
                               {target:"email", value, new_password_hash, new_password_salt, new_password_wrapped}
                                                                                           ⑧ find_user_by_email()
                                                                                           ⑨ hash_password() [bcrypt]
                                                                                           ⑩ UPDATE user.password_hash/salt
                                                                                              UPDATE user_keys.password_wrapped
                                                                                           ⑪ revoke_all_user_tokens
                                                                                           ⑫ create_access_token + create_refresh_token
                            ⑬ 收到 {access_token, refresh_token, ...}
                            ⑭ saveSession → IndexedDB
                            ⑮ login() + navigate("/")
```

### 前置条件
- BIP39 恢复码正确（能被 SHA-256 后解密 recoveryWrapped）
- 邮箱已注册
- 新密码强度 ≥ 8 字符

### 失败路径

| 条件 | 错误码 | 说明 |
|------|--------|------|
| 恢复码错误 | 前端已拦截 | SHA-256→AES-GCM 解密失败，不请求 API |
| 邮箱未注册 | 404（来自服务端） | find_user_by_email 返回 None |
| 邮箱不存在 | 404 | |

### 后置条件
- 新密码已生效（可登录）
- 旧 refresh token 全部作废（revoke_all_user_tokens）
- masterKey 不变，RSA 私钥不变，所有条目不变
- 新 token family 已创建

---

## 路径 4：已登录改密

```
用户                        Web 客户端                        FastAPI 服务端              PostgreSQL
───                        ─────────                        ──────────────              ──────────
① 进入设置 → 改密页面
② 输入当前密码 + 新密码
                            ③ 当前密码 → PBKDF2(salt) → currentDerivedKey
                               → decrypt(passwordWrapped) → masterKey ✅（确认当前密码正确）
                            ④ 新密码 → PBKDF2(newSalt) → newDerivedKey + newHash
                               newPasswordWrapped = AES-GCM(masterKey, newDerivedKey)
                            ⑤ POST /auth/reset-password (需验证码)
                               ========================
                               实际应走：POST /auth/change-password (需当前密码)
                               ========================
```

```
注意：当前实现中，改密走的是 reset-password 端点（需要邮箱验证码）。
这种做法不好——用户已登录，验证当前密码比发邮件更快更合理。
Phase 3 重构时应改为：
  POST /auth/change-password
  鉴权: Bearer token
  body: {current_password_hash, new_password_hash, new_password_salt, new_password_wrapped}
  服务端验证 current_password_hash → 更新 → revoke all tokens → 新 token
```

---

## 路径 5：注销账号

```
用户                        Web 客户端                        FastAPI 服务端              PostgreSQL
───                        ─────────                        ──────────────              ──────────
① 设置 → 注销账号
② 两次确认
                            ③ DELETE /auth/account  (Bearer token)
                                                                                           ④ DELETE user WHERE id=?
                                                                                              (CASCADE → user_keys, user_devices,
                                                                                               items, token_families)
⑤ 收到 204
⑥ clearSession → 清空 IndexedDB
⑦ lock() → 清空内存密钥
⑧ navigate("/login")
```

### 前置条件
- 用户已登录（Bearer token 有效）
- 两次确认（第一次输入"确认"，第二次 confirm dialog）

### 后置条件
- 服务端：该用户所有数据删除（CASCADE）
- 客户端：IndexedDB 清空，内存密钥清空
- 此时用旧邮箱无法登录（用户不存在），需重新注册

---

## 路径 6：同步 Push/Pull

```
┌─── 用户创建/编辑/删除条目 ──────────────────────────┐
│                                                      │
│  ① VaultContext 更新本地 IndexedDB                   │
│  ② 标记 is_dirty = True（等待同步）                  │
│                                                      │
│  ③ 前台/定时触发 sync()                              │
│     ┌──────────────────┐                             │
│     │ PUSH 本地改动     │── POST /sync/push          │
│     │ 到服务端         │    {items: [{...}]}         │
│     └──────────────────┘                     │       │
│                                              │       │
│     ┌──────────────────┐                     ▼       │
│     │ PULL 服务端改动   │  ← POST /sync/push返回     │
│     │ 到本地           │    含 merged items          │
│     └──────────────────┘                             │
│  ④ 更新 IndexedDB   已同步标志                       │
│  ⑤ 更新 UI                                           │
└──────────────────────────────────────────────────────┘
```

---

## 数据流不变式

1. **密码 hash 永远不在网络上明文传输**。客户端 PBKDF2 后上送 hash。
2. **masterKey 永不离开内存**。不上传、不写 IndexedDB、不序列化。
3. **所有写入数据库前的数据都经过加密或哈希**。
4. **失败路径不会留下半完成的状态**（注册失败不会创建用户，登录失败不会创建 token）。
5. **限流检查在认证之前**。IP 和邮箱限流都发生在查询数据库之前。
