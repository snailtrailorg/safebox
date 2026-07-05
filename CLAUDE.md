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

### 密钥派生
- `deriveKey(password, salt)` → AES-256 密钥（加密 masterKey）
- `deriveKeyHash(password, salt)` → 发给服务器的 password_hash（认证用）
- 两者使用不同 salt 域：auth salt = salt + "auth" 后缀
- 防止服务器 passwordHash 被直接用于解密 passwordWrapped

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

### 条目类型
- 5 种：login / card / identity / note / file
- 类型配置在 `config/itemTypes.ts`，使用 `buildItemTypeConfigs(t)` 构建
- 类型选择器：radio 横排，选中显示说明文字
