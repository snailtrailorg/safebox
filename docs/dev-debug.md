# SafeBox 本地开发与调试指南

## 本地 vs 服务器部署区分

- **本地开发**：手动起 uvicorn + npm run dev（本文档）。**不要本地跑 `scripts/deploy-*.sh`**（脚本推服务器，本地无意义且 `clear-db.sh` 会清生产库）。
- **服务器部署**：`scripts/deploy-*.sh`（`sudo -u michael` 推服务器）。详见 `DEPLOY.md`。

## 前置条件（Fedora）

```bash
sudo dnf install -y postgresql-server postgresql redis
```

## 1. 初始化数据库

```bash
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql redis

# 修改 pg_hba.conf 允许密码认证
sudo sed -i 's/^local\s\+all\s\+all\s\+peer/local   all             all                                     md5/' /var/lib/pgsql/data/pg_hba.conf
sudo sed -i 's/^host\s\+all\s\+all\s\+127.0.0.1\/32\s\+ident/host    all             all             127.0.0.1\/32            md5/' /var/lib/pgsql/data/pg_hba.conf
sudo systemctl restart postgresql
```

## 2. 创建数据库和用户

```bash
sudo -u postgres psql <<SQL
CREATE USER safebox WITH PASSWORD 'safebox';
CREATE DATABASE safebox OWNER safebox;
GRANT ALL PRIVILEGES ON DATABASE safebox TO safebox;
\c safebox
GRANT ALL ON SCHEMA public TO safebox;
SQL
```

## 3. 配置环境变量

```bash
cd server/
cp .env.example .env
# 编辑 .env，本地开发用默认值即可（SMTP 可选，未配置时 dev 模式打印验证码）
```

## 4. 安装依赖 + 数据库迁移

```bash
cd server/
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
PYTHONPATH=. venv/bin/alembic upgrade head   # 须在 server/ 下（script_location 相对路径）
```

## 5. 启动服务（本地手动）

```bash
# 后端
cd server && source venv/bin/activate && PYTHONPATH=. venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

# Web 前端
cd web && npm install && npm run dev
```

- 前端: http://localhost:5173（vite proxy /api -> 127.0.0.1:8000）
- 后端: http://127.0.0.1:8000
- Swagger: http://127.0.0.1:8000/docs
- 健康检查: http://127.0.0.1:8000/health

## 6. 运行测试

```bash
# 后端（SQLite + mock Redis，不需真 PostgreSQL/Redis）
cd server && PYTHONPATH=. venv/bin/python -m pytest tests/ -q    # 38 tests

# Web 前端
cd web && npx vitest run    # 84 tests

# 类型检查
cd web && npx tsc --noEmit
```

## 7. 常见调试

### 验证码
本地 SMTP 未配置时，验证码打印到 uvicorn 终端：
```
[DEV] 验证码 123456 应发送到 user@example.com
```
或直接 Redis 设码（绕过 send-code，避免 SMTP 卡）：
```bash
redis-cli SET "vc:email:user@example.com" "123456" EX 300
```

### PBKDF2 600k 迭代
浏览器约 200-500ms，仅在登录/注册/改密时执行（changeMasterPassword 多次，1-3 秒）。

### 清 IndexedDB
F12 -> Application/存储 -> IndexedDB -> 右键 safebox -> 删除。

### 清 Redis
```bash
redis-cli FLUSHALL
# 或单删
redis-cli DEL "loginfail:email:user@example.com"
redis-cli DEL "session_key:<device_id>"
```

### 删库重建（本地）
```bash
sudo -u postgres psql -c 'DROP DATABASE IF EXISTS safebox; CREATE DATABASE safebox OWNER safebox;'
cd server && PYTHONPATH=. venv/bin/alembic upgrade head
```

### K 通信加密调试
- 认证请求 body + 响应 K 加密，curl 看不到明文（响应是 octet-stream 密文）
- 用 Python httpx + `srp_service` + `transport_crypto` 模拟 client（见 `server/tests/test_auth.py`）
- K 不存（删 Redis session_key）-> 认证 401 `session expired`（防 downgrade，正常）
- middleware 纯 ASGI（BaseHTTPMiddleware 不传 receive body，故纯 ASGI）

### 设备信息
- challenge/verify 从 User-Agent + X-Real-IP 解析填充 device 的 client_name/os_name/last_auth_ip
- 设备页（👤 -> 设备管理）显示浏览器名/OS/IP/最后活跃

## 8. 服务器部署（脚本，不在本地跑）

```bash
./scripts/deploy-server.sh        # 推送后端 + 重启
./scripts/deploy-web.sh           # 构建前端 + 推送 + reload httpd
./scripts/migrate-db.sh           # 升级 schema（alembic upgrade，保留数据，不停服务）
./scripts/clear-db.sh             # 清库重置（DROP+CREATE+alembic+Redis FLUSHALL+重启，丢数据）
```

四个脚本通过 `sudo -u michael` 调 michael 侧部署工具，不碰 .env/venv（rsync 排除）。
`deploy-server.sh` 只推代码+重启，不跑迁移。schema 变更后：想保留数据用 `migrate-db.sh`，想重新注册测试用 `clear-db.sh`。
