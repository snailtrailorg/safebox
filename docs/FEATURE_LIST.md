# SafeBox 功能清单

> 与代码交叉核对后的当前系统功能。引用代码以 `server/app/` 与 `web/src/` 为准。

## 一、用户认证

| 功能 | 描述 | 端点 |
|------|------|------|
| 邮箱注册 | 验证码 + 客户端生成助记词 + 派生 K + encrypted_user_key | `POST /auth/register/email` |
| 手机号注册 | 短信验证码 + 同上 | `POST /auth/register/phone` |
| Google 注册 | Google ID Token 验证（不验验证码）+ 同上 | `POST /auth/register/google` |
| 邮箱登录 | authKey 比对 | `POST /auth/login/email` |
| 手机号登录 | 验证码 + authKey | `POST /auth/login/phone` |
| Google 登录 | 仅凭 Google ID Token 登录（不校验 authKey） | `POST /auth/login/google` |
| 改密 | 当前密码 + 验证码双因子，改 authKey + local_salt + 重新包裹 encrypted_user_key（K 变，需助记词） | `POST /auth/change-password` |
| GET salt | 返回 local_salt + kdf_settings + mnemonic_salt | `GET /auth/salt` |
| 设备注册 | 已登录用户添加设备（合并主密码模型下字段值为占位） | `POST /auth/register-device` |
| 登出 | 撤销该用户所有 token family | `POST /auth/logout` |
| 注销 | 验证码确认 | `DELETE /auth/account` |
| refresh 轮换 | TokenFamily + FOR UPDATE 行锁，重放全线失效 | `POST /auth/refresh-token` |

> 注册请求体含 `device_name / device_public_key / device_wrapped`（optional，合并主密码模型下传占位值 `"web"` / `"Web Browser"`）。

## 二、密钥层次（合并主密码模型）

| 功能 | 描述 |
|------|------|
| K 派生 | `K = PBKDF2(助记词+主密码, mnemonic_salt, 600k)`，永久不变，K 不存服务器 |
| User Key | 随机 AES-256，包裹 Item Keys |
| encrypted_user_key | `AES(K, User Key)`，存服务器 |
| cached_K | `AES(localDerivedKey, K)`，存本地 IndexedDB session store |
| authKey | `PBKDF2(主密码, local_salt+"auth", 600k)` base64，服务端认证（bcrypt） |
| localDerivedKey | `PBKDF2(主密码, local_salt, 600k)`，本地缓存 K |
| 改主密码 | K 变（主密码参与派生），需助记词重派生 K + 重新包裹 encrypted_user_key + 新 cached_K（`changeMasterPassword`，替代 `rewrapCachedK`） |
| 助记词解锁 | `K = PBKDF2(助记词+主密码, mnemonic_salt)` → 解 encrypted_user_key → User Key |
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

## 四、助记词机制

| 功能 | 描述 | 端点 |
|------|------|------|
| 助记词生成 | 客户端 BIP39 12 词（132bit），注册时生成并上传明文，模态框展示一次 | 注册时（RegisterPage） |
| mnemonic_hmac_salt | 客户端生成（32 字节 hex），随注册上传，HMAC 验码用盐 | 注册时 |
| HMAC 验证 | `HMAC-SHA256(server_key, salt + normalized_mnemonic)` hex 存储 | initiate |
| initiate | 验助记词返回 encrypted_user_key + mnemonic_salt（换设备用；web 实际走 login + recoverAndRewrap，端点为死代码） | `POST /auth/recovery/initiate` |
| 无失败锁定 | 助记词 132bit 不可暴破，不累积计数、不锁定 | initiate |
| 忘主密码 | 主密码参与 K 派生，忘主密码 = 数据丢失（无恢复，无冷却/加速/冻结） | - |

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
| CORS | 通配符源时 disable credentials |
| Google OAuth | 未配置 `google_client_id` 抛 RuntimeError |

## 八、前端功能

| 功能 | 描述 |
|------|------|
| 登录页 | 三种登录方式 Tab | `/login` |
| 注册页 | 三种注册方式 Tab + 助记词模态框展示一次 | `/register` |
| 恢复页 | 换设备：助记词 + 主密码派生 K 解 encrypted_user_key + 建本地缓存 | `/recovery` |
| 密码库列表 | 条目列表 + FAB 新建 + 左滑删除 | `/` |
| 条目详情 | 5 种类型查看 | `/item/:did` |
| 条目编辑 | 新建显示类型选择器（radio 横排 + 说明），编辑跳过 | `/item/new/:type`、`/item/:did/edit` |
| 改密页 | 当前密码 + 验证码 + 新密码 | `/settings/change-password` |
| 备份导出 | JSON → AES-256-GCM(PBKDF2(backupPassword, salt)) → `.safebox` 文件 | `/settings/export` |
| 备份导入 | 解密 .safebox 还原条目（置脏触发同步） | `/settings/import` |
| 自动锁定 | useAutoLock，20 分钟空闲超时，提前 60 秒倒计时告警 | 全局 |
| IndexedDB | session + items（by-uid/by-serverId/by-dirty 索引）+ fileBlobs |
| keyChain 单例 | generateKeys(mnemonic, masterPassword) / unlockWithPassword / unlockFromMnemonic / recoverAndRewrap / changeMasterPassword / encryptItemField / decryptItemField / encryptFileBlob / decryptFileBlob |
| i18n | 中/英双语，navigator.language 检测 |
| AuthGuard/GuestGuard | 路由守卫；401 自动 refresh token |

## 九、数据模型

| 表 | 关键字段 |
|------|---------|
| users | id, email, phone, google_id, local_password_hash, local_salt, kdf_settings, created_at, updated_at |
| user_keys | user_id, encrypted_user_key, mnemonic_salt, created_at, updated_at |
| mnemonics | user_id, mnemonic_hash, mnemonic_hmac_salt, created_at |
| token_families | user_id, family, active_token_hash, used_at |
| user_devices | user_id, device_name, device_public_key, device_wrapped, last_active_at |
| items | id, user_id, client_did, type, icon, name(EncryptedField JSON), description, data, version, is_deleted, updated_at, created_at |

## 十、健康检查

| 功能 | 描述 | 端点 |
|------|------|------|
| 健康检查 | `GET /health` -> `{status:"ok"}` | `GET /health` |

## 十一、已知限制与技术债

| 项 | 说明 |
|------|------|
| register-device 占位 | 合并主密码模型下跨设备用助记词，`device_public_key/device_wrapped` 传占位值 `"web"` |
| RSA 工具死代码 | `crypto/rsa.ts` 保留但全项目无引用；keyChain 无 RSA v1 兼容函数 |
| 文件 blob 不同步 | 多设备间文件内容不同步，仅元数据同步 |
| logout 不清本地密钥 | 退出只清 token，保留 cached_K / encrypted_user_key（重新登录可解锁） |
| sync_batch_limit | config.py 声明=100，但代码未引用（pull limit 用 Query 默认，max 500 硬编码） |
| Google Client ID | 前端 constants.ts 有调试 fallback 写死在 bundle 内 |
| 登录限流无 8 秒档 | 实际序列 0,0,1,2,4 → 锁 1h |
| 助记词永久有效 | 不过期/不重置/不重生成；无作废机制（revoke 端点已移除，助记词不可主动作废） |
