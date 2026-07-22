# SafeBox 生产环境部署指南

> 对外部署指南（给其他用户/团队部署 SafeBox 到自己的服务器）。Nginx 为推荐反代（普遍），Apache 备选。
> bernard 自己部署用 `scripts/deploy-*.sh`（`sudo -u michael` 特定，见 `CLAUDE.md`），不在此文档。

> 部署目标：Amazon Linux 2023 | 部署路径：`/data/websites/snailtrail.org/safebox/`（可改） | 数据库：`/data/databases/pgsql/`

## 目标架构

```
Internet -> Nginx (TLS + 反代) ─┬─ /api/* -> Uvicorn (127.0.0.1:8000) -> FastAPI -> PostgreSQL + Redis
                               └─ /*     -> 静态文件 (web/dist/)
```

Nginx 承担 TLS 终止 + API 反代 + Web 静态文件。后端以独立 `safebox` 用户运行（安全隔离）。

---

## 一、一次性环境准备

### 1.1 安装依赖（Amazon Linux 2023）

```bash
sudo dnf install -y python3 python3-pip python3.11 postgresql15-server postgresql15 redis nginx
```

> 包名是 `postgresql15-server`/`redis6`（不是 `postgresql-server`/`redis`）。

### 1.2 初始化 PostgreSQL（数据目录自定义）

Amazon Linux 2023 的 `postgresql-setup` 已移除 `--datadir`。先初始化到默认位置再移动：

```bash
sudo postgresql-setup --initdb
sudo systemctl stop postgresql
sudo mv /var/lib/pgsql/data /data/databases/pgsql
sudo mkdir -p /etc/systemd/system/postgresql.service.d
sudo tee /etc/systemd/system/postgresql.service.d/override.conf <<'EOF'
[Service]
Environment=PGDATA=/data/databases/pgsql
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now postgresql
# 验证：sudo -u postgres psql -c "SHOW data_directory;" -> /data/databases/pgsql
```

### 1.3 配置 pg_hba.conf 允许密码认证

```bash
sudo sed -i 's/^local\s\+all\s\+all\s\+peer/local   all             all                                     md5/' /data/databases/pgsql/pg_hba.conf
sudo sed -i 's/^host\s\+all\s\+all\s\+127.0.0.1\/32\s\+ident/host    all             all             127.0.0.1\/32            scram-sha-256/' /data/databases/pgsql/pg_hba.conf
sudo sed -i "s/^#listen_addresses.*/listen_addresses = 'localhost'/" /data/databases/pgsql/postgresql.conf
sudo systemctl restart postgresql
```

### 1.4 创建数据库和用户

```bash
sudo -u postgres psql <<SQL
CREATE USER safebox WITH PASSWORD '你的强密码';
CREATE DATABASE safebox OWNER safebox;
GRANT ALL PRIVILEGES ON DATABASE safebox TO safebox;
\c safebox
GRANT ALL ON SCHEMA public TO safebox;
SQL
```

### 1.5 启动 Redis

```bash
sudo sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis6/redis6.conf   # 服务名 redis6
sudo systemctl enable --now redis6
```

> Redis 用于验证码/SRP session/K 通信 session_key/device:revoked（TTL 5min-30天），不需持久化。

### 1.6 创建系统用户和目录

```bash
sudo useradd -m safebox
sudo mkdir -p /data/websites/snailtrail.org/safebox/{server,web} /var/log/safebox
sudo chown -R safebox:safebox /data/websites/snailtrail.org/safebox /var/log/safebox
sudo usermod -a -G safebox nginx
sudo chmod 750 /data/websites/snailtrail.org/safebox{,/web}
```

> 部署用户通常不能直接写 `/data/`。流程：rsync 到家目录 -> `sudo cp` 到目标路径。

### 1.7 首次部署应用代码

```bash
# 开发机推送
rsync -avz --delete --exclude='__pycache__/' --exclude='*.pyc' \
    --exclude='venv/' --exclude='.env' --exclude='test.db' --exclude='.pytest_cache/' \
    server/ user@your-server:~/safebox-server/

# 服务器：移入 + venv
ssh user@your-server
sudo cp -r ~/safebox-server/* /data/websites/snailtrail.org/safebox/server/
sudo chown -R safebox:safebox /data/websites/snailtrail.org/safebox/server/
cd /data/websites/snailtrail.org/safebox/server
python3.11 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
```

> 用 python3.11（Amazon Linux 2023 默认 3.9 不支持 `str | None`）。

### 1.8 配置环境变量

创建 `/data/websites/snailtrail.org/safebox/server/.env`：

```bash
SAFEBOX_DATABASE_URL=postgresql+asyncpg://safebox:你的数据库密码@localhost:5432/safebox
SAFEBOX_JWT_SECRET_KEY=openssl rand -hex 32 生成的 64 字符 hex
SAFEBOX_REDIS_URL=redis://:你的Redis密码@localhost:6379/0   # 无密码则 redis://localhost:6379/0

# Twilio 短信（可选）
SAFEBOX_TWILIO_ACCOUNT_SID=
SAFEBOX_TWILIO_AUTH_TOKEN=
SAFEBOX_TWILIO_PHONE_NUMBER=+1234567890

# SMTP 邮件（可选，未配置 dev 模式打印验证码 + 改密通知 BackgroundTasks 异步）
SAFEBOX_SMTP_HOST=
SAFEBOX_SMTP_PORT=587
SAFEBOX_SMTP_USERNAME=
SAFEBOX_SMTP_PASSWORD=
SAFEBOX_SMTP_FROM=noreply@your-domain.com

# Google OAuth（生产必须配置，否则 RuntimeError）
SAFEBOX_GOOGLE_CLIENT_ID=
```

> `.env` 含密码/JWT 密钥，已在 `.gitignore`，不提交。

### 1.9 数据库迁移

```bash
cd /data/websites/snailtrail.org/safebox/server
source venv/bin/activate
alembic upgrade head    # 跑所有迁移（含 SRP + device_auth + device_info）
```

迁移链：`f7a8b9c0d1e2_srp_auth` -> `g8b9c0d1e2f3_device_auth` -> `h9c0d1e2f3a4_device_info`。`alembic upgrade head` 自动按序跑。

### 1.10 Systemd 服务

创建 `/etc/systemd/system/safebox.service`：

```ini
[Unit]
Description=SafeBox API Server
After=network.target postgresql.service redis6.service
Wants=postgresql.service redis6.service

[Service]
Type=simple
User=safebox
Group=safebox
WorkingDirectory=/data/websites/snailtrail.org/safebox/server
EnvironmentFile=/data/websites/snailtrail.org/safebox/server/.env
ExecStart=/data/websites/snailtrail.org/safebox/server/venv/bin/gunicorn app.main:app \
    -k uvicorn.workers.UvicornWorker -w 2 -b 127.0.0.1:8000 \
    --access-logfile /var/log/safebox/access.log \
    --error-logfile /var/log/safebox/error.log --capture-output
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

> `After=`/`Wants=` 里 Redis 服务名是 `redis6.service`（Amazon Linux 2023）。

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now safebox
sudo systemctl status safebox
```

### 1.11 Nginx 配置

创建 `/etc/nginx/conf.d/safebox.conf`：

```nginx
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    client_max_body_size 5M;

    # API 反代（SRP K 通信加密在 TLS 之上第二层，Nginx 只见密文）
    location /api/ {
        proxy_pass         http://127.0.0.1:8000/api/;
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    location /health {
        proxy_pass         http://127.0.0.1:8000/health;
        proxy_set_header   Host $host;
    }

    # Web 静态文件（SPA）
    location / {
        root  /data/websites/snailtrail.org/safebox/web;
        try_files $uri $uri/ /index.html;
    }
}
```

> `X-Real-IP` 传给后端，challenge/verify 从此解析 last_auth_ip。

```bash
sudo nginx -t && sudo systemctl reload nginx
```

### 1.12 防火墙 + HTTPS

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload

# Let's Encrypt
sudo dnf install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
sudo systemctl enable --now certbot.timer
```

### 1.13 验证

```bash
curl http://127.0.0.1:8000/health    # {"status":"ok"}
curl https://your-domain.com/health   # {"status":"ok"}
# 浏览器: https://your-domain.com/docs（Swagger）
```

---

## 二、日常部署（重复操作）

```bash
# 1. 推送后端
rsync -avz --delete --exclude='__pycache__/' --exclude='*.pyc' \
    --exclude='venv/' --exclude='.env' --exclude='test.db' --exclude='.pytest_cache/' \
    server/ user@your-server:~/safebox-server/

# 2. 移入 + 重启
ssh user@your-server "sudo cp -r ~/safebox-server/* /data/websites/snailtrail.org/safebox/server/ && \
    sudo chown -R safebox:safebox /data/websites/snailtrail.org/safebox/server/ && \
    sudo systemctl restart safebox"

# 3. 推送 Web（可选）
cd web && npm run build
rsync -avz --delete web/dist/ user@your-server:~/safebox-web/
ssh user@your-server "sudo cp -r ~/safebox-web/* /data/websites/snailtrail.org/safebox/web/ && \
    sudo chown -R safebox:safebox /data/websites/snailtrail.org/safebox/web/ && \
    sudo systemctl reload nginx"

# 4. 数据库迁移（如有 schema 变更）
ssh user@your-server "sudo -u safebox bash -c 'cd /data/websites/snailtrail.org/safebox/server && PYTHONPATH=. venv/bin/alembic upgrade head' && sudo systemctl restart safebox"

# 5. 验证
curl https://your-domain.com/health
```

> rsync -> sudo cp 两步：部署用户不能直接写 `/data/`（root 写）。

---

## 三、运维与排查

### 日志
```bash
ssh user@your-server 'sudo tail -f /var/log/safebox/error.log'      # 应用错误
ssh user@your-server 'sudo tail -f /var/log/safebox/access.log'     # 访问
ssh user@your-server 'sudo journalctl -u safebox -n 50 --no-pager'  # systemd
ssh user@your-server 'sudo tail -f /var/log/nginx/access.log'       # Nginx
```

### 手动启动测试（排查启动失败）
```bash
cd /data/websites/snailtrail.org/safebox/server
source venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000   # Ctrl+C 停
```

### 数据库备份
```bash
# /home/safebox/backup.sh
#!/bin/bash
BACKUP_DIR=/home/safebox/backups
mkdir -p $BACKUP_DIR
pg_dump -U safebox safebox | gzip > $BACKUP_DIR/safebox_$(date +%Y%m%d_%H%M%S).sql.gz
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete
# crontab: 0 3 * * * /home/safebox/backup.sh
```

---

## 四、常见问题

| 症状 | 原因 | 解决 |
|---|---|---|
| psql 报 `Peer authentication failed` | pg_hba 默认 peer | 改 `local all all peer` -> `md5`，重启 PostgreSQL |
| `postgresql-setup --datadir` 报错 | Amazon Linux 2023 移除 | initdb 默认 + mv + systemd override |
| `systemctl enable redis` 找不到 | 包名 redis6 | 用 `redis6`，配置 `/etc/redis6/redis6.conf` |
| `systemctl enable safebox` 报符号链接 | 损坏 symlink | 删 `/etc/systemd/system/safebox.service` 重建 + daemon-reload |
| `str | None` SyntaxError | Python 3.9 | 用 python3.11 -m venv |
| HTTPS 404 | Nginx 配置未生效 | `nginx -t` + reload，确认 `try_files ... /index.html` |
| 刷新 /settings 404 | SPA 回退未配 | Nginx `location /` 加 `try_files $uri $uri/ /index.html` |
| rsync /data 权限拒绝 | /data root 写 | rsync 到家目录 + sudo cp |
| 认证 API 401 `session expired` | K 通信 session_key 过期/Redis 故障 | 重 SRP 登录重建 K（正常防 downgrade） |

---

## 五、附录：Apache 配置（备选，不推荐）

生产推荐 Nginx。若必须用 Apache：

```bash
sudo dnf install -y httpd mod_ssl
sudo systemctl enable --now httpd
```

`/etc/httpd/conf.d/safebox.conf`（ProxyPreserveHost + ProxyPass /api/ -> 127.0.0.1:8000 + DocumentRoot web + FallbackResource /index.html + SSL + 安全头），Let's Encrypt 用 `certbot --apache`。

> Apache 配置含证书路径等敏感信息，不提交 git。
