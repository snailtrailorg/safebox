# SafeBox 重构迁移图（v2.6）

> 基于 v2.6 架构决策的变更清单和迁移顺序
> v2.5 → v2.6: 恢复码改为一次性提交新密码 + 24h 冷却期 + 加速通道 + 冻结回滚；移除 cancel/confirm 端点

---

## 一、架构级变更分类

### P0 — 安全/合规 gap

| # | 变更 | 涉及 |
|---|------|------|
| 1 | RSA → AES-GCM + Item Key（每条条目随机 Item Key，User Key 包裹） | 前端 crypto, keychain, VaultContext |
| 2 | KDF 参数可配置（Web Worker 执行） | 前端 crypto/kdf.ts, crypto/kdf.worker.ts, 后端 models |
| 3 | auth_key_hash 替代 password_hash（算法不变：PBKDF2(salt+"auth")) | 前端 crypto, 后端 API/schemas |
| 4 | PBKDF2 600K 移至 Web Worker | 前端 crypto/kdf.worker.ts |
| 5 | 条目加密显式 version 标记（1=RSA, 2=AES-GCM+ItemKey） | 前端 VaultContext |

### P1 — 架构功能完整

| # | 变更 | 涉及 |
|---|------|------|
| 6 | 恢复码改用 BIP39 12 词 + 服务端 HMAC-SHA256 验证 + 冷却期 + 冻结 | 前端 RecoveryPage, 后端 entire recovery module |
| 7 | GET /salt 精简（不返回密钥材料）| 后端 auth.py, 前端 LoginPage |
| 8 | change-password + 邮箱验证码 | 后端 API, 前端 ChangePasswordPage |
| 9 | 注销账号 + 邮箱验证码 + 告警 | 后端 DELETE /account, 前端 SettingsPage |
| 10 | 注册幂等性（idempotency_key）| 后端 utils/idempotency.py |
| 11 | 密码强度 12+ 含复杂度校验 | 前端 RegisterPage, ChangePasswordPage |
| 12 | 移除 recovery_salt/recovery_wrapped（不再参与密钥派生）| 前端 crypto, 后端 schemas/models |
| 13 | 注册流程不再生成恢复码（改为安全设置页主动生成）| 前端 RegisterPage |

### P2 — 代码组织清理（同 v2.0）

### P3 — 体验完善（同 v2.0）

---

## 二、跨平台兼容性

| 组件 | Web v2 | Android v1 | 兼容 |
|------|--------|-----------|------|
| Auth Key 派生 | PBKDF2(salt+"auth") | PBKDF2(salt+"auth") | ✅ 完全一致 |
| 条目加密 | Item Key + AES-GCM | RSA-4096 | 🟡 Web 能读 Android 条目（version=1）；Android 不能读 Web 新增（version=2） |
| 恢复码 | 服务端 HMAC-SHA256（平台无关） | SHA-256（已废弃） | 🟡 新设计完全服务端，旧 Android 恢复码在新系统不兼容（需走客服通道） |
| KDF 参数 | 可配置 | 固定 100K | 🟡 使用相同迭代数即可 |
