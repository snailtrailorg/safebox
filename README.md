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
├── docs/                   # 文档
│   ├── requirements.md     # 需求与架构设计
│   ├── deploy.md           # 生产部署指南
│   ├── dev-debug.md        # 本地开发调试
│   └── web-client-plan.md  # Web 客户端实现方案
└── deploy.sh               # 日常部署脚本
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
npm test           # 84 tests
```

### Android

用 Android Studio 打开项目根目录，sync Gradle，运行。

## 安全模型

- **客户端加密**: 所有条目在本地用 RSA-4096-OAEP 加密后再上传
- **密钥层级**: 用户密码 → PBKDF2 → 派生密钥 → 解密 Master Key → 解密 RSA 私钥 → 解密条目
- **恢复码**: 12 个 BIP39 单词，可恢复密钥（换手机/忘记密码）
- **服务端零知识**: 服务端只存 `password_wrapped`、`recovery_wrapped`、`encrypted_private`，均为密文

详见 `docs/requirements.md`。

## 部署

```bash
# 仅后端
./deploy.sh michael@your-server

# 后端 + Web 客户端
./deploy.sh michael@your-server --web
```

详细部署步骤见 `docs/deploy.md`。

## License

MIT
