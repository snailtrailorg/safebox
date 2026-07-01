# SafeBox 部署指南

## 初始部署（一次性）

### 1. 服务器环境

```bash
# 依赖
sudo dnf install python3.11 postgresql-server redis nginx httpd

# 创建用户
sudo useradd -m safebox

# PostgreSQL
sudo postgresql-setup --initdb
sudo systemctl enable --now postgresql
sudo -u postgres psql -c "CREATE USER safebox WITH PASSWORD 'safebox';"
sudo -u postgres psql -c "CREATE DATABASE safebox OWNER safebox;"

# Redis
sudo systemctl enable --now redis

# Python 虚拟环境
sudo -u safebox python3.11 -m venv /data/websites/snailtrail.org/safebox/server/venv
sudo -u safebox /data/websites/snailtrail.org/safebox/server/venv/bin/pip install -r /data/websites/snailtrail.org/safebox/server/requirements.txt
```

### 2. 环境变量

服务器 `/data/websites/snailtrail.org/safebox/server/.env`：

```env
SAFEBOX_DATABASE_URL=postgresql+asyncpg://safebox:safebox@localhost:5432/safebox
SAFEBOX_REDIS_URL=redis://localhost:6379/0
SAFEBOX_JWT_SECRET_KEY=<用 openssl rand -hex 32 生成>
SAFEBOX_GOOGLE_CLIENT_ID=<Google Cloud Console OAuth 客户端 ID>
SAFEBOX_CORS_ORIGINS=https://snailtrail.org
SAFEBOX_SMTP_HOST=<SMTP 服务器>
SAFEBOX_SMTP_PORT=587
SAFEBOX_SMTP_USERNAME=<SMTP 用户名>
SAFEBOX_SMTP_PASSWORD=<SMTP 密码>
SAFEBOX_SMTP_FROM=noreply@snailtrail.org
```

### 3. 数据库迁移

```bash
sudo -u safebox bash -c 'cd /data/websites/snailtrail.org/safebox/server && PYTHONPATH=/data/websites/snailtrail.org/safebox/server venv/bin/alembic upgrade head'
```

### 4. Systemd 服务

```ini
# /etc/systemd/system/safebox.service
[Unit]
Description=SafeBox API Server
After=network.target postgresql.service redis.service

[Service]
User=safebox
WorkingDirectory=/data/websites/snailtrail.org/safebox/server
Environment=PATH=/data/websites/snailtrail.org/safebox/server/venv/bin
ExecStart=/data/websites/snailtrail.org/safebox/server/venv/bin/gunicorn app.main:app -k uvicorn.workers.UvicornWorker -w 2 -b 127.0.0.1:8000 --access-logfile /var/log/safebox/access.log --error-logfile /var/log/safebox/error.log --capture-output
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo mkdir -p /var/log/safebox
sudo chown safebox:safebox /var/log/safebox
sudo systemctl daemon-reload
sudo systemctl enable --now safebox
```

### 5. Apache 反向代理

```apache
# /etc/httpd/conf.d/safebox.conf
ProxyPass /api/ http://127.0.0.1:8000/api/
ProxyPassReverse /api/ http://127.0.0.1:8000/api/
ProxyPass /health http://127.0.0.1:8000/health
ProxyPassReverse /health http://127.0.0.1:8000/health

# Web 静态文件
Alias /safebox /data/websites/snailtrail.org/safebox/web
<Directory /data/websites/snailtrail.org/safebox/web>
    Options Indexes
    AllowOverride None
    Require all granted
</Directory>
```

## 日常部署

```bash
# 只推后端
./deploy.sh michael@snailtrail.org

# 后端 + Web
./deploy.sh michael@snailtrail.org --web
```

## 故障排查

```bash
# 查看服务状态
sudo systemctl status safebox

# 查看错误日志
sudo tail -50 /var/log/safebox/error.log

# 测试健康检查
curl http://127.0.0.1:8000/health

# 手动重启
sudo systemctl restart safebox

# 清库重建（调试）
sudo -u postgres psql -c 'DROP DATABASE IF EXISTS safebox; CREATE DATABASE safebox OWNER safebox;'
sudo -u safebox bash -c 'cd /data/websites/snailtrail.org/safebox/server && PYTHONPATH=/data/websites/snailtrail.org/safebox/server venv/bin/alembic upgrade head'
sudo systemctl restart safebox
```
