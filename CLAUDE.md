# SafeBox 项目约定

## 部署

### 服务器部署（脚本，推服务器）
- 部署四件套：`scripts/deploy-server.sh`（后端+重启）、`scripts/deploy-web.sh`（前端构建+推送+reload）、`scripts/migrate-db.sh`（升级 schema 保留数据）、`scripts/clear-db.sh`（清库重置丢数据）；均通过 `sudo -u michael` 调 michael 侧部署工具，不装依赖
- 直接 `./scripts/xxx.sh` 跑，脚本内 `sudo -u michael` 免密（sudoers 已配），**不要手动加 sudo**
- 不要碰 michael 的 `/home/michael/.local/bin/safebox-deploy.sh`（bernard 无权读/改）
- bernard 的 `sudo -u michael` 只放行 `safebox-deploy.sh`（不能跑别的命令）；服务器其他操作（如改 `.env`）要登录服务器手动做
- 服务器初始部署步骤见 `DEPLOY.md`
- 部署后验证：`curl -s http://127.0.0.1:8000/health`
- 推送到 GitHub 用 `spe git push github master`（需要代理，代理不可用则跳过不修复）
- 部署脚本不需要 `spe` 前缀（本地 `sudo -u michael`，不走代理）；rsync 在 michael 侧 `safebox-deploy.sh` 内部

### 本地开发（手动，不跑部署脚本）
- 后端：`cd server && PYTHONPATH=. venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`
- 前端：`cd web && npm run dev`（http://localhost:5173，proxy /api -> 8000）
- **不要本地跑部署脚本**（脚本推服务器，本地无意义且 clear-db 会清生产库）
- 本地清库手动：`sudo -u postgres psql -c 'DROP DATABASE IF EXISTS safebox; CREATE DATABASE safebox OWNER safebox;'` + `cd server && PYTHONPATH=. venv/bin/alembic upgrade head`
- 详见 `docs/dev-debug.md`

## 技术约定

### 认证（SRP-6a + 2SKD + 三态 session）
- 服务端不存密码哈希，只存 SRP verifier（`users.srp_verifier`，hex）+ `srp_salt`
- SRP-6a：RFC 3526 4096-bit MODP + SHA-256，自实现 `srp_service.py`（无外部 SRP 库，N 硬编码 1024 hex）
- 2SKD x 派生：`x = PBKDF2(主密码, HKDF拉伸(srp_salt,邮箱), 600k) XOR HKDF(助记词, salt=邮箱, info="safebox-srp-auth")`，助记词=Secret Key（双秘密，缺一不可）
- 登录两步：`/auth/login/srp/challenge`（A->B+session_id，Redis TTL 5min，传 device_id?/device_name?）+ `/auth/login/srp/verify`（M1->M2+token+K_comm 存）
- 改密/删号验旧密码：客户端先走 SRP 登录拿 fresh token，再调端点
- `bcrypt`/`passlib`/`hash_auth_key`/`verify_auth_key`/`deriveAuthKey` 已移除
- 前端 `crypto/srp.ts`（BigInt + Web Crypto，与后端逐字节一致，固定向量见 `tests/srp.test.ts`）
- 助记词加密缓存：`mnemonic_encrypted = AES(localDerivedKey, 助记词)` 存 IndexedDB，同设备登录解出算 SRP x

### 三态 session（对标 1Password）
- **login**：主密码+助记词（或同设备缓存取 mnemonic）SRP 握手建 session + K_comm
- **lock**（autoLock 20min）：`keyChain.lock()` 清内存 UserKey，不清 session（cached_K 保留）
- **unlock**：输主密码 `unlockWithPassword` 本地解 cached_K（不走 SRP，K_comm 不变）
- **logout（决策 A）**：清整个 session（cached_K + mnemonic_encrypted + session_K + token），重登走 RecoveryPage（助记词+主密码，非同设备登录）
- session 边界：login 到 logout（或 refresh 30 天过期）；session 内 token 过期重登走同设备（mnemonic 缓存），logout 后走 RecoveryPage
- 详见 `docs/RECOVERY_MECHANISM.md`

### 密钥派生（合并主密码模型：主密码=登录密码+Passphrase 合一，参与 K 派生，忘则数据丢失）
- `deriveKey(password, salt, kdf_settings?)` -> 通用 PBKDF2-SHA256（`kdf.ts`）。用于：
  - 派生 K：`K = deriveKey(助记词+主密码, mnemonic_salt)` -> 加密 UserKey（`encrypted_user_key = AES(K, UserKey)`）
  - localDerivedKey：`deriveKey(主密码, local_salt)` -> 本地缓存（cached_K + mnemonic_encrypted）
  - 备份密钥：`deriveKey(备份密码, salt)` -> 加密导出文件
- KDF 参数可配置：`{ algorithm: "pbkdf2", iterations: 600_000 }`，存 `users.kdf_settings`（JSON）

### 两种 K（不要混淆）
- **派生 K**：`PBKDF2(助记词+主密码, mnemonic_salt)`，永久（主密码变才变），加密 UserKey
- **通信 K_comm**：`H(S)`（SRP 握手），session 级 30 天，加密认证 body + 响应

### 密钥管理（keyChain 全局单例 `keychain/keyChain.ts`）
- `generateKeys`/`unlockWithPassword`/`getMnemonicFromCache`/`unlockFromMnemonic`/`recoverAndRewrap`（换设备建缓存）/`changeMasterPassword`（K 变重包裹）/`createItemKey`/`decryptItemKey`/`encryptItemField`/`decryptItemField`/`encryptFileBlob`/`decryptFileBlob`/`exportUserKeyRaw`/`lock`
- 改主密码：K 变 -> 重包裹 encrypted_user_key + 新 cached_K + 新 mnemonic_encrypted + 新 SRP verifier；需助记词+邮箱；旧主密码由前置 SRP 验
- `services/keyManager.ts`、`crypto/pbkdf2.ts`、`deriveAuthKey` API 已删；`crypto/rsa.ts` 保留但无引用（死代码）

### 助记词（SRP + 合并主密码模型）
- 客户端 BIP39 12 词本地生成（`crypto/bip39.ts`），**不上传**（废除 mnemonics 表）
- 助记词 = Secret Key，参与 SRP x 派生（2SKD）+ K 派生
- 同设备登录：mnemonic_encrypted 缓存 IndexedDB，登录解出算 x
- 换设备：用户输助记词（RecoveryPage），SRP + recoverAndRewrap 建缓存
- 忘主密码 = 数据丢失
- `POST /auth/recovery/initiate` + `recovery_service.py` + `models/mnemonic.py` 已删

### 服务拆分
- `auth_service.py`：用户查询、`create_user_with_keys`（存 srp_verifier/srp_salt + 建 device 含 client_name/os_name/last_auth_ip）
- `srp_service.py`：SRP-6a + 2SKD 自实现
- `token_service.py`：JWT + refresh rotation + revoke_device_tokens
- `verification_service.py`：验证码 + 登录限流 + SRP session + session_key（store/get/renew/delete）+ device:revoked
- `transport_crypto.py`（service）：AES-256-GCM encrypt/decrypt
- `bip39.py`：BIP39 词表 + 生成（服务端保留，前端本地生成）

### 依赖管理
- SRP 自实现，无外部 SRP 库；`bcrypt`/`passlib` 已移除；JWT 用 PyJWT 2.10+；AES-GCM 用 cryptography

### 数据库
- PostgreSQL + Redis
- 升级 schema（保留数据）：`./scripts/migrate-db.sh`
- 清服务器库：`./scripts/clear-db.sh`（DROP/CREATE + alembic upgrade + Redis FLUSHALL + 重启，含迁移）
- 手动清库（本地）：`sudo -u postgres psql -c 'DROP DATABASE IF EXISTS safebox; CREATE DATABASE safebox OWNER safebox;'`（服务器需先 `sudo systemctl stop safebox` 释放连接）
- Alembic 迁移（本地）：`cd server && PYTHONPATH=. venv/bin/alembic upgrade head`（script_location 相对路径，须在 server/ 下）
- 迁移链：`f7a8b9c0d1e2_srp_auth`（SRP 改造）-> `g8b9c0d1e2f3_device_auth`（device 绑 token）-> `h9c0d1e2f3a4_device_info`（client_name/os_name/last_auth_ip）

### 安全
- 登录限流：退避 0,0,1,2,4 秒 -> 第 5 次锁 1h（按目标，第 1 次不限制）
- JWT secret：生产必须覆盖默认；JWT type 校验 `type="access"` 防 refresh 冒充
- CORS：通配符源时 disable credentials
- TokenFamily rotation：FOR UPDATE 行锁，重放全线失效；登出/改密撤销 token
- SRP-6a：RFC 3526 4096-bit + SHA-256，2SKD 双秘密，服务端只存 verifier
- 助记词不上传，加密缓存 IndexedDB
- K 通信 session 级 30 天，不存拒 401（防 downgrade），纯 ASGI middleware
- device deauthorize：device_id 绑 token + Redis revoked（access 立即失效）

### 调试
- 浏览器清 IndexedDB：F12 -> Application -> IndexedDB -> 删 safebox
- 服务端清数据库 + 迁移：`./scripts/clear-db.sh`
- Redis 清理：`redis-cli FLUSHALL` 或 `DEL loginfail:email:xxx`（本地 redis6-cli 不存在用 redis-cli）
- 前端 IndexedDB `DB_VERSION=1`，schema 变更手动清库；后端 Alembic 迁移链

### 测试
- 后端（所有）：`cd server && PYTHONPATH=. venv/bin/python -m pytest tests/ -q`（38 tests，1 skipped 需真 Redis）
- 后端（单文件）：`cd server && PYTHONPATH=. venv/bin/python -m pytest tests/test_auth.py -v`
- 前端（所有）：`cd web && npx vitest run`（84 tests）
- 前端（单文件）：`cd web && npx vitest run src/__tests__/kdf-keychain.test.ts`
- 测试数据库 SQLite，不需 PostgreSQL/Redis（conftest.py mock Redis + identity 加解密透传）
- tsc 类型检查：`cd web && npx tsc --noEmit`

### 设备 deauthorize + SRP K 通信加密（Phase 2）
- **device_id 绑 token**：access/refresh 加 `device_id` claim；`UserDevice` 加 `is_revoked`/`revoked_at`/`updated_at` + `client_name`/`os_name`/`last_auth_ip`（challenge/verify 从 User-Agent + X-Real-IP 解析）；`TokenFamily` 加 `device_id` 列
- **deauthorize**：`DELETE /auth/devices/{id}` 标记 is_revoked + 删该 device TokenFamily + Redis `device:revoked:{id}` TTL 30min（中间件查，access 立即失效）；`GET /auth/devices` 列表
- **改密踢其他设备**：change-password 清其他 device session_key（当前保留）-> 其他设备 K 不存 401 -> 踢 RecoveryPage
- **SRP K 通信加密**（对标 1Password SRP+GCM，白皮书 L1706/L1948）：SRP verify 后 `K_comm=H(S)` 存 Redis `session_key:{device_id}` **session 级 30 天**（refresh 续，login 存/logout 清）+ client IndexedDB。认证 body + 响应用 K AES-256-GCM 加密（`services/transport_crypto.py` + `middleware/transport_crypto.py` **纯 ASGI**，BaseHTTPMiddleware call_next 不传 receive body 故纯 ASGI）。强制 `X-Safebox-Encrypted`；**K 不存拒 401 `session expired`**（防 downgrade）。logout/change-password 清 session_key
- `middleware/__init__.py`：`get_current_user_id` 解 device_id + 查 `is_device_revoked` + 存 `request.state.device_id`；`get_current_device_id`
- 迁移 `g8b9c0d1e2f3_device_auth.py` + `h9c0d1e2f3a4_device_info.py`；i18n 加 `device_revoked`/`device_not_found`；`register-device` 端点已删（冗余）
- **不做**：分享（RSA，单用户）、device_key 并行 UserKey（SSO 专用）、每请求 Ed25519 签名

### 条目类型
- 5 种：login / card / identity / note / file
- 类型配置 `config/itemTypes.ts`，`buildItemTypeConfigs(t)` 构建
- 类型选择器：radio 横排，选中显示说明
