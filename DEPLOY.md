# SafeBox 生产环境部署指南

> 部署目标：Amazon Linux 2023
> 部署路径：`/data/websites/snailtrail.org/safebox/`（可按需修改）
> 数据库路径：`/data/databases/pgsql/`（可按需修改）
> 部署用户：需要有 sudo 权限的 SSH 用户
> 最后更新：2026-07-08

## 目标架构

```
Internet → Nginx (TLS + 反代) ─┬─ /api/* → Uvicorn (127.0.0.1:8000) → FastAPI → PostgreSQL + Redis
                               └─ /*     → 静态文件 (web/dist/)
```

Nginx 同时承担：TLS 终止、API 反代、Web 客户端静态文件服务。后端以独立 `safebox` 用户运行（安全隔离）。

> 备选方案：Nginx 为首选推荐。如果团队更熟悉 Apache，可参考 [附录：Apache 配置](#apache-配置)。

---

## 一、一次性环境准备

以下操作只在首次部署时做一次。

### 1.1 安装依赖（Amazon Linux 2023）

```bash
sudo dnf install -y python3 python3-pip python3.11 \
    postgresql15-server postgresql15 \
    redis6 nginx
```

注意：Amazon Linux 2023 的包名是 `postgresql15-server`、`redis6`，不是 `postgresql-server`、`redis`。

### 1.2 初始化 PostgreSQL（数据目录自定义到 /data/databases/pgsql）

Amazon Linux 2023 的 `postgresql-setup` 已移除 `--datadir` 参数。需要先初始化到默认位置再移动：

```bash
# 1. 初始化到默认位置
sudo postgresql-setup --initdb

# 2. 停止服务，移动数据目录
sudo systemctl stop postgresql
sudo mv /var/lib/pgsql/data /data/databases/pgsql

# 3. 创建 systemd override 指向新目录
sudo mkdir -p /etc/systemd/system/postgresql.service.d
sudo tee /etc/systemd/system/postgresql.service.d/override.conf <<'EOF'
[Service]
Environment=PGDATA=/data/databases/pgsql
EOF
sudo systemctl daemon-reload

# 4. 启动 PostgreSQL
sudo systemctl enable --now postgresql
```

验证：`sudo -u postgres psql -c "SHOW data_directory;"` 应输出 `/data/databases/pgsql`。

### 1.3 配置 pg_hba.conf 允许密码认证

数据目录移到了 `/data/databases/pgsql/`，配置文件也在这里：

```bash
# 修改认证方式
sudo sed -i 's/^local\s\+all\s\+all\s\+peer/local   all             all                                     md5/' /data/databases/pgsql/pg_hba.conf
sudo sed -i 's/^host\s\+all\s\+all\s\+127.0.0.1\/32\s\+ident/host    all             all             127.0.0.1\/32            scram-sha-256/' /data/databases/pgsql/pg_hba.conf

# 同时修改 listen_addresses
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

Amazon Linux 2023 的 Redis 服务名是 `redis6`，配置文件在 `/etc/redis6/redis6.conf`：

```bash
# 绑定本地 + 设置密码
sudo sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis6/redis6.conf
# 如需密码: sudo sed -i 's/^# requirepass .*/requirepass 你的Redis密码/' /etc/redis6/redis6.conf

sudo systemctl enable --now redis6
```

Redis 只用于验证码临时存储（5 分钟过期），不需要持久化，用系统默认目录即可。

### 1.6 创建系统用户和目录

```bash
# 创建 safebox 用户（后端进程以此用户运行）
sudo useradd -m safebox

# 创建部署目录
sudo mkdir -p /data/websites/snailtrail.org/safebox/{server,web}
sudo mkdir -p /var/log/safebox

# 权限
sudo chown -R safebox:safebox /data/websites/snailtrail.org/safebox /var/log/safebox

# Nginx 需要读 Web 文件
sudo usermod -a -G safebox nginx
sudo chmod 750 /data/websites/snailtrail.org/safebox
sudo chmod 750 /data/websites/snailtrail.org/safebox/web
```

**重要**：部署用户通常不能直接写 `/data/` 目录。代码推送流程是：rsync 到用户家目录 → `sudo cp` 到目标路径。

### 1.7 首次部署应用代码

```bash
# 在开发机上推送代码
rsync -avz --delete \
    --exclude='__pycache__/' --exclude='*.pyc' \
    --exclude='venv/' --exclude='.env' \
    --exclude='test.db' --exclude='.pytest_cache/' \
    server/ user@your-server:~/safebox-server/

# SSH 到服务器
ssh user@your-server

# 移入目标目录
sudo cp -r ~/safebox-server/* /data/websites/snailtrail.org/safebox/server/
sudo chown -R safebox:safebox /data/websites/snailtrail.org/safebox/server/

# 创建虚拟环境（用 python3.11，Amazon Linux 2023 默认 Python 3.9 不支持 str | None 语法）
cd /data/websites/snailtrail.org/safebox/server
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 1.8 配置环境变量

创建 `/data/websites/snailtrail.org/safebox/server/.env`：

```bash
# 数据库
SAFEBOX_DATABASE_URL=postgresql+asyncpg://safebox:你的数据库密码@localhost:5432/safebox

# JWT（用 openssl rand -hex 32 生成）
SAFEBOX_JWT_SECRET_KEY=替换为随机64字符hex

# Redis（如果设了密码）
SAFEBOX_REDIS_URL=redis://:你的Redis密码@localhost:6379/0
# 如果没设密码: SAFEBOX_REDIS_URL=redis://localhost:6379/0

# Twilio 短信 — 可选
SAFEBOX_TWILIO_ACCOUNT_SID=
SAFEBOX_TWILIO_AUTH_TOKEN=
SAFEBOX_TWILIO_PHONE_NUMBER=+1234567890

# Email — 可选
SAFEBOX_SMTP_HOST=
SAFEBOX_SMTP_PORT=587
SAFEBOX_SMTP_USERNAME=
SAFEBOX_SMTP_PASSWORD=
SAFEBOX_SMTP_FROM=noreply@your-domain.com
SAFEBOX_GOOGLE_CLIENT_ID=
```

**注意**：`.env` 包含数据库密码和 JWT 密钥，不要提交到 git，已在 `.gitignore` 中排除。

### 1.9 数据库迁移

```bash
cd /data/websites/snailtrail.org/safebox/server
source venv/bin/activate
alembic upgrade head
```

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
    -k uvicorn.workers.UvicornWorker \
    -w 2 \
    -b 127.0.0.1:8000 \
    --access-logfile /var/log/safebox/access.log \
    --error-logfile /var/log/safebox/error.log \
    --capture-output
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

注意：`After=` 和 `Wants=` 里的 Redis 服务名是 `redis6.service`（Amazon Linux 2023），不是 `redis.service`。

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now safebox
sudo systemctl status safebox
```

如果遇到 "Too many levels of symbolic links" 错误，检查 `/etc/systemd/system/safebox.service` 是否链到了不存在的文件，删除重建即可。

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

    # TLS 证书（Let's Encrypt）
    ssl_certificate     /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;

    # 安全头
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # 最大上传 5MB
    client_max_body_size 5M;

    # API 反代
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

    # 静态文件（Web 客户端 SPA）
    location / {
        root  /data/websites/snailtrail.org/safebox/web;
        try_files $uri $uri/ /index.html;
    }
}
```

重载 Nginx：

```bash
sudo nginx -t && sudo systemctl reload nginx
```

**注意**：修改 Nginx 配置后必须 reload，否则 HTTPS 或 SPA 路由可能不生效。

### 1.12 防火墙

```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 1.13 验证部署

```bash
# 本地验证后端
curl http://127.0.0.1:8000/health
# → {"status":"ok"}

# HTTPS 验证
curl https://your-domain.com/health
# → {"status":"ok"}

# API 文档
# 浏览器: https://your-domain.com/docs
```

### 1.14 配置 HTTPS（Let's Encrypt）

```bash
# 安装 certbot
sudo dnf install -y certbot python3-certbot-nginx

# 获取证书（Nginx 模式自动配置）
sudo certbot --nginx -d your-domain.com

# 自动续期（certbot 通常已安装 systemd timer）
sudo systemctl enable --now certbot.timer
```

验证续期：`sudo certbot renew --dry-run`

## 二、日常部署（重复操作）

### 日常部署步骤

```bash
# 1. 推送后端代码
rsync -avz --delete \
    --exclude='__pycache__/' --exclude='*.pyc' \
    --exclude='venv/' --exclude='.env' \
    --exclude='test.db' --exclude='.pytest_cache/' \
    server/ user@your-server:~/safebox-server/

# 2. 移入目标目录并重启
ssh user@your-server "sudo cp -r ~/safebox-server/* /data/websites/snailtrail.org/safebox/server/ && sudo chown -R safebox:safebox /data/websites/snailtrail.org/safebox/server/ && sudo systemctl restart safebox"

# 3. 推送 Web 客户端（可选）
cd web && npm run build
rsync -avz --delete web/dist/ user@your-server:~/safebox-web/
ssh user@your-server "sudo cp -r ~/safebox-web/* /data/websites/snailtrail.org/safebox/web/ && sudo chown -R safebox:safebox /data/websites/snailtrail.org/safebox/web/ && sudo systemctl reload nginx"

# 4. 验证
curl https://your-domain.com/health
```

### 为什么是 rsync → sudo cp 两步

部署用户通常不能直接写 `/data/` 等系统目录。所以流程是：

1. rsync 到部署用户家目录（有写权限）
2. `sudo cp` 到目标路径（sudo 提权）
3. `sudo chown -R safebox:safebox` 修正权限

### 数据库迁移（如有 schema 变更）

```bash
ssh user@your-server "sudo -u safebox bash -c 'cd /data/websites/snailtrail.org/safebox/server && PYTHONPATH=. venv/bin/alembic upgrade head'"
sudo systemctl restart safebox
```

---

## 三、运维与排查

### 查看日志

```bash
# 应用日志（gunicorn access/error）
ssh user@your-server 'sudo tail -f /var/log/safebox/error.log'
ssh user@your-server 'sudo tail -f /var/log/safebox/access.log'

# systemd 日志（启动失败时用）
ssh user@your-server 'sudo journalctl -u safebox -n 50 --no-pager'

# Nginx 日志
ssh user@your-server 'sudo tail -f /var/log/nginx/access.log'
ssh user@your-server 'sudo tail -f /var/log/nginx/error.log'
```

### 手动启动测试（排查启动失败）

```bash
cd /data/websites/snailtrail.org/safebox/server
source venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000
# Ctrl+C 停止
```

---

## 四、常见问题

### PostgreSQL: pg_hba.conf peer/ident 认证错误

症状：`psql -U safebox` 报 `Peer authentication failed`
原因：pg_hba.conf 默认 peer 认证
解决：修改 `/data/databases/pgsql/pg_hba.conf`，把 `local all all peer` 改为 `md5`，重启 PostgreSQL。

### PostgreSQL: postgresql-setup --datadir 报错

症状：`ERROR: Removed option --new-systemd-unit/--datadir`
原因：Amazon Linux 2023 移除了 `--datadir` 参数
解决：先 initdb 到默认位置，再 `mv` 数据目录，用 systemd override 指向新目录。

### Redis 服务名不对

症状：`systemctl enable redis` 找不到服务
原因：Amazon Linux 2023 的 Redis 包名叫 `redis6`，服务名也是 `redis6`
解决：所有 systemctl 命令用 `redis6`，配置文件在 `/etc/redis6/redis6.conf`。

### Systemd: Too many levels of symbolic links

症状：`systemctl enable safebox` 报错
原因：`/etc/systemd/system/safebox.service` 可能是损坏的符号链接
解决：删除 `/etc/systemd/system/safebox.service`，重新 `tee` 创建文件，再 `systemctl daemon-reload && systemctl enable --now safebox`。

### Python: str | None 语法错误

症状：`uvicorn app.main:app` 报 `SyntaxError` 关于 `str | None`
原因：Amazon Linux 2023 默认 Python 3.9 不支持 `str | None` 类型联合语法（需要 3.10+）
解决：用 `python3.11 -m venv venv` 创建虚拟环境。

### HTTPS 返回 404 或 Nginx 错误

症状：`curl https://your-domain.com/health` 返回 404，但 `http://127.0.0.1:8000/health` 正常
原因：Nginx 配置未生效或 server_name 不匹配
解决：检查 `/etc/nginx/conf.d/safebox.conf` 存在且语法正确（`sudo nginx -t`），然后 `sudo systemctl reload nginx`。

### Web 客户端刷新返回 404

症状：访问 `https://your-domain.com/settings` 返回 404
原因：SPA 路由回退未配置
解决：Nginx 的 `location /` 块中确保有 `try_files $uri $uri/ /index.html`。

### 部署用户不能写 /data 目录

症状：rsync 直接到 `/data/websites/...` 权限拒绝
原因：`/data/` 目录只允许 root 写入
解决：rsync 到部署用户家目录，再 `sudo cp` 到目标路径。

---

## 五、监控与备份

### 数据库备份

```bash
# 在服务器上创建 /home/safebox/backup.sh
#!/bin/bash
BACKUP_DIR=/home/safebox/backups
mkdir -p $BACKUP_DIR
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -U safebox safebox | gzip > $BACKUP_DIR/safebox_$DATE.sql.gz
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

# crontab: 0 3 * * * /home/safebox/backup.sh
```

### 升级流程

```bash
# 执行日常部署步骤（见上节）
# 如有 schema 变更，额外执行：
ssh user@your-server "sudo -u safebox bash -c 'cd /data/websites/snailtrail.org/safebox/server && PYTHONPATH=. venv/bin/alembic upgrade head' && sudo systemctl restart safebox"
```

---

## 附录：Apache 配置（备选，不推荐）

如果你出于某种原因必须使用 Apache 而非 Nginx，可参考以下配置。生产环境推荐使用 Nginx。

### 安装与基本配置

```bash
# Amazon Linux 2023 可能需要单独安装 mod_ssl
sudo dnf install -y httpd mod_ssl

sudo systemctl enable --now httpd
```

### 创建 `/etc/httpd/conf.d/safebox.conf`

```apache
<VirtualHost *:443>
    ServerName your-domain.com

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/your-domain.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/your-domain.com/privkey.pem

    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "DENY"

    # API 反代
    ProxyPreserveHost On
    ProxyPass /api/ http://127.0.0.1:8000/api/
    ProxyPassReverse /api/ http://127.0.0.1:8000/api/
    ProxyPass /health http://127.0.0.1:8000/health
    ProxyPassReverse /health http://127.0.0.1:8000/health

    # 静态文件（Web 客户端 SPA）
    DocumentRoot /data/websites/snailtrail.org/safebox/web
    <Directory /data/websites/snailtrail.org/safebox/web>
        Options -Indexes
        AllowOverride None
        Require all granted
        FallbackResource /index.html
    </Directory>

    LimitRequestBody 5242880
    ProxyTimeout 60

    ErrorLog  /var/log/httpd/safebox-error.log
    CustomLog /var/log/httpd/safebox-access.log combined
</VirtualHost>

# HTTP → HTTPS 重定向
<VirtualHost *:80>
    ServerName your-domain.com
    Redirect permanent / https://your-domain.com/
</VirtualHost>
```

### Let's Encrypt（Apache 模式）

```bash
sudo dnf install -y certbot python3-certbot-apache
sudo certbot --apache -d your-domain.com
sudo systemctl reload httpd
```

> ⚠️ `safebox.conf` 包含证书路径等敏感信息，不要提交到 git。
