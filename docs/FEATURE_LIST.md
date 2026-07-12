# SafeBox 功能清单

> 与代码交叉核对后的当前系统功能。引用代码以 `server/app/` 与 `web/src/` 为准。

## 一、用户认证

| 功能 | 描述 | 端点 |
|------|------|------|
| 邮箱注册 | 验证码 + 客户端生成恢复码 + 派生 K + encrypted_user_key | `POST /auth/register/email` |
| 手机号注册 | 短信验证码 + 同上 | `POST /auth/register/phone` |
| Google 注册 | Google ID Token 验证（不验验证码）+ 同上 | `POST /auth/register/google` |
| 邮箱登录 | authKey 比对 | `POST /auth/login/email` |
| 手机号登录 | 验证码 + authKey | `POST /auth/login/phone` |
| Google 登录 | 仅凭 Google ID Token 登录（不校验 authKey） | `POST /auth/login/google` |
| 密码校验 | 每次解锁服务端校验 authKey + password_version | `POST /auth/verify` |
| 改密 | 当前密码 + 验证码双因子，改 authKey + login_salt + password_version+1 | `POST /auth/change-password` |
| GET salt | 返回 login_salt + kdf_settings + recovery_salt + has_master_password | `GET /auth/salt` |
| 设备注册 | 已登录用户添加设备（串行化模型下字段值为占位） | `POST /auth/register-device` |
| 登出 | 撤销该用户所有 token family | `POST /auth/logout` |
| 注销 | 验证码确认 | `DELETE /auth/account` |
| refresh 轮换 | TokenFamily + FOR UPDATE 行锁，重放全线失效 | `POST /auth/refresh-token` |

> 注册请求体含 `device_name / device_public_key / device_wrapped`（optional，串行化模型下传占位值 `"web"` / `"Web Browser"`）。

## 二、密钥层次（模型 D 串行化）

| 功能 | 描述 |
|------|------|
| K 派生 | `K = PBKDF2(恢复码 [+ 主密码], recovery_salt, 600k)`，永久不变，K 不存服务器 |
| User Key | 随机 AES-256，包裹 Item Keys |
| encrypted_user_key | `AES(K, User Key)`，存服务器 |
| cached_K | `AES(loginDerivedKey, K)`，存本地 IndexedDB session store |
| authKey | `PBKDF2(登录密码, login_salt+"auth", 600k)` base64，服务端认证（bcrypt） |
| loginDerivedKey | `PBKDF2(登录密码, login_salt, 600k)`，本地缓存 K |
| 改登录密码 | K/User Key 不变，本地重包 cached_K（`rewrapCachedK`） |
| 主密码（可选） | K 的加强因子，永久不可改；当前 UI 默认空（`has_master_password=false`） |
| 恢复码解锁 | `K = PBKDF2(恢复码, recovery_salt)` → 解 encrypted_user_key → User Key |
| PBKDF2 迭代数 | 600,000，可配置（`kdf_settings` JSON：`{algorithm, iterations}`） |
| auth salt 域 | `deriveAuthKey` 在 salt 后追加 4 字节 `"auth"`，与 authKey 派生隔离 |

## 三、条目加密

| 功能 | 描述 |
|------|------|
| 字段级 AES-256-GCM | name / description / data 三字段各自独立加密 |
| Item Key | 每条目独立随机 AES-256，User Key 包裹 |
| EncryptedField | `{encrypted_key, ciphertext}`，JSON 序列化后存 items 列 / sync 传输 |
| AAD | `safebox:v2:item:{fieldName}:{itemType}`，字段名集 = {name, description, data} |
| AES-GCM 参数 | 12 字节随机 nonce，128 位 tag |
| 文件加密 | `AES-GCM(User Key, 文件内容)`，存 IndexedDB `fileBlobs` store |
| 文件 blob 不同步 | 仅元数据（fileName/size/type 进 data 字段）走 sync，文件内容本地存储 |

## 四、恢复码机制

| 功能 | 描述 | 端点 |
|------|------|------|
| 恢复码生成 | 客户端 BIP39 12 词（132bit），注册时生成并上传明文，模态框展示一次 | 注册时（RegisterPage） |
| recovery_code_salt | 客户端生成（32 字节 hex），随注册上传，HMAC 验码用盐 | 注册时 |
| HMAC 验证 | `HMAC-SHA256(server_key, salt + normalized_mnemonic)` hex 存储 | initiate |
| 两步 initiate | 步骤1 验码返回 encrypted_user_key + recovery_salt + initiate_token（15min）/ 步骤2 confirm 写正式 | `POST /auth/recovery/initiate` + `/confirm` |
| 冷却期 24h | confirm 时 `status=cooldown, cooldown_until=now+24h`，吊销所有 token | confirm |
| 加速通道 | 验证码 + 签名 token 立即解除冷却 | `POST /auth/recovery/accelerate` |
| 冻结 | 签名 token 回滚旧 authKey + login_salt + password_version | `POST /auth/recovery/freeze` |
| 状态查询 | 返回 status + cooldown_until（纯读，不挂冷却门） | `GET /auth/recovery/status` |
| 主动作废 | 验证码 + 当前密码；实现置 status=active（不删行、不重置 hash） | `POST /auth/recovery/revoke` |
| 无失败锁定 | 恢复码 132bit 不可暴破，不累积计数、不锁定 | initiate |
| 冷却零窗口 | revoke refresh + `require_not_in_cooldown` 中间件挡 sync/register-device/account/change-password/revoke | confirm + middleware |
| 签名 token | JWT HS256，密钥 `recovery_signing_key`（未配置回退 `jwt_secret_key`），24h | accelerate/freeze |

## 五、条目同步

| 功能 | 描述 | 端点 |
|------|------|------|
| push-then-pull | 先推本地修改（含删除）后拉服务端更新 | 前端 `sync()` |
| push | 批量创建/更新，server_id 优先匹配回退 client_did | `POST /sync/push` |
| 乐观并发 | version 基线相等才接受，否则 conflict（不依赖时钟） | sync_push |
| 冲突用户选择 | keepLocal 重 push / useServer 应用服务端版本 | 前端 |
| pull | since 游标（服务端 updated_at）+ limit 分页（默认 100，max 500） | `GET /sync/pull` |
| 软删除 | `is_deleted=true`，墓碑随 pull 下发 | `POST /sync/delete` |
| 删除 push | 本地已删除条目通知服务端软删除；从未同步就删除的清本地脏标记 | 前端 |

## 六、验证码系统

| 功能 | 描述 |
|------|------|
| 6 位随机数字 | 5 分钟过期 |
| Redis 存储 | key 格式 `vc:{target}:{value}` |
| 原子消费 | GETDEL 防 TOCTOU |
| 60s 限流 | 同一目标 60s 内只能发一次 |
| SMTP 邮件 | 配置 smtp_host/username；未配置时 dev 模式打印日志 |
| SMS | 配置 Twilio；未配置时 dev 模式打印日志 |
| 改密需验证码 | 当前密码 + 验证码双因子 |
| 注销需验证码 | 验证码确认身份 |

## 七、限流与安全

| 功能 | 描述 |
|------|------|
| RateLimitMiddleware | 已认证按 user_id，否则按 IP（X-Real-IP）；滑动窗口 ZSET |
| 白名单 | /health, /docs, /openapi.json, /redoc |
| 严格端点 | /auth/login、/auth/register、/auth/recovery → 100/h |
| 默认 | 500/h |
| Redis fail-open | 限流故障不锁死 |
| 登录限流 | 退避 0,0,1,2,4 秒 → 第 5 次锁 1h（按目标，第 1 次不限制） |
| 登录防枚举 | 不存在用户也跑 bcrypt + 返回确定性伪造 salt |
| /salt 防枚举 | 不存在用户返回 HMAC 派生确定性 salt |
| 密码强度 | ≥12 字符 + 大小写 + 数字 + 特符 + 防连续序列 |
| JWT type 校验 | 中间件强制 type="access"，防 refresh 冒充 |
| JWT 参数 | access 30 分钟 / refresh 30 天，HS256 |
| refresh rotation | TokenFamily + FOR UPDATE + 重放全线失效 |
| 冷却门 | `require_not_in_cooldown` 挂数据访问端点 |
| CORS | 通配符源时 disable credentials |
| Google OAuth | 未配置 `google_client_id` 抛 RuntimeError |

## 八、前端功能

| 功能 | 描述 |
|------|------|
| 登录页 | 三种登录方式 Tab | `/login` |
| 注册页 | 三种注册方式 Tab + 恢复码模态框展示一次 | `/register` |
| 恢复页 | 两步 initiate + 冷却倒计时 | `/recovery` |
| 密码库列表 | 条目列表 + FAB 新建 + 左滑删除 | `/` |
| 条目详情 | 5 种类型查看 | `/item/:did` |
| 条目编辑 | 新建显示类型选择器（radio 横排 + 说明），编辑跳过 | `/item/new/:type`、`/item/:did/edit` |
| 改密页 | 当前密码 + 验证码 + 新密码 | `/settings/change-password` |
| 备份导出 | JSON → AES-256-GCM(PBKDF2(backupPassword, salt)) → `.safebox` 文件 | `/settings/export` |
| 备份导入 | 解密 .safebox 还原条目（置脏触发同步） | `/settings/import` |
| 自动锁定 | useAutoLock，20 分钟空闲超时，提前 60 秒倒计时告警 | 全局 |
| IndexedDB | session + items（by-uid/by-serverId/by-dirty 索引）+ fileBlobs |
| keyChain 单例 | generateKeys / unlockWithPassword / unlockFromRecoveryCode / rewrapCachedK / encryptItemField / decryptItemField / encryptFileBlob / decryptFileBlob |
| i18n | 中/英双语，navigator.language 检测 |
| AuthGuard/GuestGuard | 路由守卫；401 自动 refresh token |

## 九、数据模型

| 表 | 关键字段 |
|------|---------|
| users | id, email, phone, google_id, auth_key_hash, login_salt, kdf_settings, password_version, has_master_password, created_at, updated_at |
| user_keys | user_id, encrypted_user_key, recovery_salt, created_at, updated_at |
| recovery_codes | user_id, recovery_code_hash, recovery_code_salt, status, cooldown_until, rollback_auth_key_hash, rollback_login_salt, rollback_password_version, pending_initiate_token, pending_initiate_at, pending_new_auth_key_hash, pending_new_login_salt |
| token_families | user_id, family, active_token_hash, used_at |
| user_devices | user_id, device_name, device_public_key, device_wrapped, last_active_at |
| items | id, user_id, client_did, type, icon, name(EncryptedField JSON), description, data, version, is_deleted, updated_at, created_at |

## 十、运维

| 功能 | 描述 |
|------|------|
| 健康检查 | `GET /health` → `{status:"ok"}` |
| 后端迁移 | Alembic 4 个迁移：`17473000bd71 → b2c3d4e5f6a7 → c2d3e4f5a6b7 → e5f6g7h8i9j0` |
| 前端 schema | IndexedDB `DB_VERSION=1`，调试阶段保持，schema 变更手动清库 |
| 清库重建 | `DROP DATABASE...CREATE DATABASE` + `alembic upgrade head` |
| Systemd | gunicorn + uvicorn worker |
| Apache 反代 | mod_proxy + mod_ssl + SPA fallback |
| deploy.sh | rsync + 重启（排除 .env/venv，不装依赖不跑迁移） |

## 十一、已知限制与技术债

| 项 | 说明 |
|------|------|
| register-device 占位 | 串行化模型下跨设备用恢复码，`device_public_key/device_wrapped` 传占位值 `"web"` |
| RSA 工具死代码 | `crypto/rsa.ts` 保留但全项目无引用；keyChain 无 RSA v1 兼容函数 |
| 文件 blob 不同步 | 多设备间文件内容不同步，仅元数据同步 |
| logout 不清本地密钥 | 退出只清 token，保留 cached_K / encrypted_user_key（重新登录可解锁） |
| recovery_signing_key | 代码 `getattr` 回退，但 Settings 类未声明此字段，环境变量不生效 → 实际用 jwt_secret_key |
| sync_batch_limit | config.py 声明=100，但代码未引用（pull limit 用 Query 默认，max 500 硬编码） |
| Google Client ID | 前端 constants.ts 有调试 fallback 写死在 bundle 内 |
| 死路由 | `/register/recovery` + RecoveryCodePage 无 navigate 指向，注册成功直接 `/` |
| 登录限流无 8 秒档 | 实际序列 0,0,1,2,4 → 锁 1h |
| 恢复码永久不重生成 | revoke 不重置 hash/salt，同一恢复码仍可用 |
