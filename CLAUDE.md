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

### 密码哈希
- 服务端使用 `bcrypt` 库（不是 passlib），直接调用 `hashpw`/`checkpw`
- 输入是客户端 PBKDF2 hash 的 base64 字符串（44 字符）
- `hashpw` 接受 `bytes`，输出 `bytes`，需要 `.encode()` / `.decode()` 转换
- `gensalt()` 默认 12 rounds，无需手动指定

### 密钥派生（合并主密码模型：主密码=登录密码+Passphrase 合一，参与 K 派生，忘则数据丢失）
- `deriveKey(password, salt, kdf_settings?)` → 通用 PBKDF2-SHA256 派生 AES-256 密钥（`kdf.ts`）。用于三处：
  - 派生 K：`K = deriveKey(助记词+主密码, mnemonic_salt)` → 加密 User Key（`encrypted_user_key = AES(K, UserKey)`）
  - 派生 localDerivedKey：`deriveKey(主密码, local_salt)` → 本地缓存 K（`cached_K = AES(localDerivedKey, K)`）
  - 派生备份密钥：`deriveKey(备份密码, salt)` → 加密导出文件
- `deriveAuthKey(password, salt, kdf_settings?)` → 发给服务器的 local_password_hash（`kdf.ts`）。在 salt 后追加 4 字节 `"auth"`（`0x61 0x75 0x74 0x68`）作为独立 salt 域，与 K 派生隔离，防止 local_password_hash 被用于解密
- KDF 参数可配置：`{ algorithm: "pbkdf2", iterations: 600_000 }`，跟随账户存储在 `users.kdf_settings`（Text 列存 JSON）
- 服务端只收到 `local_password_hash`（schema alias `local_password_hash`）后做 bcrypt，不感知派生细节

### 密钥管理（合并主密码模型）
- `keyChain`（`keychain/keyChain.ts`）是全局单例，管理 User Key 生命周期
- keyChain 提供：`generateKeys`、`unlockWithPassword`、`unlockFromMnemonic`、`recoverAndRewrap`（换设备解锁+建缓存）、`changeMasterPassword`（改密重派生 K+重包裹 encrypted_user_key）、`createItemKey`/`decryptItemKey`、`encryptItemField`/`decryptItemField`（AES-GCM + ItemKey）、`encryptFileBlob`/`decryptFileBlob`、`exportUserKeyRaw`、`lock`
- 改主密码：K 变（主密码参与派生）-> `changeMasterPassword(助记词, mnemonic_salt, 新主密码, 新 local_salt)` 重新包裹 encrypted_user_key + 新 cached_K + 新 auth hash；需助记词（派生新 K）；旧主密码由服务端 change-password 端点验（current_local_password_hash）
- `services/keyManager.ts`、`crypto/pbkdf2.ts`、旧 `deriveKeyHash` API **已删除**（不再是 deprecated）
- `crypto/rsa.ts`（RSA-OAEP 工具）保留但全项目无引用，属遗留死代码；keyChain 无 RSA v1 兼容函数（`loadRsaKeys`/`encryptItemData`/`decryptItemData` 已删）

### 助记词（合并主密码模型）
- 客户端 BIP39 12 词生成（注册时 `generateMnemonic()`），上传明文 + 客户端生成的 `mnemonic_hmac_salt`，服务端 `HMAC-SHA256(server_key, salt+mnemonic)` 哈希存储，注册成功后模态框展示一次
- 助记词用于换设备（有主密码时派生 K 解 encrypted_user_key）；忘主密码 = 数据丢失（主密码参与 K 派生，无法恢复）
- **取消冷却/加速/冻结/confirm**：`POST /auth/recovery/initiate` 验助记词返回 encrypted_user_key（web 换设备实际走 login+recoverAndRewrap，initiate 端点保留但 web 不调，同 create_mnemonic 为死代码）
- 详见 `docs/RECOVERY_MECHANISM.md`

### 服务拆分
- `auth_service.py`：认证业务逻辑（hash_auth_key、用户查询、create_user_with_keys）
- `token_service.py`：JWT 创建 + refresh rotation + 撤销
- `recovery_service.py`：助记词 hash/verify/find_valid（`create_mnemonic`/`generate_mnemonic_hmac_salt` 函数存在但无端点调用，助记词实际由客户端生成上传）
- `bip39.py`：BIP39 2048 词表 + 生成函数

### 依赖管理
- `requirements.txt` 中 `bcrypt` 不设版本上限（bcrypt 5.x API 稳定）
- 不用 passlib——它只是 bcrypt 的薄包装，且 1.7.4 与 bcrypt 5.x 不兼容
- JWT 库：PyJWT 2.10+（不用 python-jose，已停止维护）

### 数据库
- PostgreSQL + Redis
- 升级 schema（保留数据）: `./scripts/migrate-db.sh`（通过 `sudo -u michael` 调 migrate-pgsql：alembic upgrade，不停服务不丢数据）
- 清服务器库（推荐）: `./scripts/clear-db.sh`（通过 `sudo -u michael` 调 michael 侧工具：DROP/CREATE + alembic upgrade + Redis FLUSHALL + 重启，重置含迁移）
- 手动清库（本地/裸命令）: `sudo -u postgres psql -c 'DROP DATABASE IF EXISTS safebox; CREATE DATABASE safebox OWNER safebox;'`（服务器需先 `sudo systemctl stop safebox` 释放连接，否则 DROP 报 "being accessed by other users"）
- Alembic 迁移（本地/单独）: `cd server && PYTHONPATH=. venv/bin/alembic upgrade head`；服务器清库重置由 `clear-db.sh` 自动含迁移，无需手动
- 注意: alembic 的 `script_location` 是相对路径，需要在 server/ 目录下执行

### 安全
- Google OAuth：生产环境必须配置 `SAFEBOX_GOOGLE_CLIENT_ID`，否则抛 RuntimeError
- 登录限流：退避 0,0,1,2,4 秒 → 第 5 次锁 1h（按目标邮箱/手机号，第 1 次不限制）。实现为 `get_login_wait`（只读）+ `record_login_failure`（INCR），由 `auth.py` 在 wait>0 时显式调用 record
- JWT secret：生产环境必须覆盖默认值
- JWT type：中间件校验 `type="access"`，防止 refresh token 冒充
- CORS：通配符源时 disable credentials（浏览器规范）
- TokenFamily rotation：refresh token 写入 `token_families` 表，FOR UPDATE 行级锁，重放时全线失效
- 登出/改密时撤销该用户所有 token_families

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

### 条目类型
- 5 种：login / card / identity / note / file
- 类型配置在 `config/itemTypes.ts`，使用 `buildItemTypeConfigs(t)` 构建
- 类型选择器：radio 横排，选中显示说明文字
