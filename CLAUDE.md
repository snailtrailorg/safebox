# SafeBox 项目约定

## 部署

- `deploy.sh` 只做代码推送+重启，不装依赖不跑迁移
- 服务器初始部署步骤见 `DEPLOY.md`
- 部署后验证：`curl -s http://127.0.0.1:8000/health`
- 推送到 GitHub 用 `spe git push github master`（需要代理）

## 技术约定

### 密码哈希
- 服务端使用 `bcrypt` 库（不是 passlib），直接调用 `hashpw`/`checkpw`
- 输入是客户端 PBKDF2 hash 的 base64 字符串（44 字符）
- `hashpw` 接受 `bytes`，输出 `bytes`，需要 `.encode()` / `.decode()` 转换
- `gensalt()` 默认 12 rounds，无需手动指定

### 密钥派生（v2）
- `deriveKey(password, salt, kdf_settings?)` → AES-256 密钥（加密 User Key）。来自 `kdf.ts`
- `deriveAuthKey(password, salt, kdf_settings?)` → 发给服务器的 auth_key_hash（认证用）。来自 `kdf.ts`
- 两者使用不同 salt 域：auth salt = salt + "auth" 后缀
- 防止服务器 auth_key_hash 被直接用于解密 passwordWrapped
- KDF 参数可配置：`{ algorithm: "pbkdf2", iterations: 600_000 }`，跟随账户存储在 `users.kdf_settings`（Text 列存 JSON）
- 旧 API `deriveKeyHash`（pbkdf2.ts）已废弃，新代码用 `deriveAuthKey`（kdf.ts）

### 密钥管理（v2）
- `keyChain`（`keychain/keyChain.ts`）是全局单例，替代废弃的 `keyManager`
- `keyManager`（`services/keyManager.ts`）已标记 @deprecated，所有页面已迁移到 keyChain
- keyChain 提供：generateKeys、unlockWithPassword、loadRsaKeys、encryptItemData/decryptItemData（RSA v1 兼容）、encryptFileBlob/decryptFileBlob、encryptItemField/decryptItemField（v2 AES-GCM+ItemKey）

### 恢复码（v2）
- 服务端 BIP39 12 词生成 → HMAC-SHA256 哈希存储 → 24h 冷却期 → 加速/冻结
- 恢复码在安全设置页生成（POST /auth/recovery/generate），注册不再生成
- 恢复码使用不需要验证码，加速通道需要验证码
- 详见 `docs/architecture/RECOVERY_MECHANISM.md`

### 服务拆分（v2）
- `auth_service.py`：认证业务逻辑（hash_auth_key、用户查询、create_user_with_keys）
- `token_service.py`：JWT 创建 + refresh rotation + 撤销
- `recovery_service.py`：恢复码生成/验证/冷却期/加速/冻结
- `bip39.py`：BIP39 2048 词表 + 生成函数

### 依赖管理
- `requirements.txt` 中 `bcrypt` 不设版本上限（bcrypt 5.x API 稳定）
- 不用 passlib——它只是 bcrypt 的薄包装，且 1.7.4 与 bcrypt 5.x 不兼容
- JWT 库：PyJWT 2.10+（不用 python-jose，已停止维护）

### 数据库
- PostgreSQL + Redis
- 清库重建: `sudo -u postgres psql -c 'DROP DATABASE IF EXISTS safebox; CREATE DATABASE safebox OWNER safebox;'`
- Alembic 迁移: `cd server && PYTHONPATH=. venv/bin/alembic upgrade head`
- 注意: alembic 的 `script_location` 是相对路径，需要在 server/ 目录下执行

### 安全
- Google OAuth：生产环境必须配置 `SAFEBOX_GOOGLE_CLIENT_ID`，否则抛 RuntimeError
- 登录限流：指数退避 1→2→4→8→锁1h，按目标邮箱/手机号限流。`check_login_rate_limit` 内部自增，第 1 次不限制
- JWT secret：生产环境必须覆盖默认值
- JWT type：中间件校验 `type="access"`，防止 refresh token 冒充
- CORS：通配符源时 disable credentials（浏览器规范）
- TokenFamily rotation：refresh token 写入 `token_families` 表，FOR UPDATE 行级锁，重放时全线失效
- 登出/改密时撤销该用户所有 token_families

### 调试
- 浏览器端清 IndexedDB：F12 → Application/存储 → IndexedDB → 右键 safebox → 删除
- 服务端清数据库 + 迁移见上面数据库章节
- 调试阶段不需要数据库版本迁移代码——版本号保持 1，需要时手动删库重建
- Redis 清理：`sudo /usr/bin/redis6-cli FLUSHALL` 或 `DEL loginfail:email:xxx`
- `deploy.sh` 不需要 `spe` 前缀，但部署后服务端 rsync 需要 sudo（`--rsync-path="sudo rsync"`）

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
