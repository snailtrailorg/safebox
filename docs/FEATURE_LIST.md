# SafeBox 功能清单

与代码交叉核对后的当前系统功能。引用代码以 `server/app/` 与 `web/src/` 为准。

## 一、用户认证（SRP-6a + 2SKD）

| 功能 | 描述 | 端点 |
|------|------|------|
| 邮箱注册 | 验证码 + 客户端派生 SRP verifier + encrypted_user_key + 建设备 | `POST /auth/register/email` |
| 手机号注册 | 短信验证码 + 同上 | `POST /auth/register/phone` |
| SRP 登录第一步 | 客户端发 A + device_id?/device_name?，服务端返 B + session_id（Redis 5min） | `POST /auth/login/srp/challenge` |
| SRP 登录第二步 | 客户端发 M1，服务端验后返 M2 + token + device_id + 密钥材料，存 K_comm | `POST /auth/login/srp/verify` |
| 改密 | fresh token（前置 SRP）+ 验证码 + 新 SRP 材料 + 清其他 device K | `POST /auth/change-password` |
| GET salt | 返回 srp_salt/local_salt/mnemonic_salt/kdf_settings/N/g（防枚举） | `GET /auth/salt` |
| 登出 | 撤销所有 token family + 清所有 device session_key（client 清缓存，决策 A） | `POST /auth/logout` |
| 注销 | fresh token + 验证码，FK 级联删 | `DELETE /auth/account` |
| refresh 轮换 | TokenFamily + FOR UPDATE 行锁 + 续 K_comm TTL | `POST /auth/refresh-token` |

> 注册请求含 `device_name`/`device_public_key`/`device_wrapped`（占位）。助记词不上传。

## 二、密钥层次（SRP + 合并主密码 + K 通信）

| 功能 | 描述 |
|------|------|
| SRP x 派生（2SKD） | `x = PBKDF2(主密码, HKDF拉伸(srp_salt,邮箱), 600k) XOR HKDF(助记词, salt=邮箱)` |
| SRP verifier | `v = g^x mod N`，客户端派生，存服务器（hex） |
| 派生 K | `K = PBKDF2(助记词+主密码, mnemonic_salt, 600k)`，永久不变，不存服务器 |
| 通信 K_comm | `H(S)`（SRP 握手），session 级 30 天，存 Redis session_key + client IndexedDB |
| User Key | 随机 AES-256，包裹 Item Keys |
| encrypted_user_key | `AES(K, UserKey)`，存服务器 |
| cached_K | `AES(localDerivedKey, K)`，存本地（lock/unlock 用） |
| mnemonic_encrypted | `AES(localDerivedKey, 助记词)`，存本地（同设备登录算 x 用） |
| localDerivedKey | `PBKDF2(主密码, local_salt, 600k)` |
| 改主密码 | K 变 + verifier 变，需助记词+邮箱重派生（changeMasterPassword） |
| 助记词解锁 | `K = PBKDF2(助记词+主密码, mnemonic_salt)` -> 解 encrypted_user_key -> UserKey |
| PBKDF2 迭代 | 600,000，可配置（kdf_settings JSON） |
| SRP 参数 | RFC 3526 4096-bit N + g=2 + SHA-256，前后端逐字节一致 |

## 三、条目加密（v2 EncryptedField）

| 功能 | 描述 |
|------|------|
| 字段级 AES-256-GCM | name/description/data 三字段各自独立加密 |
| Item Key | 每条目独立随机 AES-256，UserKey 包裹 |
| EncryptedField | `{encrypted_key, ciphertext}`，JSON 序列化存 items 列 / sync 传输 |
| AAD | `safebox:v2:item:{fieldName}:{itemType}`，防密文替换 |
| AES-GCM 参数 | 12 字节随机 nonce，128 位 tag |
| 文件加密 | `AES-GCM(UserKey, 内容)`，存 IndexedDB（不同步，仅元数据同步） |
| 条目类型 | 5 种：login/card/identity/note/file |

## 四、三态 session + 助记词机制

| 功能 | 描述 |
|------|------|
| 助记词生成 | BIP39 12 词（132bit），客户端本地生成，不上传，模态展示一次 |
| 加密缓存 | mnemonic_encrypted = AES(localDerivedKey, 助记词) 存 IndexedDB |
| 2SKD | 助记词参与 SRP x 派生（HKDF 项），= Secret Key |
| login（SRP） | 主密码+助记词（或同设备缓存取）SRP 握手建 session + K_comm |
| lock（autoLock） | 20min 空闲 -> keyChain.lock() 清内存 UserKey，不清 session |
| unlock | 输主密码本地解 cached_K（不走 SRP，K_comm 不变） |
| logout（决策 A） | 清整个 session（cached_K+mnemonic_encrypted+session_K+token），重登走 RecoveryPage |
| 换设备 | 助记词+主密码 SRP + recoverAndRewrap 重建缓存 | `/recovery` |
| 忘主密码 | 数据丢失（无恢复） | - |

## 五、条目同步

| 功能 | 描述 | 端点 |
|------|------|------|
| push-then-pull | 先推本地修改（含删除）后拉服务端更新 | 前端 sync() |
| push | 批量创建/更新，server_id 优先回退 client_did | `POST /sync/push` |
| 乐观并发 | version 基线相等才接受，否则 conflict | sync_push |
| 冲突用户选择 | keepLocal 重 push / useServer 应用服务端版本 | 前端 |
| pull | since + since_id 复合游标 + limit 分页（默认 100，max 500） | `GET /sync/pull` |
| 软删除 | is_deleted=true，墓碑随 pull 下发 | `POST /sync/delete` |

## 六、验证码系统

| 功能 | 描述 |
|------|------|
| 6 位随机数字 | 5 分钟过期 |
| Redis 存储 | key `vc:{target}:{value}`（绑 target，不绑 session，跨客户端共享） |
| 原子消费 | GETDEL 防 TOCTOU |
| 60s 限流 | 同一 target 60s 内只能发一次 |
| SMTP 邮件 | 配置 smtp_host；未配置 dev 打印；改密通知 BackgroundTasks 异步不阻塞 |
| SMS | 配置 Twilio；未配置 dev 打印 |
| 改密需验证码 | fresh token + 验证码双因子 |
| 注销需验证码 | 验证码确认身份 |

## 七、限流与安全

| 功能 | 描述 |
|------|------|
| RateLimitMiddleware | 已认证按 user_id，否则按 IP（X-Real-IP）；滑动窗口 ZSET |
| 白名单 | /health, /docs, /openapi.json, /redoc |
| 严格端点 | /auth/login、/auth/register -> 100/h |
| 默认 | 500/h |
| Redis fail-open | 限流故障不锁死 |
| 登录限流 | 退避 0,0,1,2,4 秒 -> 第 5 次锁 1h（按目标，第 1 次不限制） |
| SRP 防枚举 | 不存在用户返 fake verifier，verify 必失败（401 统一） |
| /salt 防枚举 | 不存在用户返 HMAC 派生确定性 salt |
| 密码强度 | ≥12 字符 + 大小写 + 数字 + 特符 + 防连续序列 |
| JWT type 校验 | 中间件强制 type="access"，防 refresh 冒充 |
| JWT 参数 | access 30min / refresh 30 天，HS256 |
| refresh rotation | TokenFamily + FOR UPDATE + 重放全线失效 |
| K 通信 session 级 | K_comm 30 天，不存拒 401（防 downgrade），纯 ASGI middleware |
| device deauthorize | device_id 绑 token + Redis revoked（access 立即失效） |
| CORS | 通配符源时 disable credentials |

## 八、前端功能

| 功能 | 描述 |
|------|------|
| 登录页 | email/phone（SRP 两步，同设备 device_id/新设备 device_name） | `/login` |
| 注册页 | email/phone 两 Tab + 助记词模态 + 确认后 SRP 建 K | `/register` |
| 恢复页 | 换设备/logout 后重登：助记词+主密码 SRP + recoverAndRewrap | `/recovery` |
| 密码库列表 | 条目列表 + FAB 新建 + 左滑删除 | `/` |
| 条目详情 | 5 种类型查看 | `/item/:did` |
| 条目编辑 | 新建显示类型选择器，编辑跳过 | `/item/new/:type`、`/item/:did/edit` |
| 改密页 | 前置 SRP 登录 + 验证码 + 新密码 | `/settings/change-password` |
| 设备管理 | 设备列表（client_name/os_name/last_auth_ip）+ deauthorize | `/settings/devices` |
| 备份导出 | JSON -> AES-GCM(PBKDF2(backupPassword)) -> .safebox | `/settings/export` |
| 备份导入 | 解密 .safebox 还原条目 | `/settings/import` |
| 自动锁定 | useAutoLock，20 分钟空闲，提前 60 秒倒计时 | 全局 |
| AuthGuard | 路由守卫 + UnlockScreen（unlock 失败提示引导 RecoveryPage） | - |
| IndexedDB | session（含 cached_K/mnemonic_encrypted/session_K/device_id）+ items + fileBlobs |
| keyChain 单例 | generateKeys/unlockWithPassword/getMnemonicFromCache/unlockFromMnemonic/recoverAndRewrap/changeMasterPassword/lock |
| performSrpLogin | 公共 SRP 登录逻辑（Login/Register/Recovery/ChangePassword 复用） |
| crypto/srp.ts | BigInt + Web Crypto，与后端逐字节一致 |
| crypto/transport.ts | K_comm 加解密（AES-GCM，与后端一致） |
| i18n | 中/英双语 |

## 九、数据模型

| 表 | 关键字段 |
|------|---------|
| users | id, email, phone, google_id, srp_verifier, srp_salt, local_salt, kdf_settings, created_at, updated_at |
| user_keys | user_id, encrypted_user_key, mnemonic_salt, created_at, updated_at |
| token_families | user_id, family, active_token_hash, device_id(FK), used_at |
| user_devices | user_id, device_name, device_public_key, device_wrapped, client_name, os_name, last_auth_ip, is_revoked, revoked_at, last_active_at, created_at, updated_at |
| items | id, user_id, client_did, type, icon, name(EncryptedField), description, data, version, is_deleted, updated_at, created_at |

> `mnemonics` 表已删（SRP 改造，助记词不上传）。`register-device` 端点已删（register/verify 的 _resolve_device 已建 device）。

## 十、健康检查

| 功能 | 描述 | 端点 |
|------|------|------|
| 健康检查 | `GET /health` -> `{status:"ok"}` | `GET /health` |

## 十一、Phase 2：device + K 通信（对标 1Password）

| 功能 | 描述 | 端点 |
|------|------|------|
| device_id 绑 token | access/refresh 含 device_id claim；UserDevice 加 is_revoked/revoked_at/updated_at + client_name/os_name/last_auth_ip | - |
| 设备列表 | 当前用户所有设备（含 client_name/os_name/last_auth_ip/is_current/is_revoked/last_active_at） | GET /auth/devices |
| deauthorize | 撤销设备（access 立即失效，Redis revoked TTL 30min；删该 device TokenFamily） | DELETE /auth/devices/{id} |
| 改密踢其他设备 | change-password 清其他 device session_key（当前保留）-> 其他设备 401 重登 RecoveryPage | POST /auth/change-password |
| SRP K 通信加密 | 认证 body + 响应 AES-256-GCM(K_comm) 加密（session 级 30 天，不存拒 401；强制 X-Safebox-Encrypted 防 downgrade；纯 ASGI middleware） | middleware |

对标 1Password SRP+GCM 传输层（白皮书 L1706/L1948）。不做：分享（RSA）、device_key 并行 UserKey（SSO 专用）、每请求 Ed25519 签名。

## 十二、已知限制与技术债

| 项 | 说明 |
|------|------|
| RSA 工具死代码 | `crypto/rsa.ts` 保留但全项目无引用 |
| 文件 blob 不同步 | 多设备间文件内容不同步，仅元数据同步 |
| logout 清本地密钥 | 决策 A：退出清 cached_K/mnemonic_encrypted/session_K，重登需助记词+主密码（走 RecoveryPage） |
| sync_batch_limit | config.py 声明=100，代码未引用（pull limit 用 Query 默认，max 500 硬编码） |
| 登录限流无 8 秒档 | 实际序列 0,0,1,2,4 -> 锁 1h |
| 助记词永久有效 | 不过期/不重置/不重生成；无作废机制 |
| K 通信 replay | per-message replay 未做（GCM tag 防篡改不防重放，与白皮书一致待改进） |
