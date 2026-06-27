# SafeBox 重构方案设计

## 背景与目标

SafeBox 当前是一个纯本地 Android 密码管理器（Java + SQLite + 3DES/RSA），原始意图是做成端到端加密的跨设备互联网应用。本次重构目标：**完成从本地单机应用到端到端加密云同步密码管理器的完整升级。**

---

## 关键决策汇总

| 决策项 | 选择 | 原因 |
|--------|------|------|
| 后端语言 | Python FastAPI | 用户主技术栈，加密库生态好 |
| Web 服务器 | Apache (已有) | 反代到本地 Uvicorn，不引入新组件 |
| 部署方式 | 独立 VPS | 与现有应用隔离 |
| 数据库 | PostgreSQL | 成熟、免费、支持 JSON 字段 |
| Android 语言 | Kotlin (渐进迁移) | 协程替代 AsyncTask，空安全，代码量减 40% |
| UI 框架 | Jetpack Compose (渐进迁移) | 声明式 UI，状态驱动，Google 官方推荐 |
| 本地存储 | Room | 替代手写 SQLite，配合 Flow 做响应式查询 |
| 认证方式 | Email + 手机号 + Google OAuth | 覆盖国内外用户，所有方式均需设密码 |
| 云同步冲突 | LWW (最后写入胜出) | 密码管理器场景冲突极少，简单可靠 |
| 安全模型 | 服务端零知识 | 服务端只存密文，永远不知道密码和明文 |

---

## 认证与密钥管理架构

### 注册流程（三种入口统一）

```
用户 → 选择注册方式(email/手机/Google)
     → 验证身份(邮件验证码/短信验证码/Google OAuth)
         email: 发送邮件验证码 → 用户输入6位验证码
         手机: 发送短信验证码 → 用户输入6位验证码
         Google: Google OAuth → 验证 id_token
     → 设置密码
     → 客户端生成:
         masterKey (随机 AES-256)
         RSA-4096 密钥对
         recoveryCode (12 个 BIP39 单词)
     → PBKDF2(password, salt, 100k iters) → passwordDerivedKey
     → SHA-256(recoveryCode) → recoveryKey
     → AES-256-GCM(masterKey, passwordDerivedKey) → passwordWrappedKey
     → AES-256-GCM(masterKey, recoveryKey) → recoveryWrappedKey
     → masterKey 加密 RSA 私钥 → encryptedPrivateKey → 存云端
     → 上传: email/phone + verification_code + passwordWrappedKey + recoveryWrappedKey + encryptedPrivateKey + rsaPublicKey
     → 强制用户保存恢复码 (12 个单词)
```

注意：email 和 phone 注册均需验证码校验。Google OAuth 由服务端验证 id_token 替代验证码。

### 登录流程（三种入口）

```
Email + 密码:
  密码 → PBKDF2 → passwordDerivedKey → 解密 passwordWrappedKey → masterKey

手机号 + 密码:
  短信验证码验证身份 → 同 Email 密码流程

Google OAuth:
  Google 验证 → 服务端确认身份 → 下发 deviceWrappedKey
  → Android Keystore 解密 → masterKey

统一后:
  masterKey → 解密 encryptedPrivateKey → RSA 私钥 → 可解密所有条目
```

### 密码找回

```
手机号找回: 短信验证码验证身份 → 设新密码 → 重新生成 passwordWrappedKey
邮件找回:   邮件验证码验证身份 → 设新密码 → 重新生成 passwordWrappedKey
Google:     重新 Google OAuth → 下发 deviceWrappedKey → Keystore 解密 → 设新密码
```

### 换新手机（旧手机已丢失）

```
新手机安装 App → 选"恢复码找回"
  → 输入 12 个单词 → SHA-256 → recoveryKey
  → 解密 recoveryWrappedKey → masterKey
  → 解密 encryptedPrivateKey → RSA 私钥
  → 设新密码 → 重新生成 passwordWrappedKey
  → 新设备注册 Keystore 密钥对 → 重新生成 deviceWrappedKey
```

---

## 系统架构

### 整体分层

```
┌──────────────────────────────────────────────────┐
│ Android Client (Kotlin + Compose)                │
│ ┌──────────┐ ┌──────────┐ ┌───────────────────┐ │
│ │ UI Layer │ │ ViewModel│ │ Domain (UseCases) │ │
│ │ Compose  │ │ Layer    │ │                   │ │
│ └──────────┘ └──────────┘ └───────────────────┘ │
│ ┌──────────────────────────────────────────────┐ │
│ │ Data Layer                                   │ │
│ │ ┌─────────┐ ┌──────────┐ ┌────────────────┐ │ │
│ │ │ Room DB │ │ DataStore│ │ CryptoManager  │ │ │
│ │ └─────────┘ └──────────┘ └────────────────┘ │ │
│ │ ┌──────────────────────────────────────────┐ │ │
│ │ │ Retrofit (API Client)                    │ │ │
│ │ └──────────────────────────────────────────┘ │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────┼───────────────────────────┐
│ Web Client (React 19 + TypeScript + Vite)        │
│ ┌──────────┐ ┌──────────┐ ┌───────────────────┐ │
│ │ UI Layer │ │ Context  │ │ Services          │ │
│ │ React    │ │ Auth/Vault│ │ KeyManager/Sync   │ │
│ └──────────┘ └──────────┘ └───────────────────┘ │
│ ┌──────────────────────────────────────────────┐ │
│ │ IndexedDB (idb)  │ Web Crypto API            │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────────┘
                       │ HTTPS
┌──────────────────────▼───────────────────────────┐
│ Apache (TLS termination + reverse proxy)         │
│   /api/* → proxy_pass http://127.0.0.1:8000      │
│   /*     → static files (web/dist/)              │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│ FastAPI + Uvicorn                                │
│ ┌──────────┐ ┌──────────┐ ┌───────────────────┐ │
│ │ Routes   │ │ Services │ │ Auth (JWT)        │ │
│ └──────────┘ └──────────┘ └───────────────────┘ │
│ ┌──────────────────────────────────────────────┐ │
│ │ SQLAlchemy + Alembic (ORM + 迁移)            │ │
│ └──────────────────────────────────────────────┘ │
└──────────────────────┬───────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────┐
│ PostgreSQL                                        │
└──────────────────────────────────────────────────┘
```

### 客户端模块

```
app/
├── data/
│   ├── local/
│   │   ├── AppDatabase.kt          (Room 数据库)
│   │   ├── ItemDao.kt              (条目 DAO)
│   │   └── UserDao.kt              (用户 DAO)
│   ├── remote/
│   │   ├── ApiService.kt           (Retrofit 接口)
│   │   └── dto/                    (请求/响应 DTO)
│   └── repository/
│       ├── AuthRepository.kt       (认证仓库)
│       ├── ItemRepository.kt       (条目仓库，协调本地+远程)
│       └── SyncRepository.kt       (同步逻辑)
├── domain/
│   ├── CryptoManager.kt            (AES-256-GCM, RSA, PBKDF2)
│   ├── KeyManager.kt               (masterKey 生命周期)
│   └── SessionManager.kt           (登录状态管理)
├── ui/
│   ├── auth/
│   │   ├── LoginScreen.kt
│   │   ├── RegisterScreen.kt
│   │   └── RecoveryScreen.kt
│   ├── vault/
│   │   ├── VaultListScreen.kt      (条目列表)
│   │   ├── ItemDetailScreen.kt     (条目详情)
│   │   └── ItemEditScreen.kt       (新建/编辑条目)
│   ├── settings/
│   │   └── SettingsScreen.kt       (修改密码、导出、恢复码)
│   └── components/
│       └── ...                     (共享 UI 组件)
├── MainActivity.kt                 (单 Activity 入口)
└── SafeBoxApplication.kt           (Application，初始化依赖)
```

### 后端模块

```
server/
├── app/
│   ├── main.py                     (FastAPI 应用入口)
│   ├── config.py                   (配置管理)
│   ├── database.py                 (SQLAlchemy 引擎 + 会话)
│   ├── models/
│   │   ├── user.py                 (User, UserKeys, UserDevice, Item ORM)
│   ├── schemas/
│   │   ├── auth.py                 (注册/登录请求响应，含 email verification_code)
│   │   └── sync.py                 (同步请求响应)
│   ├── api/
│   │   ├── auth.py                 (注册/登录/找回密码/设备注册/refresh token)
│   │   └── sync.py                 (pull/push/delete)
│   ├── services/
│   │   ├── auth_service.py         (认证逻辑)
│   │   ├── verification_service.py (验证码生成/存储/校验，Redis)
│   │   ├── sms_service.py          (短信服务)
│   │   ├── email_service.py        (邮件服务)
│   │   └── google_auth_service.py  (Google OAuth)
│   └── middleware/
│       └── __init__.py             (JWT 验证)
├── migrations/                     (Alembic)
├── tests/
│   ├── test_auth.py                (8 个认证测试)
│   └── test_api_edge.py            (10 个边界场景测试)
├── requirements.txt
├── alembic.ini
├── DEBUG.md
├── DEPLOY.md
└── Makefile
```

### Web 客户端模块

```
web/
├── src/
│   ├── main.tsx                    (React 入口)
│   ├── App.tsx                     (路由 + Context Provider)
│   ├── crypto/
│   │   ├── pbkdf2.ts               (PBKDF2-HMAC-SHA256, deriveBits)
│   │   ├── aes.ts                  (AES-256-GCM, nonce前置格式)
│   │   ├── rsa.ts                  (RSA-4096 OAEP-SHA256, 分块加解密)
│   │   ├── bip39.ts                (BIP39 2049词表 + 恢复码)
│   │   ├── wordlist.ts             (词表数据)
│   │   └── index.ts                (CryptoManager 门面)
│   ├── services/
│   │   ├── keyManager.ts           (密钥生命周期，仅内存)
│   │   ├── api.ts                  (14个端点 + JWT注入 + 401刷新)
│   │   └── sync.ts                 (push-then-pull 同步)
│   ├── db/
│   │   ├── database.ts             (IndexedDB 连接)
│   │   ├── itemsStore.ts           (条目 CRUD)
│   │   └── sessionStore.ts         (Session 持久化)
│   ├── context/
│   │   ├── AuthContext.tsx          (认证状态)
│   │   └── VaultContext.tsx         (密码库状态)
│   ├── pages/
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx        (邮箱/手机 Tab)
│   │   │   ├── RegisterPage.tsx     (邮箱/手机 Tab，均需验证码)
│   │   │   └── RecoveryPage.tsx     (12词恢复码)
│   │   ├── vault/
│   │   │   ├── VaultListPage.tsx    (条目列表 + FAB)
│   │   │   ├── ItemDetailPage.tsx   (详情 + 按压查看)
│   │   │   └── ItemEditPage.tsx     (创建/编辑，三种类型)
│   │   └── settings/
│   │       └── SettingsPage.tsx     (恢复码/同步/退出)
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AuthLayout.tsx       (居中卡片)
│   │   │   └── AppLayout.tsx        (顶栏+内容)
│   │   └── ui/
│   │       ├── PasswordInput.tsx    (密码输入+显示切换)
│   │       └── Toast.tsx            (消息提示)
│   ├── routes/
│   │   ├── index.tsx                (路由定义)
│   │   └── AuthGuard.tsx            (路由守卫)
│   ├── types/
│   │   ├── api.ts                   (API 请求/响应类型)
│   │   └── domain.ts               (Item, SessionData)
│   ├── utils/
│   │   ├── base64.ts
│   │   └── password.ts             (密码生成器)
│   └── __tests__/
│       ├── crypto.test.ts           (42 个加密测试)
│       ├── integration.test.ts      (24 个集成测试)
│       └── cross-platform.test.ts   (18 个跨平台测试)
├── package.json
├── tsconfig.json
├── vite.config.ts
└── index.html
```

---

## 数据库设计

### PostgreSQL (服务端)

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT UNIQUE,
    phone           TEXT UNIQUE,
    google_id       TEXT UNIQUE,
    password_hash   TEXT,           -- PBKDF2(password, salt) 仅用于 API 认证
    password_salt   TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_keys (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    password_wrapped    TEXT,        -- AES-256-GCM(masterKey, passwordDerivedKey)
    recovery_wrapped    TEXT,        -- AES-256-GCM(masterKey, recoveryKey)
    encrypted_private   TEXT,        -- AES-256-GCM(rsaPrivateKey, masterKey)
    rsa_public_key      TEXT,        -- RSA 公钥 (明文存储，用于条目加密)
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_devices (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID REFERENCES users(id) ON DELETE CASCADE,
    device_name         TEXT,
    device_public_key   TEXT,        -- Android Keystore 公钥
    device_wrapped      TEXT,        -- AES-256-GCM(masterKey, devicePublicKey)
    last_active_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID REFERENCES users(id) ON DELETE CASCADE,
    client_did      INTEGER,         -- 客户端本地 ID (对应 Room 的 did)
    type            TEXT NOT NULL,    -- 'android' | 'account' | 'file'
    icon            TEXT,
    name            TEXT,            -- RSA 加密 + Base64
    description     TEXT,            -- RSA 加密 + Base64
    data            TEXT,            -- RSA 加密 + Base64 (JSON)
    version         INTEGER DEFAULT 1,
    is_deleted      BOOLEAN DEFAULT FALSE,  -- 软删除
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_items_user_updated ON items(user_id, updated_at);
```

### Room (客户端)

```kotlin
@Entity(tableName = "user")
data class UserEntity(
    @PrimaryKey val uid: Int = 0,       // 本地 UID
    val email: String?,
    val phone: String?,
    val googleId: String?,
    val serverUserId: String,            // 服务端 UUID
    val passwordHash: String,
    val passwordSalt: String,
    val passwordWrappedKey: String,
    val recoveryWrappedKey: String,
    val encryptedPrivateKey: String,
    val rsaPublicKey: String
)

@Entity(tableName = "item")
data class ItemEntity(
    @PrimaryKey(autoGenerate = true) val did: Int = 0,
    val uid: Int,
    val type: String,
    val icon: String,
    val name: String,
    val description: String,
    val data: String,                    // RSA 加密
    val serverId: String?,               // 服务端 UUID
    val version: Int = 1,
    val isDirty: Boolean = false,        // 是否有未同步的本地修改
    val updatedAt: Long = System.currentTimeMillis()
)
```

---

## API 设计

### 认证

```
POST /api/v1/auth/send-code
  body: {target: "phone"|"email", value: "138xxxx"|"user@example.com"}
  → {expires_in: 300}

POST /api/v1/auth/register/email
  body: {email, verification_code, password_hash, password_salt, password_wrapped, recovery_wrapped, encrypted_private, rsa_public_key, device_name?, device_public_key?, device_wrapped?}
  → {user_id, access_token, refresh_token}

POST /api/v1/auth/register/phone
  body: {phone, verification_code, password_hash, password_salt, ...}
  → {user_id, access_token, refresh_token}

POST /api/v1/auth/register/google
  body: {google_id_token, password_hash, password_salt, ...}
  → {user_id, access_token, refresh_token}

POST /api/v1/auth/login/email
  body: {email, password_hash}
  → {access_token, refresh_token, password_wrapped, recovery_wrapped, encrypted_private, rsa_public_key, devices}

POST /api/v1/auth/login/phone
  body: {phone, verification_code, password_hash}
  → {access_token, refresh_token, user_keys}

POST /api/v1/auth/login/google
  body: {google_id_token}
  → {access_token, refresh_token, user_keys}

POST /api/v1/auth/reset-password
  body: {target: "phone"|"email", value, verification_code, new_password_hash, new_password_salt, new_password_wrapped}
  → {success}

POST /api/v1/auth/refresh-token
  body: {refresh_token}
  → {access_token, refresh_token}

POST /api/v1/auth/register-device
  headers: Authorization: Bearer <token>
  body: {device_name?, device_public_key, device_wrapped}
  → {device_id}
```

注意：email 注册和 phone 注册均需 verification_code，Google 注册由服务端验证 id_token 替代。

### 同步

```
GET  /api/v1/sync/pull?since=<ISO8601>&limit=100
  → {items: [...], server_time, has_more}

POST /api/v1/sync/push
  body: {items: [{client_did, type, icon, name, description, data, version, updated_at}]}
  → {results: [{client_did, server_id, status}]}

POST /api/v1/sync/delete
  body: {server_ids: [...]}
  → {results: [...]}
```

### 验证码

```
POST /api/v1/auth/send-code
  body: {target: "phone"|"email", value: "138xxxx"|"user@example.com"}
  → {expires_in: 300}

验证码 6 位数字，5 分钟有效。Redis 存储，60 秒内同一目标只能发一次。
email 和 phone 注册均需验证码校验。
```

---

## 安全加固细则

## 安全加固细则

| 组件 | 旧方案 | 新方案 |
|------|--------|--------|
| 密码哈希 | SHA-256 单次 | PBKDF2-HMAC-SHA256, 100k 迭代, 32 字节 salt |
| 对称加密 | 3DES-CBC, 硬编码 IV `"SNAILEYE"` | AES-256-GCM, 每次随机 12 字节 nonce |
| RSA Padding | PKCS1 (默认) | OAEPWithSHA-256AndMGF1Padding |
| 随机数 | `SecureRandom.setSeed(uptimeMillis())` | `SecureRandom()` 无自定义种子 |
| 密钥长度 | RSA-4096 | RSA-4096 (保持) |
| 登录验证 | 本地 SQLite shadow 比对 | 服务端 PBKDF2 hash 比对 (仅 API 认证，不解密数据) |
| 条目加密 | RSA 公钥分段加密 | 同，客户端加密后上传 |
| 传输安全 | 无 | HTTPS + 证书 pinning |

---

## 实施计划

### Phase 1: 后端基础 (2-3 周)
- FastAPI 项目骨架
- PostgreSQL + SQLAlchemy + Alembic
- 用户注册/登录 API (Email)
- JWT 认证中间件
- 条目 CRUD API
- 同步 API (pull/push)
- 单元测试

### Phase 2: 后端认证扩展 (1 周)
- 短信验证码 (阿里云/腾讯云 SMS)
- 邮件验证码
- Google OAuth 集成
- 密码重置流程

### Phase 3: Android 核心重构 (2-3 周)
- 项目配置升级 (Kotlin, Compose, Room, Retrofit)
- CryptoManager 重写 (AES-256-GCM, PBKDF2, RSA-OAEP)
- KeyManager + SessionManager
- Room 数据库 + DAO
- AuthRepository (注册/登录/恢复)
- ItemRepository (本地 CRUD + 远程同步)

### Phase 4: Android UI + Web 客户端 (2-3 周)
- Compose 重写全部 UI
- 认证页面 (登录/注册/找回/恢复码)
- 条目列表 + 详情 + 编辑
- 设置页面 (修改密码/导出备份/查看恢复码)
- 自动锁定 + 生物识别
- **Web 客户端**: React 19 + TypeScript + Vite 6
  - Web Crypto API 加密层，与 Android 字节级兼容
  - IndexedDB 本地存储 + push-then-pull 同步
  - 邮箱/手机注册均需验证码校验
  - 三种条目类型 (android/account/file)
  - 自动锁定 5 分钟

### Phase 5: 端到端集成 (1 周)
- 客户端-服务端联调
- Web ↔ Android 跨平台加密兼容性验证
- 同步冲突测试
- 多设备场景测试
- 恢复码流程验证

### Phase 6: 部署与交付 (1 周)
- Apache 反代配置
- HTTPS 证书
- 生产环境部署
- 监控与日志
- BUILD.md + README

---

## 不做的事 (V1)

- 不实现团队共享/家庭共享功能 (V1 只做个人密码管理)
- 不实现浏览器扩展 (V1 只做 Android + Web)
- 不实现密码自动填充 (Autofill Framework，V2 考虑)
- 不迁移现有用户的 SQLite 数据 (开发/自用阶段，手动迁移)

## 已做但原始方案未规划的事

- ✅ **Web 客户端** (2026-06-27): React 19 + TypeScript + Vite 6，Web Crypto API 加密层，IndexedDB 本地存储，与 Android 端功能对等，零后端改动

---

## 验证方法

### 安全性验证
- 抓包确认所有 API 请求为 HTTPS，请求体中无非明文敏感数据
- 验证服务端数据库中 user_keys 表无可还原的明文
- 验证恢复码流程：清除 App 数据 → 输入恢复码 → 所有条目恢复
- 验证错误密码无法登录、无法解密任何条目

### 功能性验证
- 三种注册方式均可完成注册并强制保存恢复码
- 三种登录方式均可登录并加载条目
- 添加/编辑/删除条目 → 同步到云端 → 另一设备拉取一致
- 离线操作 → 联网后自动同步
- 修改密码后所有条目可正常解密
- 短信/邮件找回密码后可正常登录

### 性能验证
- 100 条条目同步耗时 < 5 秒
- 登录流程 (从输入密码到列表显示) < 2 秒
- API 响应时间 P99 < 200ms
