# SafeBox 前端组件架构

> 版本: v0.1（当前实现）
> 覆盖：React 18 + TypeScript + Vite

---

## 一、组件树

```
<App>
  ├── <BrowserRouter>
  │     ├── / → <AuthGuard>
  │     │         └── <AppLayout>           ← 顶栏 + 内容区
  │     │               ├── 顶栏: 用户头像 ↔ 下拉菜单
  │     │               ├── <VaultListPage> ← 条目列表 + FAB
  │     │               │     ├── 搜索栏（未来）
  │     │               │     ├── 条目列表
  │     │               │     │     └── 每个条目 → <ItemCard>
  │     │               │     └── <FAB> → navigate("/vault/new")
  │     │               ├── /vault/:id → <ItemDetailPage>
  │     │               │     └── 条目详细信息 + 按压查看密码
  │     │               ├── /vault/new → <ItemEditPage>
  │     │               └── /settings → <SettingsPage>
  │     │                     └── 改密 / 导出 / 同步 / 恢复码 / 注销
  │     │
  │     └── /auth/* → <AuthLayout>         ← 居中卡片布局
  │           ├── /login → <LoginPage>
  │           │     └── Tab: email / phone / Google
  │           ├── /register → <RegisterPage>
  │           │     └── Tab: email / phone / Google
  │           └── /recovery → <RecoveryPage>
  │                 └── 输入 BIP39 恢复码 → 新密码
  │
  └── <AuthProvider>                         ← AuthContext
  └── <VaultProvider>                        ← VaultContext
```

---

## 二、组件职责

### 2.1 布局组件

| 组件 | 职责 | 状态来源 |
|------|------|---------|
| AuthLayout | 居中卡片 + 背景 + 标题副标题 | props |
| AppLayout | 顶栏 + 下拉菜单 + 自动锁定倒计时 + 离线提示 + 内容区 | AuthContext + useNavigate |

### 2.2 页面组件

| 组件 | 职责 | 状态来源 | 依赖的 API |
|------|------|---------|-----------|
| LoginPage | 三种登录方式 Tab，PBKDF2 密码哈希 | local state | GET /salt, POST /login/* |
| RegisterPage | 三种注册方式 Tab，生成密钥并上传 | local state | POST /send-code, POST /register/* |
| RecoveryPage | BIP39 恢复码验证 + 新密码重置 | local state | GET /salt, POST /auth/recovery/initiate |
| VaultListPage | 显示条目列表 + FAB 新建 | VaultContext | — |
| ItemDetailPage | 条目详情 + 按压显示密码 | VaultContext + local | — |
| ItemEditPage | 创建/编辑条目 | VaultContext + local | — |
| SettingsPage | 改密/导出/导入/恢复码/同步 | local | (已登录) |

### 2.3 服务层

| 文件 | 职责 | 状态 |
|------|------|------|
| keyManager.ts | masterKey/RSA 内存生命周期、加解密 | 全局单例，纯函数 |
| api.ts | fetch 封装 + JWT 注入 + 401 自动刷新 | 无状态 |
| sync.ts | push-then-pull 同步逻辑 | 调用 VaultContext |

### 2.4 Context

| Context | 状态 | 方法 |
|---------|------|------|
| AuthContext | authStatus (loading/guest/locked/ready) + userInfo | login(), logout(), lockAutoLock() |
| VaultContext | vaultItems + isSyncing + conflicts | saveItem, deleteItem, syncNow, resolveConflict, clearError |

---

## 三、数据流

### 3.1 认证数据流

```
LoginPage ──(api.ts)──→ FastAPI ─→ AuthContext.login()
                                  ↓
                           AuthGuard: 检查 authStatus
                                  ↓
                           ready → /    guest → /login
                           locked → /lock  (解锁屏，当前未实现)
```

### 3.2 条目数据流

```
ItemEditPage ──→ VaultContext.addItem()
                      │
                      ├── encryptItemData (RSA-4096)
                      ├── IndexedDB.put()
                      │
                      ├── authContext.isSyncing = true
                      │     └── sync.push() → API
                      └── authContext.isSyncing = false
```

### 3.3 同步数据流

```
Timed / manual trigger
       │
       ├── sync.ts
       │     ├── push(local dirty items) → POST /sync/push
       │     └── pull(server_time) → GET /sync/pull
       │
       └── VaultContext
             ├── merge server items into IndexedDB
             └── update vaultItems state → UI re-render
```

---

## 四、状态管理概览

| 数据 | 存储位置 | 持久化 | 生命周期 |
|------|---------|--------|---------|
| masterKey / RSA key | keyManager (内存) | 否 | 页面刷新 = 消失 |
| Session 元信息 | IndexedDB (sessionStore) | 是 | logout = 删除 |
| 条目数据 | IndexedDB (itemsStore) | 是 | 注销账号 = 删除 |
| Auth 状态 | AuthContext (React state) | 否 | logout = 重设 |
| Vault 数据 | VaultContext (React state) | 否 | 由 IndexedDB 填充 |

### 4.1 客户端缓存（IndexedDB）

| Store | 表 | 用途 |
|-------|----|------|
| sessionStore | sessionData | email, passwordSalt, passwordWrapped, recoveryWrapped, encryptedPrivate, rsaPublicKey, tokens |
| itemsStore | items | 所有条目（加密后）的本地副本 |

---

## 五、当前问题

| # | 问题 | 说明 |
|---|------|------|
| 1 | keyManager 中 `unlockWithPassword` 和 `loadRsaKeys` 是两步操作 | 新设备登录时解锁成功后需要再用同一个 masterKey 加载 RSA 密钥，流程割裂 |
| 2 | keyManager 强引用 `(keyManager as any).masterKey` | 多处代码通过 `as any` 绕过 TS 类型检查访问私有字段 |
| 3 | VaultContext 和 IndexedDB 之间没有清晰的读写分离 | 页面直接操作 IndexedDB，有时绕过 VaultContext |
| 4 | sync.ts 中的 push-then-pull 逻辑与 VaultContext 耦合太紧 | 同步触发、结果合并、UI 更新都在一个函数里 |
| 5 | 没有 offline/online 的事件监听 | 离线时无法添加条目（当前会静默失败） |
