# SafeBox

端到端加密密码管理器。Android + Web 客户端，FastAPI 后端，零知识架构。

## 架构

```
客户端 (Android / Web)
  ├─ 所有加解密在本地完成
  ├─ AES-256-GCM + 字段级 AAD（v2 条目加密）
  ├─ User Key + Item Key 密钥层次（换密码不解密条目）
  └─ 服务端只存密文，永不知道密码和明文

服务端 (FastAPI + PostgreSQL + Redis)
  ├─ 用户认证 (Email / 手机号 / Google OAuth)
  ├─ 条目同步 (pull / push / delete)
  ├─ 恢复码 (BIP39 12 词 + HMAC-SHA256 + 24h 冷却期)
  └─ 验证码 (Twilio 短信 / SMTP 邮件)
```

## 技术栈

| 层 | 技术 |
|---|---|
| Android | Kotlin, Jetpack Compose, Room, Hilt, Retrofit |
| Web | React 19, TypeScript, Vite 6, Web Crypto API, IndexedDB (idb), react-router-dom, i18next |
| 后端 | Python FastAPI, SQLAlchemy (async), Alembic, PyJWT, bcrypt, PostgreSQL, Redis |
| 部署 | Nginx 反代, Gunicorn + Uvicorn, Systemd, Amazon Linux 2023 |

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
│   │   ├── api/            # 路由 (auth, recovery, sync)
│   │   ├── models/         # SQLAlchemy ORM (user, recovery_code)
│   │   ├── schemas/        # Pydantic 请求/响应
│   │   ├── services/       # 业务逻辑 (auth, token, recovery, bip39, email, sms, verification)
│   │   ├── middleware/      # JWT 中间件 (token type 校验)
│   │   └── i18n/           # 国际化 (en/zh)
│   ├── migrations/         # Alembic
│   └── tests/              # 40 tests
├── web/                    # React Web 客户端
│   └── src/
│       ├── components/     # 通用组件 (layout, ui)
│       ├── crypto/         # PBKDF2, AES-GCM, BIP39, KDF（rsa.ts 保留无引用）
│       ├── keychain/       # keyChain 全局单例（User Key + Item Key 管理）
│       ├── services/       # API, Sync
│       ├── hooks/          # useAutoLock
│       ├── db/             # IndexedDB (idb)
│       ├── pages/          # auth, vault, settings
│       ├── routes/         # 路由配置 + AuthGuard
│       ├── config/         # 常量、条目类型
│       ├── i18n/           # 国际化 (en/zh)
│       ├── types/          # TypeScript 类型定义 (api, domain)
│       ├── utils/          # 工具函数 (base64, password, backup, format)
│       └── __tests__/      # 111 tests
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
npx vitest run     # 111 tests
```

### Android

用 Android Studio 打开项目根目录，sync Gradle，运行。

## 安全模型

### 核心原则：服务端零知识

**包括服务器管理员在内，任何人都无法获取你的密码和条目明文。所有加解密在客户端本地完成，密码和明文从来不离开你的设备。**

### 密钥层次（模型 D 串行化）

```
恢复码[BIP39 12 词] [+ 主密码]
   │
   └──PBKDF2(SHA-256, 600k, recovery_salt)──> K（派生主密钥，永久不变，不存服务器）
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

登录密码（独立于 K，可改）
   ├── PBKDF2(login_salt)        → loginDerivedKey → 本地 cached_K = AES(loginDerivedKey, K)
   └── PBKDF2(login_salt+"auth") → auth_key_hash  → 服务端认证（bcrypt 二次哈希）
```

**模型 D 核心**：K 由恢复码派生（非登录密码），`encrypted_user_key = AES(K, UserKey)` 存服务器，`cached_K = AES(loginDerivedKey, K)` 存本地。换登录密码只重包 `cached_K`，K/User Key 不变，条目无需重加密。登录密码丢失不影响数据，只要恢复码在即可解 `encrypted_user_key`。

### 服务端存储了什么

服务端数据库中 **所有敏感数据均为密文**：

| 字段 | 实际内容 | 谁能解密 |
|------|---------|---------|
| `auth_key_hash` | bcrypt(PBKDF2(登录密码, login_salt+"auth")) | 仅用于认证比对 |
| `encrypted_user_key` | AES-GCM(K, User Key)（K 不在服务器） | 拥有 K（即恢复码[+主密码]）的人 |
| `items.name` / `description` / `data` | EncryptedField `{encrypted_key, ciphertext}`，AES-GCM(Item Key, AAD) | 拥有 User Key 的人 |
| `recovery_code_hash` | HMAC-SHA256(server_key, salt+mnemonic) | 仅用于验证比对 |

### 攻击场景分析

**场景一：服务器被入侵，数据库泄露**

攻击者拿到所有密文，但没有用户的密码或恢复码，无法解密 User Key → 无法解密 Item Key → 无法解密任何条目。且 bcrypt 哈希不可逆，无法从 auth_key_hash 反推密码。

**场景二：管理员/内部人员作恶**

同上。管理员有数据库完整访问权限，能看到所有加密字段，但密码和密钥从来不出客户端，管理员没有任何途径获得它们。

**场景三：用户忘记密码**

用 12 词 BIP39 恢复码找回。恢复码在注册时由客户端生成并展示一次，服务端 HMAC-SHA256 验证，24 小时冷却期防暴力破解。恢复码是唯一的恢复途径——没有恢复码且忘记密码，数据永久无法恢复。这不是 bug，是设计目标。

**场景四：用户忘记密码且丢失恢复码**

数据永久丢失。服务端没有任何后门或重置机制能绕过加密。管理员也无法帮忙恢复。

### 用户必须知道的事

1. **密码不要忘记。** 密码不出设备，没有"找回密码"功能，只有"重置密码"（需要恢复码）。
2. **恢复码必须妥善保存。** 注册时生成的 12 个英文单词，是丢失密码后唯一的救命稻草。建议打印在纸上，存放在安全的地方。
3. **不要只存在一台设备上。** 手机丢失 + 忘记密码 + 丢失恢复码 = 数据永久消失。

详见 `docs/`。

## 部署

详见 `DEPLOY.md`。

## License

MIT