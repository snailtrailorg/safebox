# 密码管理器安全架构调研参考

> 日期：2026-07-06
> 目的：为 SafeBox 架构重构提供外部参考锚点
> 对标产品：1Password, Bitwarden, Proton Pass

---

## 一、1Password — Two-Secret Key Derivation (2SKD)

### 1.1 核心设计理念

1Password 的最核心差异化设计是 **Secret Key**。注册时客户端生成一个 128-bit 随机 key，与密码一起参与派生，Server 端永远不存它的明文甚至加密密文。

### 1.2 Key Hierarchy

```
Account Password (用户记住)          Secret Key (设备端生成，80 bit 熵)
         │                                   │
         └──────────────┬────────────────────┘
                        │ PBKDF2-HMAC-SHA256 (650,000 次)
                        ▼
               ┌────────────┐
               │  2SKD Mix  │ ← Secret Key 与 PBKDF2 输出 XOR
               └──────┬─────┘
                  ┌───┴───┐
                  ▼       ▼
          Account Unlock   SRP-x
          Key (AUK)       (认证用)
              │
              ▼
        解密 User's Key Set
              │
         ┌────┴────┐
         ▼         ▼
    RSA Key Pair    Vault Keys
    (共享用)       (加密条目用)
```

### 1.3 认证方式

| 机制 | 说明 |
|------|------|
| 密码验证 | **不在服务端做密码比对**。服务端存 SRP verifier，客户端用 SRP（Zero-Knowledge Proof）证明知道密码和 Secret Key，服务端只验证 proof |
| 服务器零知识 | 服务器不知道密码、不知道 Secret Key |
| 服务端被攻破 | 拿不到 Secret Key（不存在服务端），无法离线暴力破解 |

### 1.4 恢复机制

- **Emergency Kit PDF**: 注册时生成，包含 Secret Key 和 Setup Code
- **Recovery Code (2024+)** : 256-bit random，派生 3 个 subkey（auth/enc/uuid），使用时需 SRP + 邮箱验证双重验证
- **Family/Team Recovery**: RSA 非对称加密 + recovery group

### 1.5 限流

- 服务端限流（速率限制各 endpoint）
- SRP 本身提供保护——服务端不能验证密码猜测
- Secret Key 缺乏时无法离线破解

---

## 二、Bitwarden — 三层 Key Wrapping

### 2.1 Key Hierarchy

```
Master Password + Email Salt
         │
         ▼ KDF (PBKDF2 600K+ iters / Argon2id 64MB)
    Master Key (客户端内存，不上传)
         │
    ┌────┴────┐
    ▼         ▼
Master Password    直接加密 User Key
Hash               (AES-256-CBC or XChaCha20-Poly1305)
(发给服务端认证)        │
                      ▼
                 User Key (随机 64 bytes, 对称密钥)
                      │
                 ┌────┴────┐
                 ▼         ▼
           加密 RSA 私钥     加密 Vault Data
           (User Key 加密)   (条目/文件夹内容)
```

### 2.2 关键设计差异

| 特性 | Bitwarden | 1Password |
|------|-----------|-----------|
| Secret Key | ❌ 无 | ❌ 有，本地生成 |
| 密码验证方式 | PBKDF2-hash 比对（服务端存 hash） | SRP zero-knowledge |
| 换密码 | 重新用新 Master Key 加密 User Key | 重新用新 AUK 加密 Key Set |
| Key rotation | 只需要换 User Key（条目级加密支持独立 key） | 需要换 Key Set |
| 服务端被攻破 | 攻击者可离线暴力破解 Master Password（有 hash + 有 encrypted User Key）| 无 Secret Key 无法破解 |

### 2.3 恢复机制

- **Trusted Device**: 设备间用 RSA key exchange
- **Account Recovery** (Family/Teams): 管理员重新加密 User Key
- 不支持"纯恢复码直接解密"

### 2.4 限流

- 服务端 Nginx/IP 级限流
- Captcha（reCAPTCHA）对于登录失败频发
- 无邮箱粒度的指数退避（应用层）

---

## 三、Proton Pass

### 3.1 Key Hierarchy

```
Proton Account 密码
         │
         ▼ KDF (same as Proton Mail — Argon2)
   Mailbox Password (独立派生)
         │
         └── 加密 User Key (类似 Bitwarden)
                  │
                  ▼
            Vault Keys (每 vault 一个独立 key)
                  │
                  ▼
           加密每个条目
```

### 3.2 特色

- Vault 隔离：每个 vault 有独立 key，一个 vault 被攻破不影响其他 vault
- **Two-Password Mode**：主密码（认证）+ 邮箱密码（解密）
- 没有 Secret Key，与 Bitwarden 类似的安全等级

---

## 四、横向对比

### 4.1 Key Hierarchy 对比

| 层级 | SafeBox 当前 | 1Password | Bitwarden | 业界推荐 |
|------|-------------|-----------|-----------|---------|
| 根密钥 | masterKey（随机生成） | AUK（密码+SecretKey 派生） | Master Key（密码派生） | 密码派生或随机皆可 |
| 第二层 | passwordDerivedKey | User Key Set | User Key（随机） | 随机 User Key |
| 条目级加密 | RSA-4096 公钥（非对称） | Vault Key（对称） | 对称（User Key/Item Key） | **对称 key wrapping** |
| 密码验证 | PBKDF2 hash 比对 bcrypt | SRP zero-knowledge | KDF hash 比对 | 均可，SRP 更安全 |
| Secret Key | ❌ 无 | ✅ 有（128 bit, 设备端生成） | ❌ 无 | 可选，大幅增强安全性 |
| 恢复码 | BIP39（直接解密） | Recovery Code + 邮箱验证 | Trusted Device Only | 双重验证更好 |

### 4.2 恢复流程对比

| 特性 | SafeBox 当前 | 1Password | Bitwarden |
|------|-------------|-----------|-----------|
| 恢复码格式 | BIP39 24 词 | 256-bit random | 无 |
| 恢复码能直接解密 | ✅ 是 | ❌ 需 + 邮箱验证 | N/A |
| 邮箱重置密码 | ✅ 需要验证码 | ❌ 不支持 | ✅ 需要验证码 |
| 服务端参与解密 | 否（纯客户端） | 是（SRP + 邮箱验证） | 是（服务端有新设备密钥） |

### 4.3 限流策略对比

| 维度 | SafeBox 当前 | 1Password | Bitwarden |
|------|-------------|-----------|-----------|
| 邮箱粒度退避 | ✅ (1→2→4→8→3600s) | 服务端限流 | 服务端限流 + captcha |
| IP 滑动窗口 | ✅ (500/hr) | 服务端限流 | 未知 |
| 验证码发送限流 | ✅ 60s/目标 | 未知 | 未知 |
| 反暴力破解 | L1 邮箱 + L2 IP | SRP + Secret Key 缺乏无法破解 | captcha |

---

## 五、对 SafeBox 架构重构的启示

### 5.1 可以直接复用的最佳实践

| 实践 | 来源 | SafeBox 当前状态 |
|------|------|----------------|
| Key hierarchy 有三层（根密钥→用户密钥→数据密钥） | 全部 | 有 masterKey → passwordWrapped，但缺少 User Key 层 |
| 换密码只需重新 wrap 上层 key，不解密全部数据 | Bitwarden | ✅ 已经是这样 |
| KDF 的可配置性（PBKDF2 iter / Argon2 参数） | Bitwarden | ❌ PBKDF2 100K 次写死 |
| Vault level 独立加密 | Proton Pass | ❌ 所有条目用同一个 masterKey |
| 非对称加密仅用于共享/跨设备 key exchange | 全部 | ❌ 条目级加密用了 RSA 而不是对称 key |

### 5.2 不需要改变的 SafeBox 设计

| 设计 | 理由 |
|------|------|
| 邮箱 + 手机 + Google OAuth 三种注册方式 | 业界标准 |
| JWT access + refresh token | 业界标准 |
| Token family rotation | ✅ 比多数产品强（多数产品不做 refresh token rotation） |
| 指数退避限流 | ✅ 比只做服务端限流更细粒度 |
| BIP39 恢复码 | 用户友好，虽然缺少双重验证但可接受 |

### 5.3 建议优先改进的差异

| 差异 | 优先级 | 理由 |
|------|--------|------|
| 条目级加密改为对称 key | **高** | RSA 加密长数据需分块，性能差，增加复杂度 |
| User Key 层（随机对称 key 替代 RSA 作为 vault 加密密钥）| **高** | 解耦密码变更和数据重新加密，条目共享/导出更容易 |
| PBKDF2 参数可配置 | **中** | 未来可以跟随 OWASP 建议升级 |
| 恢复码 + 邮箱验证双重保护 | **低** | 当前 BIP39 直接解密已可用，安全等级足够 |

---

## 六、信息来源

- [1Password Security Design White Paper](https://agilebits.github.io/security-design/)
- [1Password Account Password and Secret Key (Section 3)](https://agilebits.github.io/security-design/apsk.html)
- [1Password Modern Authentication (Section 4)](https://agilebits.github.io/security-design/modernauth.html)
- [1Password A Deeper Look at Keys (Section 8)](https://agilebits.github.io/security-design/deepKeys.html)
- [1Password Recovery Code Security](https://support.1password.com/recovery-code-security/)
- [Bitwarden Inside Zero-Knowledge Encryption](https://bitwarden.com/blog/end-to-end-encryption-and-zero-knowledge/)
- [Bitwarden KDF Algorithms](https://bitwarden.com/help/kdf-algorithms/)
- [Bitwarden Encryption Deep Dive](https://bitwarden.com/help/what-encryption-is-used/)
- [Bitwarden SDK Internal: Key Management System](https://deepwiki.com/bitwarden/sdk-internal/3.1-key-management-system)
- [Bitwarden Passkeys for Decryption](https://contributing.bitwarden.com/architecture/deep-dives/passkeys/implementations/relying-party/prf/)
- [Proton Pass End-to-End Encryption](https://proton.me/blog/password-encryption)
- [Proton Pass Vault Isolation](https://proton.me/support/pass-vault)
