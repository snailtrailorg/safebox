# SafeBox 功能清单

## 一、用户认证

| 功能 | 描述 | 端点 |
|------|------|------|
| 邮箱注册 | 验证码 + 恢复码生成 + K 派生 + encrypted_user_key | `POST /auth/register/email` |
| 手机号注册 | 短信验证码 + 同上 | `POST /auth/register/phone` |
| Google 注册 | Google ID Token 验证 + 同上 | `POST /auth/register/google` |
| 邮箱登录 | authKey 比对 | `POST /auth/login/email` |
| 手机号登录 | 验证码 + authKey | `POST /auth/login/phone` |
| Google 登录 | Google ID Token + authKey | `POST /auth/login/google` |
| 密码校验 | 每次解锁服务端校验 authKey + password_version | `POST /auth/verify` |
| 改密 | 当前密码 + 验证码双因子，改登录密码 | `POST /auth/change-password` |
| GET salt | 返回 login_salt + kdf_settings + recovery_salt | `GET /auth/salt` |
| 设备注册 | 记录设备公钥 | `POST /auth/register-device` |
| 登出 | 撤销 refresh token | `POST /auth/logout` |
| 注销 | 验证码确认 | `DELETE /auth/account` |

## 二、密钥层次

| 功能 | 描述 |
|------|------|
| K 派生 | PBKDF2(恢复码 [+ 主密码], recovery_salt, 600k)，永久不变 |
| User Key | 随机 AES-256，包裹 Item Keys |
| encrypted_user_key | AES(K, User Key)，存服务器（K 不在服务器） |
| cached_K | AES(loginDerivedKey, K)，存本地 |
| authKey | PBKDF2(登录密码, login_salt+"auth")，服务端认证 |
| loginDerivedKey | PBKDF2(登录密码, login_salt)，本地缓存 K |
| 改登录密码 | 只重包 cached_K，K/User Key 不变 |
| 主密码（可选） | K 的加强因子，永久不可改 |
| PBKDF2 迭代数 | 600,000，可配置（kdf_settings） |

## 三、条目加密

| 功能 | 描述 |
|------|------|
| 字段级 AES-256-GCM | name、description、data 分别独立加密 |
| Item Key | 每条目独立随机 AES-256，User Key 包裹 |
| EncryptedField | `{encrypted_key, ciphertext}` |
| AAD | `safebox:v2:item:{fieldName}:{itemType}`，防密文替换 |
| 文件加密 | AES-GCM(User Key, 文件内容)，存 IndexedDB |

## 四、恢复码机制

| 功能 | 描述 | 端点 |
|------|------|------|
| 恢复码生成 | BIP39 12 词（132bit），注册时生成，展示一次 | 注册时 |
| HMAC 验证 | HMAC-SHA256(server_key, salt+mnemonic) | initiate |
| 两步 initiate | 步骤1验码返回 encrypted_user_key + initiate_token / 步骤2 confirm 写正式 | `POST /auth/recovery/initiate` + `/confirm` |
| 冷却期 24h | cooldown_until = now+24h，账户锁定 | confirm |
| 加速通道 | 验证码 + 签名 token 解除冷却 | `POST /auth/recovery/accelerate` |
| 冻结 | 签名 token 回滚旧密码 | `POST /auth/recovery/freeze` |
| 状态查询 | 返回状态 + cooldown | `GET /auth/recovery/status` |
| 主动作废 | 需验证码 + 当前密码 | `POST /auth/recovery/revoke` |
| 无失败锁定 | 恢复码 132bit 不可暴破，不累积计数、不锁定 | initiate |
| 冷却零窗口 | revoke refresh + 中间件冷却门挡所有 access-token | confirm + middleware |

## 五、条目同步

| 功能 | 描述 | 端点 |
|------|------|------|
| push | 批量创建/更新，server_id 优先匹配 | `POST /sync/push` |
| 乐观并发 | version 基线匹配才接受，否则 conflict | sync_push |
| 冲突用户选择 | keepLocal 重 push / useServer 应用服务端版本 | 前端 |
| pull | since 游标 + limit 分页 | `GET /sync/pull` |
| 软删除 | is_deleted=true | `POST /sync/delete` |
| push-then-pull | 先推本地修改后拉服务端更新 | 前端 sync() |

## 六、验证码系统

| 功能 | 描述 |
|------|------|
| 6 位随机数字 | 5 分钟过期 |
| Redis 存储 | key 格式 `vc:{target}:{value}` |
| 原子消费 | GETDEL 防 TOCTOU |
| 60s 限流 | 同一目标 60s 内只能发一次 |
| SMTP 邮件 | Gmail SMTP，dev 模式打印日志 |
| 改密需验证码 | 当前密码 + 验证码双因子 |
| 注销需验证码 | 验证码确认身份 |

## 七、限流与安全

| 功能 | 描述 |
|------|------|
| RateLimitMiddleware | IP/user 滑动窗口 |
| 白名单 | /health, /docs, /openapi.json |
| 严格端点 | auth/login/register/recovery 100/h |
| 默认 | 500/h |
| Redis fail-open | 限流故障不锁死 |
| 登录防枚举 | 不存在用户也跑 bcrypt + 返回假盐 |
| salt 防枚举 | 不存在用户返回 HMAC 派生确定性 salt |
| 密码强度 | ≥12 字符 + 大小写/数字/特符 |
| JWT type 校验 | 中间件强制 type="access" |
| refresh rotation | TokenFamily + FOR UPDATE + 重放全线失效 |
| 冷却门 | require_not_in_cooldown 挂数据访问端点 |

## 八、前端功能

| 功能 | 描述 |
|------|------|
| 登录页 | 三种登录方式 Tab |
| 注册页 | 三种注册方式 Tab + 恢复码展示（一次） |
| 恢复页 | 两步 initiate + 冷却倒计时 |
| 密码库列表 | 条目列表 + FAB 新建 + 左滑删除 |
| 条目详情/编辑 | 5 种类型（login/card/identity/note/file） |
| 改密页 | 当前密码 + 验证码 + 新密码 |
| 自动锁定 | useAutoLock，空闲/失焦超时 |
| IndexedDB | session + items + fileBlobs |
| keyChain 单例 | User Key / Item Key 生命周期 |
| i18n | 中/英双语 |

## 九、数据模型

| 表 | 关键字段 |
|------|---------|
| users | id, email, phone, google_id, auth_key_hash, login_salt, kdf_settings, password_version, has_master_password |
| user_keys | user_id, encrypted_user_key, recovery_salt |
| recovery_codes | user_id, recovery_code_hash, recovery_code_salt, status, cooldown_until, rollback_*, pending_initiate_* |
| token_families | user_id, family, active_token_hash |
| items | id, user_id, client_did, type, name(EncryptedField JSON), description, data, version, is_deleted |

## 十、运维

| 功能 | 描述 |
|------|------|
| 健康检查 | `GET /health` |
| Alembic 迁移 | 4 个迁移文件 |
| Systemd | gunicorn + uvicorn worker |
| Apache 反代 | mod_proxy + mod_ssl + SPA fallback |
| deploy.sh | rsync + 重启（排除 .env/venv） |
