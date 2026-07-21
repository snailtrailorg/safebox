# SafeBox

端到端加密密码管理器。Android + Web 客户端，FastAPI 后端，零知识架构（SRP-6a 认证）。

## 架构

```
客户端 (Android / Web)
  ├─ 所有加解密在本地完成
  ├─ SRP-6a 登录（客户端算 A/M1，服务端只验，零知识）
  ├─ AES-256-GCM + 字段级 AAD（v2 条目加密）
  ├─ User Key + Item Key 密钥层次（换密码不解密条目）
  └─ 助记词本地持有 + 加密缓存，不上传

服务端 (FastAPI + PostgreSQL + Redis)
  ├─ 用户认证 (SRP-6a challenge/verify；Google OAuth)
  ├─ 条目同步 (pull / push / delete)
  ├─ 只存 SRP verifier（不存密码/助记词明文）
  └─ 验证码 (Twilio 短信 / SMTP 邮件)
```

## 技术栈

| 层 | 技术 |
|---|---|
| Android | Kotlin, Jetpack Compose, Room, Hilt, Retrofit |
| Web | React 19, TypeScript, Vite 6, Web Crypto API, IndexedDB (idb), react-router-dom, i18next |
| 后端 | Python FastAPI, SQLAlchemy (async), Alembic, PyJWT, PostgreSQL, Redis |
| 部署 | Nginx 反代, Gunicorn + Uvicorn, Systemd, Amazon Linux 2023 |

> SRP-6a 自实现（`server/app/services/srp_service.py` + `web/src/crypto/srp.ts`），无外部 SRP 库。

## 项目结构

```
safebox/
├── app/                    # Android 客户端
│   └── src/main/java/org/snailtrail/safebox/
│       ├── data/           # Room, Retrofit, Repository
│       ├── domain/         # CryptoManager, KeyManager, SessionManager
│       └── ui/             # Compose 页面 (auth/vault/settings)
├── server/                 # FastAPI 后端
│   ├── app/
│   │   ├── api/            # 路由 (auth, sync)
│   │   ├── models/         # SQLAlchemy ORM (user, user_keys, token_families, devices, items)
│   │   ├── schemas/        # Pydantic 请求/响应
│   │   ├── services/       # 业务逻辑 (srp, auth, token, verification, bip39, email, sms)
│   │   ├── middleware/      # JWT 中间件 (token type 校验)
│   │   └── i18n/           # 国际化 (en/zh)
│   ├── migrations/         # Alembic
│   └── tests/              # 39 tests (+1 skipped 需真 Redis)
├── web/                    # React Web 客户端
│   └── src/
│       ├── components/     # 通用组件 (layout, ui)
│       ├── crypto/         # srp (BigInt+WebCrypto), PBKDF2, AES-GCM, BIP39, KDF
│       ├── keychain/       # keyChain 全局单例（User Key + Item Key + SRP verifier 管理）
│       ├── services/       # API, Sync
│       ├── hooks/          # useAutoLock
│       ├── db/             # IndexedDB (idb)
│       ├── pages/          # auth, vault, settings
│       ├── routes/         # 路由配置 + AuthGuard
│       ├── config/         # 常量、条目类型
│       ├── i18n/           # 国际化 (en/zh)
│       ├── types/          # TypeScript 类型定义 (api, domain)
│       ├── utils/          # 工具函数 (base64, password, backup, format)
│       └── __tests__/      # 84 tests
├── docs/                   # 架构文档（ARCHITECTURE / API_CONTRACT / RECOVERY_MECHANISM / FEATURE_LIST 等）
├── DEPLOY.md               # 生产部署指南
└── CLAUDE.md               # 项目约定
```

## 快速开始

### 后端

```bash
cd server
cp .env.example .env        # 编辑数据库/JWT 配置
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. venv/bin/alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Web 客户端

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npx vitest run     # 84 tests
```

### Android

用 Android Studio 打开项目根目录，sync Gradle，运行。

## 安全模型

### 核心原则：服务端零知识

**包括服务器管理员在内，任何人都无法获取你的密码和条目明文。所有加解密在客户端本地完成，登录走 SRP-6a（服务端只存 verifier，登录过程不泄露密码），密码和明文从来不离开你的设备。**

### 密钥层次（SRP + 合并主密码模型）

```
助记词[BIP39 12 词] + 主密码
   │
   ├── 2SKD: x = PBKDF2(主密码) XOR HKDF(助记词)  ->  verifier v = g^x mod N（存服务器，SRP 认证）
   │
   └──PBKDF2(SHA-256, 600k, mnemonic_salt)──> K（派生主密钥，永久不变，不存服务器）
                                                  │
                                                  └──AES-GCM──> encrypted_user_key（存服务器）
                                                                       │
                                                                       └── User Key（随机 AES-256）
                                                                              │
                                                                     Item Key（每条目独立）
                                                                              │
                                                                  AES-256-GCM + 字段级 AAD
                                                                              │
                                                                        条目明文

主密码（与助记词一起派生 K + x，可改，需助记词+邮箱）
   └── PBKDF2(local_salt) -> localDerivedKey -> 本地缓存：
        ├── cached_K = AES(localDerivedKey, K)
        └── mnemonic_encrypted = AES(localDerivedKey, 助记词)   # 同设备登录算 SRP x 用
```

**核心**：K 由助记词 + 主密码派生，`encrypted_user_key = AES(K, UserKey)` 存服务器。SRP 的 x 由主密码 + 助记词（2SKD）派生，verifier 存服务器。改主密码 = K 变 + verifier 变（需助记词重派生）。忘主密码 = 数据丢失（主密码参与 K + x 派生，无法恢复）。

### 服务端存储了什么

服务端数据库中 **所有敏感数据均为密文或 verifier**：

| 字段 | 实际内容 | 谁能解密 |
|------|---------|---------|
| `srp_verifier` | hex(v=g^x mod N)，2SKD x 派生 | 仅用于 SRP 认证（不可反推密码） |
| `encrypted_user_key` | AES-GCM(K, User Key)（K 不在服务器） | 拥有 K（即助记词+主密码）的人 |
| `items.name` / `description` / `data` | EncryptedField `{encrypted_key, ciphertext}`，AES-GCM(Item Key, AAD) | 拥有 User Key 的人 |

> 助记词不上传服务端（废除 mnemonics 表），客户端本地持有 + 加密缓存。

### 攻击场景分析

**场景一：服务器被入侵，数据库泄露**

攻击者拿到 verifier + 所有密文，但没有用户的密码或助记词。verifier 泄露无法重放登录（SRP 协议）；无法解密 User Key -> 无法解密 Item Key -> 无法解密任何条目。2SKD 双秘密（主密码+助记词）缺一不可。

**场景二：管理员/内部人员作恶**

同上。管理员有数据库完整访问权限，能看到 verifier 和加密字段，但密码和助记词从来不出客户端，管理员没有任何途径获得它们。

**场景三：用户忘记主密码**

数据永久丢失。主密码参与 K + x 派生，仅有助记词无法解密 `encrypted_user_key`。服务端没有任何后门或重置机制能绕过加密。这不是 bug，是设计目标。

**场景四：用户忘记主密码且丢失助记词**

数据永久丢失。同场景三，且连换设备流程（需助记词+主密码）也无法走。

### 用户必须知道的事

1. **主密码不要忘记。** 主密码不出设备且参与密钥派生，忘主密码 = 数据永久丢失（助记词无法单独解密，没有"找回密码"功能）。
2. **助记词必须妥善保存。** 注册时生成的 12 个英文词，换设备时与主密码一起派生 K 解密数据。建议打印在纸上，存放在安全的地方。
3. **换设备需助记词 + 主密码。** 手机丢失后在新设备解密数据，需助记词 + 主密码一起派生 K，两者缺一不可。

详见 `docs/`。

## 设备 deauthorize + SRP K 通信（Phase 2）
- **device_id 绑 token** + Redis `device:revoked`（access 立即失效，解决 30min 重用）+ `GET/DELETE /auth/devices`
- **SRP K 通信加密**（对标 1Password SRP+GCM）：登录后认证 API body + 响应用 SRP 握手派生的 K（AES-256-GCM）加密，TLS 之上第二层，防路径泄密（Nginx/反代/中间人）

## 部署

详见 `DEPLOY.md`。

## License

MIT
