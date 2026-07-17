# SafeBox 本地开发与调试指南

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
# 编辑 .env，本地开发用默认值即可
```

## 4. 安装依赖 + 数据库迁移

```bash
cd server/
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
alembic upgrade head
```

## 5. 启动服务

```bash
# 后端
cd server && source venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Web 前端
cd web && npm install && npm run dev
```

- 前端: http://localhost:5173
- 后端: http://localhost:8000
- Swagger: http://localhost:8000/docs
- 健康检查: http://localhost:8000/health

## 6. 运行测试

```bash
# 后端
cd server && PYTHONPATH=. venv/bin/python -m pytest tests/ -q

# Web 前端
cd web && npx vitest run
```

## 7. 常见调试

### 验证码

本地开发时 SMTP 未配置，验证码打印到 uvicorn 终端：
```
[DEV] 验证码 123456 应发送到 user@example.com
```

### PBKDF2 600k 迭代

浏览器中约 200-500ms，仅在登录/注册时执行一次。

### 清 IndexedDB

F12 → Application/存储 → IndexedDB → 右键 safebox → 删除。

### 清 Redis

```bash
sudo redis-cli FLUSHALL
```

### 删库重建

```bash
sudo -u postgres psql -c 'DROP DATABASE IF EXISTS safebox; CREATE DATABASE safebox OWNER safebox;'
cd server && PYTHONPATH=. venv/bin/alembic upgrade head
```

## 8. 部署

```bash
./scripts/deploy-server.sh        # 推送后端 + 重启
./scripts/deploy-web.sh           # 构建前端 + 推送 + reload httpd
./scripts/migrate-db.sh           # 升级 schema（alembic upgrade，保留数据，不停服务）
./scripts/clear-db.sh             # 清库重置（DROP+CREATE+alembic，丢数据，用于重新注册测试）
```

四个薄包装脚本通过 `sudo -u michael` 调 michael 侧部署工具，不碰 .env/venv（rsync 排除）。
deploy-server.sh 只推代码+重启，不跑迁移。schema 变更后：想保留数据用 migrate-db.sh，
想重新注册测试/数据不要了用 clear-db.sh。
