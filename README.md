# SafeBox

端到端加密密码管理器。Android + Web 客户端，FastAPI 后端，零知识架构。

**部署地址**: [safebox.snailtrail.org](https://safebox.snailtrail.org)

## 架构

```
客户端 (Android / Web)
  ├─ 所有加解密在本地完成
  ├─ AES-256-GCM + RSA-4096-OAEP + PBKDF2(100k)
  └─ 服务端只存密文，永不知道密码和明文

服务端 (FastAPI + PostgreSQL + Redis)
  ├─ 用户认证 (Email / 手机号 / Google OAuth)
  ├─ 条目同步 (pull / push / delete)
  └─ 验证码 (Twilio 短信 / SMTP 邮件)
```

## 技术栈

| 层 | 技术 |
|---|---|
| Android | Kotlin, Jetpack Compose, Room, Hilt, Retrofit |
| Web | React 19, TypeScript, Vite 6, Web Crypto API, IndexedDB |
| 后端 | Python FastAPI, SQLAlchemy (async), Alembic, PostgreSQL, Redis |
| 部署 | Apache 反代, Gunicorn + Uvicorn, Systemd, Amazon Linux 2023 |

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
│   │   ├── models/         # SQLAlchemy ORM
│   │   ├── schemas/        # Pydantic 请求/响应
│   │   └── services/       # 业务逻辑 (auth, sms, email, verification)
│   ├── migrations/         # Alembic
│   └── tests/
├── web/                    # React Web 客户端
│   └── src/
│       ├── crypto/         # PBKDF2, AES-GCM, RSA-OAEP, BIP39
│       ├── services/       # API, KeyManager, Sync
│       ├── db/             # IndexedDB (idb)
│       ├── pages/          # auth, vault, settings
│       └── __tests__/      # 84 tests
├── docs/                   # 开发文档
│   ├── requirements.md     # 需求与架构设计
│   ├── web-client-plan.md  # Web 客户端实现方案
│   └── dev-debug.md        # 本地开发调试
├── DEPLOY.md               # 生产部署指南
├── .env.example            # 环境变量模板
├── deploy.sh               # 日常部署脚本
```

## 快速开始

### 后端

```bash
cd server
cp docs/env.example .env
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Web 客户端

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm test           # 89 tests
```

### Android

用 Android Studio 打开项目根目录，sync Gradle，运行。

## 安全模型

### 核心原则：服务端零知识

**包括服务器管理员在内，任何人都无法获取你的密码和条目明文。所有加解密在客户端本地完成，密码和明文从来不离开你的设备。**

### 密钥层级

```
用户密码 ──PBKDF2(100k 迭代, SHA-256)──> 派生密钥
                                              │
                              AES-GCM 解密 password_wrapped
                                              │
                                         主密钥 (Master Key)
                                              │
                              AES-GCM 解密 encrypted_private
                                              │
                                         RSA 私钥
                                              │
                              RSA-OAEP 解密条目密文
                                              │
                                        条目明文
```

### 服务端存储了什么

服务端数据库中 **所有敏感数据均为密文**：

| 字段 | 实际内容 | 谁能解密 |
|------|---------|---------|
| `password_wrapped` | AES-256-GCM(masterKey, passwordDerivedKey) | 知道密码的人 |
| `recovery_wrapped` | AES-256-GCM(masterKey, recoveryKey) | 知道 12 词恢复码的人 |
| `encrypted_private` | AES-256-GCM(RSA 私钥, masterKey) | 拥有 masterKey 的人 |
| `items.name` | RSA-4096-OAEP 加密的密文 | 拥有 RSA 私钥的人 |
| `items.data` | RSA-4096-OAEP 加密的密文 | 拥有 RSA 私钥的人 |

### 攻击场景分析

**场景一：服务器被入侵，数据库泄露**

攻击者拿到所有密文，但没有用户的密码或恢复码，无法解密 masterKey → 无法解密 RSA 私钥 → 无法解密任何条目。密文就是密文。

**场景二：管理员/内部人员作恶**

同上。管理员有数据库完整访问权限，能看到所有加密字段，但密码和 masterKey 从来不出客户端，管理员没有任何途径获得它们。

**场景三：用户忘记密码**

用 12 词 BIP39 恢复码找回。恢复码是唯一的恢复途径——没有恢复码且忘记密码，数据永久无法恢复。这不是 bug，是设计目标。

**场景四：用户忘记密码且丢失恢复码**

数据永久丢失。服务端没有任何后门或重置机制能绕过加密。管理员也无法帮忙恢复。

### 用户必须知道的事

1. **密码不要忘记。** 密码不出设备，没有"找回密码"功能，只有"重置密码"（需要恢复码）。
2. **恢复码必须妥善保存。** 注册时生成的 12 个英文单词，是丢失密码后唯一的救命稻草。建议打印在纸上，存放在安全的地方。
3. **不要只存在一台设备上。** 手机丢失 + 忘记密码 + 丢失恢复码 = 数据永久消失。

详见 `docs/requirements.md`。

## 部署

```bash
# 仅后端
./deploy.sh michael@your-server

# 后端 + Web 客户端
./deploy.sh michael@your-server --web
```

详细部署步骤见 `DEPLOY.md`。

## License

MIT
