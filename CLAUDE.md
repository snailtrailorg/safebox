# SafeBox 项目约定

## 部署

- 部署四件套：`scripts/deploy-server.sh`（后端+重启）、`scripts/deploy-web.sh`（前端构建+推送+reload）、`scripts/migrate-db.sh`（升级 schema 保留数据）、`scripts/clear-db.sh`（清库重置丢数据）；均通过 `sudo -u michael` 调 michael 侧部署工具，不装依赖
- 直接 `./scripts/xxx.sh` 跑，脚本内 `sudo -u michael` 免密（sudoers 已配），**不要手动加 sudo**
- 不要碰 michael 的 `/home/michael/.local/bin/safebox-deploy.sh`（bernard 无权读/改）
- bernard 的 `sudo -u michael` 只放行 `safebox-deploy.sh`（不能跑别的命令）；服务器其他操作（如改 `.env`）要登录服务器手动做
- 服务器初始部署步骤见 `DEPLOY.md`
- 部署后验证：`curl -s http://127.0.0.1:8000/health`
- 推送到 GitHub 用 `spe git push github master`（需要代理）

## 技术约定

### 认证（SRP-6a + 2SKD）
- 服务端不存密码哈希，只存 SRP verifier（`users.srp_verifier`，hex）+ `srp_salt`
- SRP-6a：RFC 3526 4096-bit MODP group + SHA-256，自实现 `server/app/services/srp_service.py`（无外部 SRP 库，N 硬编码 1024 hex）
- 2SKD x 派生：`x = PBKDF2(主密码, HKDF拉伸(srp_salt,邮箱), 600k) XOR HKDF(助记词, salt=邮箱, info="safebox-srp-auth")`，助记词=Secret Key（双秘密，缺一不可）
- 登录两步：`POST /auth/login/srp/challenge`（A->B+session_id，存 Redis TTL 5min）+ `POST /auth/login/srp/verify`（M1->M2+token）；Google 登录 `/auth/login/google` 不走 SRP
- 改密/删号验旧密码：客户端先走 SRP 登录拿 fresh token，再调端点（端点只验 fresh token + 验证码）
- `bcrypt`/`passlib` 已移除；`hash_auth_key`/`verify_auth_key`/`deriveAuthKey` 已删
- 前端 `web/src/crypto/srp.ts`（BigInt + Web Crypto 自实现，与后端逐字节一致，固定向量交叉验证见 `tests/srp.test.ts`）
- 助记词加密缓存：`mnemonic_encrypted = AES(localDerivedKey, 助记词)` 存 IndexedDB，同设备登录解出算 SRP x

### 密钥派生（合并主密码模型：主密码=登录密码+Passphrase 合一，参与 K 派生，忘则数据丢失）
- `deriveKey(password, salt, kdf_settings?)` → 通用 PBKDF2-SHA256 派生 AES-256 密钥（`kdf.ts`）。用于三处：
  - 派生 K：`K = deriveKey(助记词+主密码, mnemonic_salt)` → 加密 User Key（`encrypted_user_key = AES(K, UserKey)`）
  - 派生 localDerivedKey：`deriveKey(主密码, local_salt)` → 本地缓存 K（`cached_K = AES(localDerivedKey, K)`）
  - 派生备份密钥：`deriveKey(备份密码, salt)` → 加密导出文件
- KDF 参数可配置：`{ algorithm: "pbkdf2", iterations: 600_000 }`，跟随账户存储在 `users.kdf_settings`（Text 列存 JSON）
- 认证走 SRP（见上），不再用 deriveAuthKey/local_password_hash

### 密钥管理（合并主密码模型）
- `keyChain`（`keychain/keyChain.ts`）是全局单例，管理 User Key 生命周期
- keyChain 提供：`generateKeys(mnemonic, masterPassword, email)`（产 srp_verifier/srp_salt/local_salt/encrypted_user_key/mnemonic_salt/cached_K/mnemonic_encrypted）、`unlockWithPassword`、`getMnemonicFromCache`（解 mnemonic 缓存供 SRP 登录）、`unlockFromMnemonic`、`recoverAndRewrap`（换设备：建 cached_K + mnemonic_encrypted）、`changeMasterPassword(mnemonic, email, mnemonicSalt, newMasterPassword, newLocalSalt)`（产 new_srp_verifier/new_srp_salt/new_cached_K/new_mnemonic_encrypted/new_encrypted_user_key）、`createItemKey`/`decryptItemKey`、`encryptItemField`/`decryptItemField`（AES-GCM + ItemKey）、`encryptFileBlob`/`decryptFileBlob`、`exportUserKeyRaw`、`lock`
- 改主密码：K 变（主密码参与派生）-> `changeMasterPassword` 重包裹 encrypted_user_key + 新 cached_K + 新 mnemonic_encrypted + 新 SRP verifier；需助记词+邮箱（派生新 K + 新 x）；旧主密码由前置 SRP 登录验（fresh token）
- `crypto/srp.ts`（BigInt + Web Crypto，与后端 `srp_service.py` 逐字节一致）：deriveX/computeVerifier/握手数学
- `services/keyManager.ts`、`crypto/pbkdf2.ts`、`deriveAuthKey` API **已删除**
- `crypto/rsa.ts`（RSA-OAEP 工具）保留但全项目无引用，属遗留死代码

### 助记词（SRP + 合并主密码模型）
- 客户端 BIP39 12 词本地生成（`web/src/crypto/bip39.ts`），**不上传服务端**（废除 mnemonics 表，SRP verifier 服务端验）
- 助记词 = Secret Key，参与 SRP x 派生（2SKD）+ K 派生（`K = deriveKey(助记词+主密码, mnemonic_salt)`）
- 同设备登录：助记词用 `localDerivedKey` 包裹存 IndexedDB（`mnemonic_encrypted`），登录时解出算 SRP x
- 换设备：用户输助记词（RecoveryPage），SRP 登录（x 含助记词）+ `recoverAndRewrap` 建缓存
- 忘主密码 = 数据丢失（主密码参与 K 派生，无法恢复）
- `POST /auth/recovery/initiate` 端点 + `recovery_service.py` + `models/mnemonic.py` 已删（死代码）
- 详见 `docs/RECOVERY_MECHANISM.md`（待第9步更新）

### 服务拆分
- `auth_service.py`：用户查询、`create_user_with_keys`（存 srp_verifier/srp_salt）；`hash_auth_key`/`verify_auth_key` 已删
- `srp_service.py`：SRP-6a + 2SKD 自实现（derive_x/compute_verifier/握手数学，RFC 3526 4096-bit N 硬编码）
- `token_service.py`：JWT 创建 + refresh rotation + 撤销
- `verification_service.py`：验证码 + 登录限流 + SRP session（Redis TTL 5min）
- `recovery_service.py` 已删（助记词不再服务端验）
- `bip39.py`：BIP39 2048 词表 + 生成函数（服务端保留，前端 `crypto/bip39.ts` 本地生成）

### 依赖管理
- SRP 自实现（`srp_service.py`），无外部 SRP 库（srptools/thinbus-srp 已卸载）
- `bcrypt`/`passlib` 已移除（认证改 SRP，不存密码哈希）
- JWT 库：PyJWT 2.10+（不用 python-jose，已停止维护））

### 数据库
- PostgreSQL + Redis
- 升级 schema（保留数据）: `./scripts/migrate-db.sh`（通过 `sudo -u michael` 调 migrate-pgsql：alembic upgrade，不停服务不丢数据）
- 清服务器库（推荐）: `./scripts/clear-db.sh`（通过 `sudo -u michael` 调 michael 侧工具：DROP/CREATE + alembic upgrade + Redis FLUSHALL + 重启，重置含迁移）
- 手动清库（本地/裸命令）: `sudo -u postgres psql -c 'DROP DATABASE IF EXISTS safebox; CREATE DATABASE safebox OWNER safebox;'`（服务器需先 `sudo systemctl stop safebox` 释放连接，否则 DROP 报 "being accessed by other users"）
- Alembic 迁移（本地/单独）: `cd server && PYTHONPATH=. venv/bin/alembic upgrade head`；服务器清库重置由 `clear-db.sh` 自动含迁移，无需手动
- 最新迁移 `f7a8b9c0d1e2_srp_auth.py`：DROP users.local_password_hash + ADD srp_verifier/srp_salt + DROP mnemonics 表（SRP 改造，清库重建跑全链）
- 注意: alembic 的 `script_location` 是相对路径，需要在 server/ 目录下执行

### 安全
- Google OAuth：生产环境必须配置 `SAFEBOX_GOOGLE_CLIENT_ID`，否则抛 RuntimeError
- 登录限流：退避 0,0,1,2,4 秒 → 第 5 次锁 1h（按目标邮箱/手机号，第 1 次不限制）。实现为 `get_login_wait`（只读）+ `record_login_failure`（INCR），由 `auth.py` 在 wait>0 时显式调用 record
- JWT secret：生产环境必须覆盖默认值
- JWT type：中间件校验 `type="access"`，防止 refresh token 冒充
- CORS：通配符源时 disable credentials（浏览器规范）
- TokenFamily rotation：refresh token 写入 `token_families` 表，FOR UPDATE 行级锁，重放时全线失效
- 登出/改密时撤销该用户所有 token_families
- SRP-6a：RFC 3526 4096-bit + SHA-256，2SKD x 派生（主密码+助记词双秘密），服务端只存 verifier
- 助记词不上传，加密缓存 IndexedDB（localDerivedKey 包裹），同设备登录用

### 调试
- 浏览器端清 IndexedDB：F12 → Application/存储 → IndexedDB → 右键 safebox → 删除
- 服务端清数据库 + 迁移：`./scripts/clear-db.sh`（见上面数据库章节）
- 调试阶段前端 IndexedDB `DB_VERSION=1` 保持不变，schema 变更手动清库（`database.ts` 注释有投产前迁移指南）；后端用 Alembic 迁移链（4 个，`alembic upgrade head`）
- Redis 清理：`sudo /usr/bin/redis6-cli FLUSHALL` 或 `DEL loginfail:email:xxx`
- 部署三件套不需要 `spe` 前缀（本地 `sudo -u michael`，不走代理）；rsync 在 michael 侧 `safebox-deploy.sh` 内部

### 测试
- 后端（所有测试）：`cd server && PYTHONPATH=. python -m pytest tests/ -q`
- 后端（单个文件）：`cd server && PYTHONPATH=. python -m pytest tests/test_auth.py -v`
- 前端（所有测试）：`cd web && npx vitest run`
- 前端（单个文件）：`cd web && npx vitest run src/__tests__/kdf-keychain.test.ts`
- 测试数据库是 SQLite，不需要 PostgreSQL/Redis（conftest.py mock 了 Redis 依赖）

### 设备 deauthorize + SRP K 通信加密（Phase 2）
- **device_id 绑 token**：access/refresh token 加 `device_id` claim；`UserDevice` 加 `is_revoked`/`revoked_at`/`updated_at` + `client_name`/`os_name`/`last_auth_ip`（challenge/verify 从 User-Agent + X-Real-IP 解析填充）；`TokenFamily` 加 `device_id` 列（按 device 撤销）
- **deauthorize**：`DELETE /auth/devices/{id}` 标记 is_revoked + 删该 device TokenFamily + Redis `device:revoked:{id}` TTL 30min（中间件 `get_current_user_id` 查，access 立即失效）；`GET /auth/devices` 设备列表。解决 access 30min 重用
- **SRP K 通信加密**（对标 1Password SRP+GCM 传输层，白皮书 L1706/L1948）：SRP verify 后 `K=H(S)` 存 Redis `session_key:{device_id}` **TTL session 级 30 天**（refresh 续，login 存/logout 清）+ client IndexedDB。认证 POST body + 响应用 K AES-256-GCM 加密（`services/transport_crypto.py` service + `middleware/transport_crypto.py` **纯 ASGI middleware**，BaseHTTPMiddleware 的 call_next 不传 receive body 故用纯 ASGI）。强制 `X-Safebox-Encrypted` header；**K 不存拒 401 `session expired`**（不透传，防 downgrade）。logout/change-password 清 session_key（change-password 清其他 device 保留当前）
- `middleware/__init__.py`：`get_current_user_id` 解 device_id + 查 `is_device_revoked` + 存 `request.state.device_id`；新增 `get_current_device_id`
- 迁移 `g8b9c0d1e2f3_device_auth.py`（device 绑 token）+ `h9c0d1e2f3a4_device_info.py`（device info 字段）；i18n 加 `device_revoked`/`device_not_found`；`register-device` 端点已删（冗余，register/verify 的 _resolve_device 已建 device）
- **不做**：分享（RSA，白皮书 L412 vault sharing 专用，SafeBox 单用户）、device_key 并行 UserKey（白皮书 L1163 SSO 专用，SafeBox 都有主密码，独立解会违背忘主密码=丢失）、每请求 Ed25519 签名

### 条目类型
- 5 种：login / card / identity / note / file
- 类型配置在 `config/itemTypes.ts`，使用 `buildItemTypeConfigs(t)` 构建
- 类型选择器：radio 横排，选中显示说明文字
