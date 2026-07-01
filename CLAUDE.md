# SafeBox 项目约定

## 部署

- `deploy.sh` 只做代码推送+重启，不装依赖不跑迁移
- 服务器初始部署步骤见 `DEPLOY.md`
- 部署后验证：`curl -s http://127.0.0.1:8000/health`

## 技术约定

### 密码哈希
- 服务端使用 `bcrypt` 库（不是 passlib），直接调用 `hashpw`/`checkpw`
- 输入是客户端 PBKDF2 hash 的 base64 字符串（44 字符）
- `hashpw` 接受 `bytes`，输出 `bytes`，需要 `.encode()` / `.decode()` 转换
- `gensalt()` 默认 12 rounds，无需手动指定

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
- 登录限流：指数退避 5→10→20→40→锁1h，按目标邮箱/手机号限流（不按 IP）
- JWT secret：生产环境必须覆盖默认值
- CORS：通过 `SAFEBOX_CORS_ORIGINS` 配置，逗号分隔

### 调试
- 浏览器端清 IndexedDB：F12 → Application/存储 → IndexedDB → 右键 safebox → 删除
- 服务端清数据库 + 迁移见上面数据库章节
- 调试阶段不需要数据库版本迁移代码——版本号保持 1，需要时手动删库重建
