# SafeBox 目录结构 v2（目标设计）

> 版本: v2.3
> v2.1 → v2.3 变更:
>   - 恢复 itemKeyManager.ts（Item Key 已恢复）
>   - 新增 kdf.worker.ts（PBKDF2 Web Worker）
>   - keychain/types.ts 新增 UserKey / AuthKey / ItemKey 类型
>   - v2.1 → v2.3 差异表更新

---

## 后端目录结构

```
server/
├── app/
│   ├── main.py                  # FastAPI 应用入口
│   ├── config.py                # 配置管理 (pydantic-settings)
│   │
│   ├── database/
│   │   ├── __init__.py
│   │   ├── session.py           # SQLAlchemy 引擎 + session factory
│   │   ├── base.py              # declarative Base + mixins
│   │   ├── migrations/
│   │   └── models/
│   │       ├── __init__.py
│   │       ├── user.py          # User + UserKeys + UserDevice + TokenFamily
│   │       └── item.py          # EncryptedItem
│   │
│   ├── api/
│   │   ├── __init__.py
│   │   ├── auth.py              # /auth/* 路由
│   │   ├── sync.py              # /sync/* 路由
│   │   └── health.py            # /health
│   │
│   ├── schemas/
│   │   ├── __init__.py
│   │   ├── auth.py              # 含 ChangePasswordRequest, DeleteAccountRequest
│   │   └── sync.py
│   │
│   ├── services/
│   │   ├── __init__.py
│   │   ├── auth_service.py      # 注册、登录、密码验证
│   │   ├── token_service.py     # JWT 生命周期 + refresh rotation
│   │   ├── recovery_service.py  # 恢复码生成、验证、冷却期、冻结（v2 重写）
│   │   └── sync_service.py      # push/pull/delete
│   │
│   ├── rate_limit/              # 限流 — 与业务逻辑完全分离
│   │   ├── __init__.py
│   │   ├── email_throttle.py    # L1: 邮箱级指数退避
│   │   ├── ip_throttle.py       # L2: IP 级滑动窗口
│   │   └── middleware.py        # FastAPI 适配器（薄层 glue code）
│   │
│   ├── recovery/               # 恢复码模块（服务端 HMAC-SHA256 + 冷却期 + 冻结，新增）
│   │   ├── __init__.py
│   │   ├── service.py           # 恢复码生成、验证、加速、冻结逻辑
│   │   └── code_generator.py    # BIP39 12 词生成
│   │
│   │   ├── __init__.py
│   │   ├── kdf.py               # PBKDF2 / Argon2id 统一接口
│   │   ├── jwt.py               # JWT 创建/验证
│   │   └── middleware.py        # JWT auth middleware
│   │
│   ├── verification/            # 验证码服务
│   │   ├── __init__.py
│   │   ├── redis_storage.py     # Redis 连接 + CRUD
│   │   ├── code_generator.py    # 生成 + 速率检查
│   │   ├── email_sender.py      # SMTP
│   │   └── sms_sender.py        # Twilio
│   │
│   └── i18n/
│       ├── __init__.py
│       └── locales/ (zh.json, en.json)
│
├── tests/
│   ├── test_auth.py
│   ├── test_rate_limit.py
│   ├── test_sync.py
│   └── conftest.py
│
├── requirements.txt
├── alembic.ini
├── Makefile
└── pyproject.toml
```

### 后端各层 import 约束

| 层 | 可以 import | 不可以 import |
|----|-----------|-------------|
| `api/` | schemas, services, rate_limit, security | database/models 直接操作 |
| `services/` | database, security, schemas | api（循环依赖） |
| `rate_limit/` | 自己的模块 only | services, api |
| `security/` | 标准库 only | services, api |
| `verification/` | 标准库 only | services |

### 后端设计备注

- `rate_limit/middleware.py` 是薄适配层（~5 行），作用是把 rate_limit 核心逻辑挂载到 FastAPI 请求链上。它 import FastAPI 的 Request 类型，但核心逻辑（email_throttle.py, ip_throttle.py）与框架无关。这属于适配器模式。
- `security/` 包名已评估为足够清晰——kdf.py（密钥派生）、jwt.py（令牌）、middleware.py（中间件）三点共同构成"认证安全基础设施"。拆分为更细的包（crypto/ + middleware/）的理由不充足（新增者可以准确判断新功能该归入哪个文件）。

---

## 前端目录结构

```
web/src/
├── main.tsx
├── App.tsx
│
├── crypto/                    # 加密原语（纯函数，无 React 依赖）
│   ├── index.ts               # 门面
│   ├── kdf.ts                 # PBKDF2 / Argon2 统一接口（可配置迭代数）
│   ├── aes.ts                 # AES-256-GCM + AAD
│   ├── rsa.ts                 # RSA-4096 OAEP-SHA256（仅共享用）
│   ├── bip39.ts               # BIP39 2048 词表（仅保留词表，恢复码不再使用）
│   │
├── keychain/                  # 密钥生命周期（纯 JS，无 React）
│   ├── keyChain.ts            # User Key 生命周期（替代 v1 keyManager.ts）
│   ├── itemKeyManager.ts      # Item Key 生成/缓存/共享（新增—恢复）
│   ├── types.ts               # UserKey, ItemKey, AuthKey 类型定义
│   └── sessionStore.ts        # IndexedDB 会话持久化
│
├── services/                  # 业务服务（有 API 依赖）
│   ├── api.ts                 # fetch + JWT + 401 refresh
│   └── syncEngine.ts          # 同步引擎
│
├── db/
│   ├── database.ts
│   └── itemsStore.ts
│
├── context/
│   ├── AuthContext.tsx
│   └── VaultContext.tsx
│
├── pages/
│   ├── auth/
│   │   ├── LoginPage.tsx
│   │   ├── RegisterPage.tsx
│   │   └── RecoveryPage.tsx
│   ├── vault/
│   │   ├── VaultListPage.tsx
│   │   ├── ItemDetailPage.tsx
│   │   └── ItemEditPage.tsx
│   └── settings/
│       ├── SettingsPage.tsx
│       └── ChangePasswordPage.tsx   # 改密独立页（新增）
│
├── components/
│   ├── layout/
│   │   ├── AuthLayout.tsx
│   │   └── AppLayout.tsx
│   └── ui/
│       ├── PasswordInput.tsx
│       ├── Toast.tsx
│       └── ItemCard.tsx
│
├── hooks/
│   ├── useAutoLock.ts
│   ├── useOnlineStatus.ts
│   └── useSync.ts
│
├── types/
│   ├── api.ts
│   ├── crypto.ts               # 密钥相关类型
│   └── domain.ts
│
├── utils/
│   ├── base64.ts
│   └── password.ts
│
└── __tests__/
    ├── crypto.test.ts
    ├── integration.test.ts
    └── cross-platform.test.ts
```

### 前端架构分层

```
┌─────────────────────────────────────────────────────────┐
│ pages/ (页面组件，依赖 context + services)               │
│   RegisterPage → keychain + api + AuthContext           │
│   VaultListPage → VaultContext + hooks/useSync          │
├─────────────────────────────────────────────────────────┤
│ context/ (React 状态管理)                                │
│   AuthContext → sessionStore + api                      │
│   VaultContext → itemsStore + syncEngine                │
├─────────────────────────────────────────────────────────┤
│ services/ + keychain/ (无 React 依赖的业务层)            │
│   keyChain.ts → crypto                                  │
│   syncEngine.ts → api + itemsStore                      │
├─────────────────────────────────────────────────────────┤
│ crypto/ (加密原语，零依赖)                                │
│   kdf.ts / aes.ts → Web Crypto API                      │
└─────────────────────────────────────────────────────────┘
```

### v2.1 → v2.3 差异

| 文件 | v2.1 | v2.3 | 原因 |
|------|------|------|------|
| web/src/keychain/itemKeyManager.ts | **不创建** | **创建（恢复）** | Item Key 已恢复 |
| web/src/crypto/recovery.ts | 创建 | **删除（废弃）** | 恢复码改为服务端 HMAC-SHA256，不再需要客户端派生 |
| web/src/crypto/kdf.worker.ts | 不存在 | **新增** | PBKDF2 迁移至 Web Worker |
