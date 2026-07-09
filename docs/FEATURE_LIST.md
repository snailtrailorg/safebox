# SafeBox 功能清单

> 提取自 `docs/architecture/` 所有文档，与当前代码实现一致

## 一、用户认证

| 功能 | 描述 | 实现 |
|------|------|------|
| 邮箱注册 | 验证码 + PBKDF2 派生 auth_key_hash，注册时不生成恢复码 | `POST /auth/register/email` |
| 手机号注册 | 短信验证码 + PBKDF2 | `POST /auth/register/phone` |
| Google OAuth 注册 | Google ID Token 验证 | `POST /auth/register/google` |
| 邮箱登录 | PBKDF2 派生 auth_key_hash 比对 | `POST /auth/login/email` |
| 手机号登录 | 验证码 + PBKDF2 | `POST /auth/login/phone` |
| Google OAuth 登录 | Google ID Token 验证 + 查找已注册用户 | `POST /auth/login/google` |
| 登录退避（L1） | 按目标（邮箱/手机/Google ID）指数退避，第 5 次锁定 1 小时 | `get_login_wait` + `record_login_failure` |
| IP 滑动窗口限流（L2） | 1 小时窗口，500 次/小时，严格端点 100 次/小时 | `RateLimitMiddleware` |
| JWT access token | HS256 签发，30 分钟过期，含 type="access" | `create_access_token` |
| refresh token rotation | TokenFamily 表 + FOR UPDATE 行锁，重放检测全失效 | `verify_and_rotate_refresh_token` |
| 登出 | 撤销该用户所有 refresh token | `POST /auth/logout` |
| token 刷新 | 旧 refresh token 验后删除，发新 token pair | `POST /auth/refresh-token` |
| JWT 中间件 | 验证 type="access"，refresh token 不能访问业务 API | `get_current_user_id` |
| GET salt | 返回 password_salt + kdf_settings，不存在用户返回随机盐防枚举 | `GET /auth/salt` |
| 设备注册 | 记录设备公钥，用于跨设备密钥传输 | `POST /auth/register-device` |

## 二、密码与密钥管理

| 功能 | 描述 |
|------|------|
| PBKDF2 密钥派生 | 默认 600,000 迭代 SHA-256，`kdf_settings` 可配置 |
| Auth Key 派生 | PBKDF2(password, salt+"auth")，与 Android 兼容 |
| User Key | 随机 AES-256，注册时生成，改密不换 |
| Item Key | 每条目独立随机 AES-256，User Key 包裹后存储 |
| RSA 密钥对 | 4096 位，PKCS8 格式，User Key 加密存储，用于跨设备和旧条目兼容 |
| password_wrapped | AES-256-GCM(User Key, passwordDerivedKey) |
| recovery_wrapped | AES-256-GCM(User Key, recoveryKey) |
| encrypted_private | AES-256-GCM(RSA 私钥, User Key) |
| 换密码不解密条目 | 只重新 wrap User Key，Item Keys 不动 |

## 三、条目加密（v2 字段级）

| 功能 | 描述 |
|------|------|
| 字段级 AES-256-GCM | name、description、data 分别独立加密 |
| Item Key 共享 | 同条目多字段共享一个 Item Key |
| EncryptedField 结构 | `{encrypted_key, ciphertext}`，encrypted_key = AES-GCM(User Key, Item Key) |
| AAD 绑定 | `safebox:v2:item:{fieldName}:{itemType}`，防密文替换攻击 |
| Nonce | 12 字节随机（`crypto.getRandomValues`），每字段独立 |
| tagLength | 显式 128 位 |
| 文件加密 | 文件类型条目：AES-256-GCM 加密文件 blob，存 IndexedDB |

## 四、恢复码机制

| 功能 | 描述 | 实现 |
|------|------|------|
| 生成恢复码 | BIP39 12 词（132bit 熵），服务端生成，仅此一次返回 | `POST /auth/recovery/generate` |
| 一人一码 | 生成新码时旧码永久锁定 | `create_recovery_code` |
| HMAC-SHA256 验证 | `HMAC(server_key, salt + normalized_mnemonic)`，服务端密钥防破解 | `hash_recovery_code` |
| 常量时间比较 | `hmac.compare_digest` | `verify_recovery_code` |
| normalize 助记词 | trim + lower + 单空格 | `normalize_mnemonic` |
| 发起恢复 | 一次性提交恢复码 + 新密码，进入 24h 冷却期 | `POST /auth/recovery/initiate` |
| 冷却期 24h | cooldown_expires_at = now + 24h，pending_* 字段与原数据共存 | `initiate_recovery` |
| 加速通道 | 验证码 + 签名链接跳过剩余冷却，立即激活 | `POST /auth/recovery/accelerate` |
| 冻结 | 签名链接回滚，丢弃 pending_*，旧密码不变 | `POST /auth/recovery/freeze` |
| 冻结 = 天然回滚 | 旧数据从未覆盖，丢弃 pending_* 即可 | `freeze_recovery` |
| 自动激活 | cooldown_expires_at 到期自动写 pending_* 到正式字段 | `check_and_auto_activate` |
| 撤销 | 已登录用户主动作废旧码 | `POST /auth/recovery/revoke` |
| 状态查询 | 返回状态 + cooldown 剩余时间 + 双计数器 | `GET /auth/recovery/status` |
| 失败计数（24h 窗口） | HTTPS 验证失败递增，≥5 次永久锁定，成功后清零 | `find_valid_recovery_code` |
| 月发起计数 | 成功进入冷却期递增，>3 次永久锁定，冻结不减少 | `initiate_recovery` |
| 加速链接 TTL | 与冷却期一致（`COOLDOWN_HOURS * 60`），防止不一致 | `sign_recovery_token` |
| 签名链接 | JWT HS256，15 分钟或与冷却期一致 | `sign_recovery_token` / `verify_recovery_token` |
| 多渠道告警 | initiate/accelerate/freeze/自动激活 4 场景告警邮件 | `send_recovery_alert` |
| 客服解锁 | 管理员端点，核身后发送重置链接 | `POST /admin/recovery/unlock` |

## 五、条目同步

| 功能 | 描述 | 实现 |
|------|------|------|
| push 批量写入 | 支持批量创建/更新，批量 IN 查询（非 N+1） | `POST /sync/push` |
| LWW 冲突检测 | 按 updated_at 比较，旧版本标记 conflict | `sync_push` |
| 冲突用户选择 | 前端显示冲突，用户选保留本地或使用服务端 | `resolveConflict` |
| pull 增量同步 | since 游标 + limit 分页，返回 has_more 继续拉取 | `GET /sync/pull` |
| 软删除 | 标记 is_deleted=true，pull 时返回删除标记 | `POST /sync/delete` |
| push-then-pull | 先推本地修改后拉服务端更新 | `sync()` |
| EncryptedField 序列化 | push 时 JSON.stringify，pull 时 JSON.parse | 前端 sync.ts |

## 六、验证码系统

| 功能 | 描述 |
|------|------|
| 验证码生成 | 6 位随机数字 |
| Redis 存储 | 5 分钟过期，key 格式 `vc:{target}:{value}` |
| 原子消费 | `GETDEL` 防 TOCTOU |
| 60s 限流 | 同一目标 60s 内只能发一次 |
| SMTP 邮件 | 验证码 HTML 邮件，dev 模式打印到日志 |
| Twilio 短信 | 国际短信发送 |
| 改密需验证码 | 当前密码 + 邮箱验证码双因子 |
| 注销需验证码 | 邮箱验证码确认身份 |

## 七、前端功能

| 功能 | 描述 |
|------|------|
| 登录页 | 三种登录方式 Tab（email/phone/Google），PBKDF2 密码哈希 |
| 注册页 | 三种注册方式 Tab，密钥生成并上传 |
| 恢复码页 | 恢复码展示（3×4 词）+ 二次确认（第 4/8 词），恢复发起 + 冷却期倒计时 |
| 密码库列表 | 条目列表 + FAB 新建 + 左滑删除，解密名称显示 |
| 条目详情 | 解密显示 name/description/data，按压查看敏感信息 |
| 条目编辑 | 创建/编辑条目，5 种类型（login/card/identity/note/file），Item Key 加密 |
| 设置页 | 改密/导出备份/导入备份/恢复码/同步/注销 |
| 导出备份 | JSON → AES-256-GCM → .safebox 文件下载 | `ExportBackupPage.tsx` |
| 导入备份 | .safebox 文件 → AES-GCM 解密 → 导入 IndexedDB | `ImportBackupPage.tsx` |
| 自动锁定 | useAutoLock hook，监听空闲/窗口失焦，超时清除密钥跳转锁定 |
| 自动锁定遮罩 | AutoLockOverlay 组件，锁定倒计时提示 | `AutoLockOverlay.tsx` |
| IndexedDB 错误防护 | DbErrorBoundary 组件，DB 不可用时降级为 guest 模式 | `DbErrorBoundary.tsx` |
| AuthContext | 认证状态管理（loading/guest/locked/ready），dbUnavailable 降级 |
| VaultContext | 密码库状态管理，itemNames 解密名称缓存，syncNow + resolveConflict |
| keyChain 单例 | User Key / Item Key 生命周期，encryptItemField/decryptItemField |
| i18n 国际化 | 中/英双语，i18next |
| 响应式布局 | AuthLayout（居中卡片）+ AppLayout（顶栏+内容） |
| 离线支持 | IndexedDB (idb)，isDirty 标记，恢复连接后自动 sync |
| Toast 提示 | 全局错误/成功/info 提示 |
| 密码生成器 | Uint32Array 随机取模，减少偏差 | `password.ts` |
| SendCodeButton | 验证码发送按钮 + 60s 倒计时，卸载清理 interval |

## 八、限流与安全

| 功能 | 描述 |
|------|------|
| RateLimitMiddleware | IP/user 滑动窗口，JWT 解析 user_id 避免 NAT 误伤 |
| 白名单路径 | /health, /docs, /openapi.json 不限制 |
| 路径规则 | 严格端点（auth/login/register/recovery）100/小时，默认 500/小时 |
| Redis 故障 fail-open | try/except 放行请求，避免限流故障锁死 |
| 429 + Retry-After | 超限时返回 429，含 Retry-After 头 |
| 登录侧信道防护 | 用户不存在时仍执行 bcrypt，返回统一错误消息 |
| 密码强度强制 | ≥12 字符 + 大写/小写/数字/特符 + 排除连续序列 |
| 认证与加密分离 | Auth Key（salt+"auth"）≠ 加密 Key（salt），防服务器密钥重放 |
| bcrypt 二次哈希 | 客户端 PBKDF2 输出再 bcrypt 后存储 |
| JWT type 校验 | 中间件强制 type="access"，防 refresh token 冒充 |
| 异常捕获收窄 | SMTPException/HTTPError/Timeout 替代裸 Exception |
| refresh token hash 常量时间 | `hmac.compare_digest` 替代 `!=` |
| `||` 改 `??` | 空值合并语义正确（sessionStore, ItemDetailPage） |
| SendCodeButton interval 清理 | useEffect 清理，防组件卸载后定时器泄露 |

## 九、测试

| 类别 | 文件 | 用例数 |
|------|------|--------|
| 后端单元-认证 | `test_auth.py` | 认证端点测试 |
| 后端单元-边界 | `test_api_edge.py` | API 边界场景（登录、同步、权限） |
| 后端单元-BIP39 | `test_bip39.py` | BIP39 词表验证（2048 词、格式、唯一性、12/24 词生成） |
| 后端单元-恢复码 | `test_recovery.py` | 恢复码哈希/验证/签名 token/盐唯一性 |
| 前端-密码学 | `kdf-keychain.test.ts` | KDF + keyChain 密钥生命周期 |
| 前端-加密 | `crypto.test.ts` | AES-GCM/PBKDF2/RSA 加密往返 |
| 前端-国际化 | `i18n.test.ts` | i18n 翻译加载 |
| 前端-集成 | `integration.test.ts` | IndexedDB CRUD + dirty 跟踪 + 排序 |
| 前端-跨平台 | `cross-platform.test.ts` | Android ↔ Web 加密兼容 |
| 后端总计 | 3 文件 | 40 passed, 1 skipped（Redis 限流） |
| 前端总计 | 5 文件 | 104 passed, 3 failed（Android 兼容） |

## 八、限流与安全

| 功能 | 描述 |
|------|------|
| RateLimitMiddleware | IP/user 滑动窗口，JWT 解析 user_id 避免 NAT 误伤 |
| 白名单路径 | /health, /docs, /openapi.json 不限制 |
| 路径规则 | 严格端点（auth/login/register/recovery）100/小时，默认 500/小时 |
| Redis 故障 fail-open | 放行请求，避免限流故障锁死 |
| 426 Retry-After | 超限时返回 429 + 建议等待时间 |
| 登录侧信道防护 | 用户不存在时仍执行 bcrypt，返回统一错误 |
| 密码强度强制 | ≥12 字符 + 大写/小写/数字/特符 + 排除连续序列 |
| 认证与加密分离 | Auth Key（salt+"auth"）≠ 加密 Key（salt），防服务器密钥重放 |
| bcrypt 二次哈希 | 客户端 PBKDF2 输出再 bcrypt 后存储 |
| JWT type 校验 | 中间件强制 type="access"，防 refresh token 冒充 |
| 异常捕获收窄 | SMTPException/HTTPError/Timeout 替代裸 Exception |
| refresh token hash 常量时间 | `hmac.compare_digest` 不是 `!=` |
| 密码生成器 | Uint32Array 取模，减少偏差 |

## 九、数据模型

| 表 | 关键字段 |
|------|---------|
| users | id, email, phone, google_id, auth_key_hash, password_salt, kdf_settings(JSONB) |
| user_keys | user_id, password_wrapped, recovery_wrapped, encrypted_private, rsa_public_key |
| user_devices | user_id, device_name, device_public_key, device_wrapped |
| recovery_codes | user_id, recovery_code_hash, recovery_code_salt, status, pending_*, monthly_initiation_count, failed_attempt_count, failed_attempt_last_at |
| token_families | user_id, family, active_token_hash |
| items | id, user_id, client_did, type, icon, name, description, data, version, is_deleted, updated_at |

## 十、运维与部署

| 功能 | 描述 |
|------|------|
| 健康检查 | `GET /health`，验证 DB 可达性 |
| Alembic 迁移 | 7 个迁移文件，支持 upgrade/downgrade |
| Systemd 服务 | safebox.service，gunicorn + uvicorn worker |
| Apache 反代 | mod_proxy + mod_ssl，SPA FallbackResource |
| Redis 持久化 | rate/verification keys，不保存业务数据 |
| PostgreSQL | asyncpg 异步驱动，FOR UPDATE 行锁防竞态 |
| CORS | 通配符源时禁 credentials |
| deploy.sh | 本地调试用（rsync + 重启 + web 构建），不入 git |
| 数据库备份 | pg_dump + 30 天循环删除 cron |

## 十一、API 端点总览

| # | 方法 | 路径 | Auth | 限流 |
|---|------|------|------|------|
| 1 | GET | /health | 无 | - |
| 2 | GET | /auth/salt | 无 | - |
| 3 | POST | /auth/send-code | 无 | L2+L3 |
| 4 | POST | /auth/register/email | 无 | L2 |
| 5 | POST | /auth/register/phone | 无 | L2 |
| 6 | POST | /auth/register/google | 无 | L2 |
| 7 | POST | /auth/login/email | 无 | L1+L2 |
| 8 | POST | /auth/login/phone | 无 | L1+L2 |
| 9 | POST | /auth/login/google | 无 | L1+L2 |
| 10 | POST | /auth/change-password | Bearer | L2 |
| 11 | POST | /auth/reset-password | 无 | L2 |
| 12 | POST | /auth/recovery/generate | Bearer | L2 |
| 13 | POST | /auth/recovery/initiate | 无 | L2 |
| 14 | GET | /auth/recovery/status | 无 | L2 |
| 15 | POST | /auth/recovery/accelerate | 签名URL | L2 |
| 16 | POST | /auth/recovery/freeze | 签名URL | - |
| 17 | POST | /auth/recovery/revoke | Bearer | L2 |
| 18 | POST | /admin/recovery/unlock | Admin | L2 |
| 19 | POST | /auth/refresh-token | 无 | - |
| 20 | POST | /auth/logout | Bearer | - |
| 21 | DELETE | /auth/account | Bearer | L2 |
| 22 | POST | /auth/register-device | Bearer | - |
| 23 | GET | /sync/pull | Bearer | L2 |
| 24 | POST | /sync/push | Bearer | L2 |
| 25 | POST | /sync/delete | Bearer | L2 |

## 十二、安全配置（环境变量）

| 变量 | 说明 |
|------|------|
| `SAFEBOX_DATABASE_URL` | PostgreSQL 连接串（asyncpg） |
| `SAFEBOX_JWT_SECRET_KEY` | JWT HS256 签名密钥 |
| `SAFEBOX_RECOVERY_HMAC_KEY` | 恢复码 HMAC 服务端密钥（base64 32 字节） |
| `SAFEBOX_REDIS_URL` | Redis 连接串 |
| `SAFEBOX_SMTP_HOST/PORT/USERNAME/PASSWORD/FROM` | SMTP 邮件配置 |
| `SAFEBOX_TWILIO_ACCOUNT_SID/AUTH_TOKEN/PHONE_NUMBER` | Twilio 短信配置 |
| `SAFEBOX_GOOGLE_CLIENT_ID` | Google OAuth Client ID |
| `SAFEBOX_CORS_ORIGINS` | CORS 允许的源，逗号分隔，`*` 为通配符 |
| `SAFEBOX_SYNC_BATCH_LIMIT` | 同步批量大小（默认 100） |
| `VITE_GOOGLE_CLIENT_ID` | 前端 Google OAuth Client ID（可覆盖硬编码值） |

## 十三、已规划但未实现

### 1. Web Worker PBKDF2 派生

**功能**：将 PBKDF2 密钥派生（600,000 次迭代）放到 Web Worker 后台线程执行，主线程不阻塞。

**应用场景**：
- 用户登录/注册时输入密码，客户端执行 PBKDF2-SHA256 600K 迭代派生 auth_key_hash 和加密密钥
- 600K 次迭代在主线程约耗时 1-3 秒，期间页面完全卡死（无响应、动画停滞、按钮点击无反馈）
- 移到 Worker 后，主线程保持流畅，可显示"派生中..."进度，用户感知是异步等待而非卡死
- 切换设备/弱性能手机（低端 Android）时尤其明显

**当前状态**：`kdf.ts` 直接在主线程调 `crypto.subtle.deriveBits`，`REFACTOR_PLAN.md` Step 1b 设计了 `kdf.worker.ts` 但未实现。

---

### 2. `/admin/recovery/unlock` 客服解锁端点

**功能**：管理员后台端点，客服核身后解除用户恢复码的永久锁定（permanently_locked），并发送重置链接到用户绑定邮箱。

**应用场景**：
- 用户恢复码连续输错 5 次 -> permanently_locked，自助无法恢复
- 用户月发起恢复超 3 次 -> permanently_locked
- 用户丢失恢复码 + 邮箱/手机不可用 -> 最后逃生通道
- 客服通过身份核验（如身份证、注册信息）后调用此端点解锁
- 系统发送 24h 有效重置链接到用户邮箱，用户生成新恢复码

**关键约束**：
- 客服不能获取恢复码明文（服务端只存 HMAC 哈希）
- 客服不能解密 vault（零知识边界）
- 客服不能直接设置新密码，只能发重置链接让用户自助
- 需要管理员权限（Admin token），非普通用户 token

**当前状态**：`API_CONTRACT.md` 定义了端点和请求/响应格式，但 `recovery.py` 未实现该端点，也没有 admin 权限体系。

---

### 3. 注册幂等性（idempotency_key）

**功能**：注册请求携带 `idempotency_key`（UUID），服务端记录该 key，相同 key 的重复请求返回首次结果而非创建新用户。

**应用场景**：
- 用户点"注册"后网络中断，客户端重试
- 用户误双击注册按钮，发两次请求
- 移动网络抖动导致请求重复发送
- 没有幂等性时：第二次注册会因邮箱已存在返回 409，但第一次可能已成功创建用户，客户端误以为失败又重试，造成困惑
- 有幂等性时：第二次请求识别为同一操作，直接返回首次的 token，用户无感完成注册

**实现方式**：
- 客户端 `crypto.randomUUID()` 生成 idempotency_key
- 服务端 Redis 记录 `{key: user_id, token}` 5 分钟过期
- 相同 key 的请求直接返回缓存结果

**当前状态**：`OVERALL_PLAN.md` 决策日志记录了此需求，`utils/idempotency.py` 在 MIGRATION_MAP 中提及但未实现，注册 schema 无 idempotency_key 字段。

---

### 4. Feature Flag 发布策略

**功能**：通过环境变量 `feature_flag_v2_crypto` 控制是否启用 v2 字段级加密写入，实现零数据风险回滚。

**应用场景**：
- 生产环境已有 v1（RSA 加密）的条目数据
- 部署 v2 代码（支持双读写）但开关关 -> 新条目仍写 v1，零风险
- 开开关 -> 新条目写 v2（AES-GCM + Item Key），旧条目按 encryption_version 回退解密
- 发现 bug -> 关开关，无需代码回滚，新条目回退写 v1，旧 v2 条目仍可读
- 稳定数周后删除 v1 代码和 Feature Flag

**三步部署**：
1. 代码部署（开关关）：支持双读写，行为不变
2. 开开关：新条目走 v2
3. 稳定后清理：删 v1 代码 + Feature Flag

**当前状态**：调试阶段直接全量 v2（无 v1 兼容），不需要 Feature Flag。`REFACTOR_PLAN.md` 有完整设计，生产上线时启用。

---

### 5. Argon2id KDF 支持

**功能：**`kdf.ts` 的 `KdfSettings` 类型已定义 Argon2id 变体（含 memory/iterations/parallelism 参数），但 `deriveBits` 未实现，fallback 到 PBKDF2。

**应用场景**：
- Argon2id 是 OWASP 2025 推荐的抗 GPU/ASIC 暴力破解 KDF
- PBKDF2 易被 GPU 并行加速，Argon2id 通过内存硬度抵抗
- 高安全要求的用户可选 Argon2id（牺牲性能换安全）
- 未来硬件加速 PBKDF2 成本降低时，可平滑迁移到 Argon2id

**迁移策略**：
- `kdf_settings` 字段已支持存储 Argon2id 参数
- 用户改密时可切换 KDF 算法
- 旧用户保持 PBKDF2，新用户可选 Argon2id

**当前状态**：类型定义和 fallback 逻辑已就绪，Web Crypto API 不原生支持 Argon2id，需引入 WASM 库（如 `hash-wasm`）。

---

### 6. 忘记密码时恢复账户

**功能**：用户忘记密码后恢复账户访问。

**v2 恢复码机制**：
- 恢复码 = **服务端身份验证凭据**（HMAC-SHA256 验证），**不参与客户端密钥派生**
- 客户端用新密码派生新密钥，生成新 User Key，用新密钥包裹
- 提交 `pending_wrapped_user_key`（新密码包裹的新 User Key）给服务端
- 进入 24h 冷却期，到期自动激活

**恢复流程**：
```
用户输入恢复码 + 设置新密码（一次性）
  ↓
客户端用新密码派生新密钥 + 生成新 User Key
  ↓
用新密钥包裹新 User Key -> pending_wrapped_user_key
  ↓
提交服务端 -> 24h 冷却期 -> 自动激活
```

**两条恢复路径**：

| 路径 | 身份验证 | 冷却期 | 适用 |
|------|---------|--------|------|
| `/auth/recovery/initiate` | 恢复码 HMAC | 24h + 加速/冻结 | 邮箱不可用，逃生通道 |
| `/auth/reset-password` | 邮箱验证码 | 无 | 邮箱可用，快速重置 |

**当前状态**：✅ **已实现**（`RecoveryPage.tsx`）。

---

### 7. Android 客户端

**功能**：SafeBox 的 Android 原生客户端，与 Web 客户端共享同一后端 API。

**应用场景**：
- 移动端用户使用密码管理器
- 离线场景（无网络时查看已同步条目）
- 生物识别解锁（指纹/Face ID 快速解锁）

**跨平台兼容**：
- Auth Key 派生：Android 与 Web 一致（PBKDF2(salt+"auth")）
- 条目加密：Android v1（RSA-4096）vs Web v2（AES-GCM + Item Key），Web 能读 Android 旧条目，Android 不能读 Web 新条目
- 恢复码：Android v1（客户端 SHA-256）vs Web v2（服务端 HMAC），不兼容需走客服通道

**当前状态**：独立项目（`app/` 目录），不在本次重构范围，代码存在但未与 v2 后端对齐。
