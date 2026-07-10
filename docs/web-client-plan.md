# SafeBox Web Client 实现方案

## Context

SafeBox 目前只有 Android 客户端。用户需要一个 Web 客户端，实现与 Android 端完全相同的功能（注册/登录/密码管理/云同步），且与现有后端零改动兼容。Web 客户端作为纯静态 SPA 部署到同一台 Apache 服务器。

## 技术选型

**React 19 + TypeScript + Vite 6**

理由：
- Web Crypto API 原生支持 AES-GCM、RSA-OAEP、PBKDF2（`deriveBits`），无需重量级加密库
- React 生态成熟，Google OAuth 有现成的 `@react-oauth/google`
- Vite tree-shaking 好，构建产物小（对安全敏感应用重要）
- TypeScript 类型检查降低加密参数传错的风险

辅助依赖：
- `idb`（Jake Archibald 的 IndexedDB 轻封装，~2KB）
- `react-router-dom` v7（路由）
- `@noble/hashes`（PBKDF2 备选，用于单测环境）
- `vitest`（测试）

## 核心设计原则

1. **零后端改动**：Web 客户端完全复用现有 14 个 API 端点
2. **加密字节级兼容**：Web Crypto API 实现的 PBKDF2/AES-256-GCM/RSA-4096-OAEP/BIP39 必须与 Android `CryptoManager.kt` 输出完全一致
3. **密钥不落盘**：Master key 和 RSA 私钥只存在于 JavaScript 堆内存（`CryptoKey` 对象），不持久化到任何存储
4. **安全优先**：CSP 头严格、无 sourcemap、IndexedDB 替代 localStorage

## 项目结构

```
web/
  package.json
  tsconfig.json
  vite.config.ts
  index.html
  src/
    main.tsx
    App.tsx
    config/
      constants.ts          # 加密常量（迭代次数、密钥长度等）
    types/
      api.ts                # API 请求/响应类型
      domain.ts             # Item, User 等业务类型
    crypto/
      bip39.ts              # BIP39 2048 词表 + 恢复码生成/还原
      pbkdf2.ts             # PBKDF2-HMAC-SHA256（deriveBits 方案）
      aes.ts                # AES-256-GCM 加解密（nonce 前置格式）
      rsa.ts                # RSA-4096 OAEP-SHA256 分块加解密
      index.ts              # CryptoManager 门面
    services/
      keyManager.ts         # KeyManager：内存中密钥生命周期
      sessionManager.ts     # SessionManager：IndexedDB 持久化
      api.ts                # ApiClient：fetch 封装 + JWT 注入 + 401 刷新
      sync.ts               # SyncService：push-then-pull 同步
    db/
      database.ts           # IndexedDB 连接（idb 库）
      itemsStore.ts         # Item CRUD（对应 ItemDao.kt）
      sessionStore.ts       # Session 持久化
    context/
      AuthContext.tsx        # 认证状态 Provider
      VaultContext.tsx       # 密码库状态 Provider
    hooks/
      useAuth.ts
      useVault.ts
      useSync.ts
    components/
      ui/                    # Button, Input, Modal, Toast, PasswordInput...
      layout/
        AuthLayout.tsx       # 认证页居中卡片布局
        AppLayout.tsx        # 主应用布局（顶栏+内容）
    pages/
      auth/
        LoginPage.tsx        # 邮箱/手机/Google 登录 Tab
        RegisterPage.tsx     # 邮箱/手机/Google 注册 Tab + 恢复码展示
        RecoveryPage.tsx     # 恢复码输入 + 新密码设置
      vault/
        VaultListPage.tsx    # 条目列表 + FAB 添加
        ItemDetailPage.tsx   # 条目详情 + 敏感信息按压查看
        ItemEditPage.tsx     # 创建/编辑条目（按类型分字段）
      settings/
        SettingsPage.tsx     # 改密码/自动锁定/导入导出/退出
    routes/
      index.tsx              # 路由定义
      AuthGuard.tsx          # 需登录路由守卫
      GuestGuard.tsx         # 已登录重定向守卫
    utils/
      base64.ts              # Uint8Array ↔ Base64
      password.ts            # 密码生成器
```

约 45 个文件。

## 加密层设计

### 密钥层级（与 Android 一致）

```
用户密码 ──PBKDF2(600k, SHA-256)──> 派生密钥(AES-256)
    └── AES-GCM 解密 password_wrapped ──> 主密钥(AES-256)
        └── AES-GCM 解密 encrypted_private ──> RSA 私钥(4096-bit)
            └── RSA-OAEP 解密 ──> 条目 data JSON
```

### Web Crypto API 关键用法

**PBKDF2**：使用 `deriveBits` 而非 `deriveKey`，因为后者限制密钥用途。
```typescript
// 1. importKey raw → 2. deriveBits(256) → 3. importKey raw AES-GCM
const keyMaterial = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: 600_000, hash: "SHA-256" }, keyMaterial, 256);
const aesKey = await crypto.subtle.importKey("raw", new Uint8Array(bits), "AES-GCM", false, ["encrypt", "decrypt"]);
```

**RSA-4096 OAEP**：Web Crypto 原生支持。分块大小需与 Android 一致（446 字节/块，OAEP-SHA256；对应 `CryptoManager.kt` 的 `RSA_CHUNK_SIZE`）。

**BIP39**：直接复制 `CryptoManager.kt` 中的 2048 词表。恢复码生成逻辑为纯字符串操作。

### 600k 次 PBKDF2 在浏览器中的性能

现代浏览器约 200-500ms。仅在登录/注册时执行一次，可接受。如果 UI 卡顿，后续可移到 Web Worker。

## 状态管理

### 持久化存储：IndexedDB（`idb` 库）

两个 object store：
- `session`：accessToken, refreshToken, serverUserId, passwordSalt, passwordWrapped, encryptedPrivate, rsaPublicKey, lastSyncTime
- `items`：did(自增PK), uid, type, icon, name, description, data, serverId, version, isDirty, isDeleted, updatedAt, createdAt

### 内存状态：React Context

- `AuthContext`：isLoggedIn, isUnlocked, userId
- `VaultContext`：items[], isLoading, isSyncing
- `KeyManager`（类实例，非 Context）：masterKey, rsaPublicKey, rsaPrivateKey（仅 `CryptoKey` 对象，不可提取）

### 安全措施
- localStorage/sessionStorage 不存储任何密钥材料
- 自动锁定计时器（默认 5 分钟），到期清除内存密钥
- 标签页切换时通过 `BroadcastChannel` 广播锁定事件

## 路由设计

| 路径 | 守卫 | 页面 |
|------|------|------|
| `/login` | GuestGuard | LoginPage |
| `/register` | GuestGuard | RegisterPage |
| `/recovery` | GuestGuard | RecoveryPage |
| `/` | AuthGuard | VaultListPage |
| `/item/:did` | AuthGuard | ItemDetailPage |
| `/item/:did/edit` | AuthGuard | ItemEditPage |
| `/item/new/:type` | AuthGuard | ItemEditPage |
| `/settings` | AuthGuard | SettingsPage |

AuthGuard 逻辑：检查 IndexedDB 中是否有 session → 有则检查 keyManager 是否已解锁 → 未解锁重定向到 /login。

## API 层

`ApiClient` 类封装 fetch：
- 自动注入 `Authorization: Bearer <token>`（跳过 `/auth/` 路径，但 `/auth/register-device` 除外）
- 收到 401 自动调 `/api/v1/auth/refresh-token` 刷新，失败则清 session 跳转 /login
- 所有 14 个端点的方法签名与 Android `ApiService.kt` 一一对应

## 同步策略

与 Android `SyncRepository.kt` 完全一致：
1. 查询 IndexedDB 中 `isDirty = true` 的条目 → POST `/api/v1/sync/push`
2. 成功后标记 `isDirty = false`，写入 `serverId`
3. 从 `lastSyncTime` 开始 GET `/api/v1/sync/pull`（分页）
4. 远程条目合并到 IndexedDB（`isDirty = false`）
5. 软删除的条目标记 `isDeleted = true`
6. 更新 `lastSyncTime`

触发时机：页面挂载、手动点击同步按钮、保存/删除条目后立即推送。

## 部署

构建产物 `web/dist/` 为纯静态文件。Apache 配置扩展：

```apache
# 静态文件（SPA）
DocumentRoot /home/safebox/web/dist
FallbackResource /index.html   # SPA 路由回退

# API 反代（优先匹配）
ProxyPass /api/ http://127.0.0.1:8000/api/
ProxyPass /health http://127.0.0.1:8000/health
```

加上严格 CSP 头：`default-src 'self'; script-src 'self'; connect-src 'self' https://accounts.google.com`

## 实现阶段

### Phase 1：项目骨架 + 加密核心
- Vite + React + TypeScript 脚手架
- `crypto/` 全部 5 个模块
- `utils/base64.ts`
- 关键：与 Android 交叉验证加密输出（同密码+同盐 → 同 hash）

### Phase 2：本地存储 + 会话管理
- `db/` IndexedDB schema + session/items store
- `services/keyManager.ts` + `services/sessionManager.ts`

### Phase 3：API 层 + 认证流程
- `services/api.ts`（14 个端点 + token 刷新）
- `pages/auth/` 登录/注册/恢复页面
- `context/AuthContext.tsx` + 路由守卫

### Phase 4：密码库 UI + CRUD
- `pages/vault/` 列表/详情/编辑页面
- `context/VaultContext.tsx`
- `components/ui/` 通用组件

### Phase 5：同步集成
- `services/sync.ts` push-then-pull
- 列表页挂载触发同步、手动同步按钮

### Phase 6：设置页 + Google OAuth + 打磨
- SettingsPage（改密码、查看恢复码、自动锁定、退出）
- Google OAuth 登录/注册
- CSP 加固 + 安全审查

### Phase 7：测试 + 部署
- 端到端测试（注册→登录→创建条目→同步）
- 跨平台加密兼容性验证
- 构建生产包 + Apache 配置更新

## 关键风险

1. **跨平台加密兼容性**：最大风险。Phase 1 必须用 Android 测试向量验证。Web Crypto 的 RSA-OAEP chunk size 可能与 Android BouncyCastle 不同。
2. **IndexedDB 无痕模式**：部分浏览器限制。启动时检测并提示用户。
3. **Google OAuth Web vs Android**：使用 Google Identity Services 库，发送相同的 `google_id_token` 到后端，后端无需改动。

## 验证方式

1. `npm run dev` → 浏览器打开 http://localhost:5173
2. 启动本地后端 `cd server && make dev`
3. 测试注册→登录→创建条目→同步完整流程
4. Android 加密 → Web 解密，反之亦然
