# SafeBox 数据流 v2（目标设计）

> 版本: v2.7
> v2.6 → v2.7 变更:
>   - 同步冲突改为用户选择：保留本地版本或使用服务端版本（不再静默丢弃）
>   - HMAC 计算引入服务端密钥（详见 RECOVERY_MECHANISM.md）
>
> v2.5 → v2.6 变更:
>   - 恢复码路径改为"一次性完成所有操作"：initiate 时同时提交新密码，进入 pending_activation
>   - 新增加速通道（accelerate）：验证码跳过剩余冷却
>   - 冻结（freeze）操作：直接丢弃 pending_*，旧数据天然可用，零恢复成本
>   - 移除 recovery-cancel 和 recovery-complete 端点（语义合并入 freeze 和自动激活）
>   - 冷却期改为 24 小时

---

## 路径 1：Email 注册（v2.5）

```
用户                              Web 客户端                        FastAPI 服务端            Redis           PostgreSQL
───                              ─────────                        ──────────────            ─────           ──────────
① 填写邮箱 + 密码
② 点击"获取验证码"
                                 ③ POST /auth/send-code
                                   [中间件] check_rate_key（IP/user 滑动窗口）
                                                                   ④ check_rate_limit（60s/目标）
                                                                   ⑤ send_verification_email()
⑦ 收到验证码
⑧ 输入验证码
                                 ⑨ 生成全部密钥:
                                    password_salt = generateSalt()
                                    kdf_settings = {algorithm, iterations}
                                    User Key = generateAesKey()
                                    passwordDerivedKey = KDF(password, password_salt, kdf_settings)
                                    authKey = KDF(password, password_salt + "auth")
                                    RSA key pair = generateRsaKeyPair()
                                    passwordWrapped = AES-GCM(User Key, passwordDerivedKey)
                                    encryptedPrivateKey = AES-GCM(User Key, rsaPrivateKey)
                                    idempotency_key = crypto.randomUUID()

                                 ⑩ POST /auth/register/email
                                    {email, verification_code,
                                     auth_key_hash, kdf_settings, password_salt,
                                     password_wrapped,
                                     encrypted_private, rsa_public_key,
                                     idempotency_key}
                                                                   ⑪ verify_and_consume(email)
                                                                   ⑫ find_user_by_email()
                                                                   ⑬ 检查 idempotency_key
                                                                   ⑭ hash_auth_key() [bcrypt]
                                                                   ⑮ INSERT user + user_keys + user_device
                                                                   ⑯ create tokens
⑰ 收到响应 → saveSession + login()
⑱ 提示用户后续可在安全设置页生成恢复码
```

注意：注册时不再生成恢复码。恢复码由用户在安全设置页（已登录）主动生成。详情见 RECOVERY_MECHANISM.md。

---

## 路径 2：Email 登录（v2.3）

（与 v2.2 相同，无变化）

---

## 路径 3：恢复码重置密码（v2.5 — 服务端 HMAC 验证 + 冷却期 + 冻结）

**前置说明**：恢复码路径与 v1 完全不同。恢复码不再用于客户端密钥派生（不再有 recoveryKeyMaterial/recoveryEncKey/recoveryWrapped）。恢复码仅作为服务端凭据验证，验证通过后进入冷却期，冷却期满后用户设新密码。

完整机制见 `RECOVERY_MECHANISM.md`。以下简述核心流程：

```
用户                          API                               MySQL                          Email/SMS
────                          ───                               ─────                          ────────

阶段 2：发起恢复
① 输入恢复码 + 设置新密码（一次性完成）
                             ② POST /auth/recovery/initiate
                                {recovery_code,
                                 pending_new_auth_key_hash,
                                 pending_password_salt,
                                 pending_kdf_settings,
                                 pending_password_wrapped}
                                                              ③ HMAC-SHA256(server_key, salt + mnemonic) 比对
                                                                 status → pending_activation
                                                                 monthly_initiation_count +1
                                                                 pending_setup_at = now()
                                                                 cooldown_expires_at = now()+24h
                                                                 注意：users.password_hash 不变！
                                                              ④ return cooldown_expires_at
                             ⑤ 前端显示 24h 倒计时
                                                              ⑥ 多渠道告警（含两个链接）
                                                                 链接 A: /accelerate（需验证码）
                                                                 链接 B: /freeze（无需验证码）

阶段 3-4：三个分支
                             ⑦ 分支 A（加速通道）
                                GET /auth/recovery/accelerate
                                {signed_token}
                                → 输入验证码
                                → 验证码正确
                                → pending_*→users/user_keys
                                → consumed

                             ⑧ 分支 B（冻结）
                                POST /auth/recovery/freeze
                                {signed_token}
                                → 丢弃 pending_*
                                → 状态回退 active
                                → 旧密码不变（从未被覆盖）

                             ⑨ 分支 C（自动激活）
                                cooldown_expires_at 到期
                                → pending_*→users/user_keys
                                → consumed
```

---

## 路径 4：已登录改密（v2.3 — 增加验证码保护）

```
POST /auth/change-password
Authorization: Bearer <access_token>
Body: {target: "email" | "phone", value: "user@example.com",
       verification_code: "123456",           ← 新增！需要验证码
       current_auth_key_hash,
       new_auth_key_hash, new_password_salt,
       new_kdf_settings, new_password_wrapped}

服务端:
  ① verify(user.auth_hash, current_auth_key_hash)  ← 当前密码在前（错误则拒绝，不消费验证码）
  ② verify_and_consume(target, value, code)        ← 验证码在后
  ③ 发送告警邮件/短信："您的密码已被修改"
  ④ UPDATE user + user_keys
  ⑤ revoke_all_tokens + create new
  ⑥ return {access_token, refresh_token}
```

---

## 路径 5：条目创建/编辑（v2.3 — Item Key）

```
用户                         Web 客户端
───                         ─────────
① 打开新条目表单
② 填写 name, data
                             ③ 生成 Item Key: generateAesKey()          ← 每条目一个
                                encryptedItemKey = AES-GCM(User Key, Item Key)
                                每个字段:
                                ciphertext = AES-256-GCM(plaintext, Item Key, AAD=fieldName)

                             ④ 加密后的结构:
                                {type, icon?,
                                 name: {encrypted_key, ciphertext},
                                 data: {encrypted_key, ciphertext}, ...}

                             ⑤ IndexedDB.put(isDirty = true)
                             ⑥ sync() → POST /sync/push
```

### 同步冲突处理（v2.6）

```
sync() → push dirty items
  │
  ├─ result.status === "conflict"
  │   → 收集本地冲突信息（localDid, serverId, localUpdatedAt）
  │   → 不调 markSynced，本地条目保持 dirty
  │
  └─ pull server changes
      ├─ 服务端版本属于冲突条目？
      │   → 不自动 upsert，加入 conflicts[]
      │   → 返回给 VaultContext 显示冲突 UI
      │
      └─ 用户选择：
          ├─ 保留本地 → markForRepush(localDid, serverVersion)：基线设为服务端当前 version + 保持 dirty，下次 push 基线匹配被接受（乐观并发，不依赖时钟）
          └─ 使用服务端 → upsertFromServer([ConflictInfo.serverItem])：按 serverId 原地更新为服务端版本（不删除条目）
```

### 解密流程

```typescript
async function decryptField(
  field: EncryptedField,
  userKey: CryptoKey,
  fieldName: string,
  itemType: string,
): Promise<string | null> {
  const itemKeyRaw = await aesDecrypt(userKey, field.encrypted_key);
  if (!itemKeyRaw) return null;
  const itemKey = await crypto.subtle.importKey("raw", itemKeyRaw, "AES-GCM", false, ["decrypt"]);
  const plaintext = await aesDecryptField(itemKey, field.ciphertext, fieldName, itemType);
  return plaintext ? new TextDecoder().decode(plaintext) : null;
}
```

---

## 路径 6：注销账号（v2.3 — 增加验证码保护）

```
DELETE /auth/account
Authorization: Bearer <access_token>
Body: {target: "email", value: "user@example.com",
       verification_code: "123456"}

服务端:
  ① verify_and_consume(target, value, code)
  ② DELETE user ... CASCADE
  ③ 发送告警邮件/短信
```

---

## 数据流不变式（v2.4）

1. **认证和加密分离** — Auth Key（PBKDF2(salt+"auth")）用于登录，User Key 用于加密。
2. **换密码不重新加密条目数据** — 只重新 wrap User Key。
3. **Item Key 独立于 User Key** — 条目共享时只需重新 wrap Item Key。
4. **敏感操作必须邮箱/手机验证码** — 改密、注销账号均需验证码。
5. **恢复码路径禁用验证码** — 恢复码本身验证不要求验证码（防死锁），验证码仅用于加速通道。
6. **恢复码冷却期 24 小时 + 一次性完成** — 用户提交时一并设好新密码，冷却期满自动激活。冻结操作不修改旧密码数据，天然可回滚。

