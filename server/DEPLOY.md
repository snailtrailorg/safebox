# SafeBox 生产环境部署指南

## 目标架构

```
Internet → Apache (TLS) → Uvicorn (127.0.0.1:8000) → FastAPI → PostgreSQL + Redis
```

## 服务器要求

| 资源 | 最低 | 推荐 |
|------|------|------|
| OS | Ubuntu 22.04+ / Rocky 9+ / Fedora 38+ |
| CPU | 1 核 | 2 核 |
| 内存 | 512 MB | 1 GB |
| 磁盘 | 20 GB SSD | 40 GB SSD |
| 网络 | 公网 IP + 开放 443 端口 |

---

## 一、基础环境

### 1.1 创建用户

```bash
useradd -m -s /bin/bash safebox
sudo -u safebox mkdir -p /home/safebox/server
```

### 1.2 安装依赖 (以 Ubuntu 为例)

```bash
# Python
sudo apt update
sudo apt install -y python3 python3-pip python3-venv

# PostgreSQL
sudo apt install -y postgresql postgresql-client

# Redis
sudo apt install -y redis-server

# Apache (如果还没装)
sudo apt install -y apache2
```

### 1.3 启动服务

```bash
sudo systemctl enable --now postgresql redis-server
```

---

## 二、数据库配置

### 2.1 创建用户和数据库

```bash
sudo -u postgres psql <<SQL
CREATE USER safebox WITH PASSWORD '你的强密码';
CREATE DATABASE safebox OWNER safebox;
GRANT ALL PRIVILEGES ON DATABASE safebox TO safebox;
\c safebox
GRANT ALL ON SCHEMA public TO safebox;
SQL
```

### 2.2 安全加固

编辑 `/etc/postgresql/*/main/postgresql.conf`：

```ini
listen_addresses = 'localhost'   # 只监听本地
password_encryption = scram-sha-256
```

编辑 `/etc/postgresql/*/main/pg_hba.conf`：

```
# IPv4 local connections:
host    all             all             127.0.0.1/32            scram-sha-256
```

```bash
sudo systemctl restart postgresql
```

---

## 三、Redis 配置

编辑 `/etc/redis/redis.conf`：

```ini
bind 127.0.0.1
requirepass 你的Redis密码
maxmemory 128mb
maxmemory-policy allkeys-lru
```

```bash
sudo systemctl restart redis-server
```

---

## 四、应用部署

### 4.1 上传代码

```bash
# 在开发机上
rsync -avz server/ safebox@your-vps:/home/safebox/server/

# 或 git clone + 忽略
```

### 4.2 创建虚拟环境

```bash
cd /home/safebox/server
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install gunicorn  # 生产环境用 gunicorn + uvicorn workers
```

### 4.3 环境变量

创建 `/home/safebox/server/.env`：

```bash
# 数据库
SAFEBOX_DATABASE_URL=postgresql+asyncpg://safebox:你的数据库密码@localhost:5432/safebox

# JWT — 用 openssl rand -hex 32 生成
SAFEBOX_JWT_SECRET_KEY=替换为随机32字节hex

# Redis
SAFEBOX_REDIS_URL=redis://:你的Redis密码@localhost:6379/0

# SMS (阿里云) — 可选
SAFEBOX_SMS_ACCESS_KEY_ID=
SAFEBOX_SMS_ACCESS_KEY_SECRET=
SAFEBOX_SMS_SIGN_NAME=SafeBox
SAFEBOX_SMS_TEMPLATE_CODE=

# Email — 可选
SAFEBOX_SMTP_HOST=
SAFEBOX_SMTP_PORT=587
SAFEBOX_SMTP_USERNAME=
SAFEBOX_SMTP_PASSWORD=
SAFEBOX_SMTP_FROM=noreply@你的域名

# Google OAuth — 可选
SAFEBOX_GOOGLE_CLIENT_ID=
```

生成 JWT 密钥：

```bash
openssl rand -hex 32
```

### 4.4 数据库迁移

```bash
cd /home/safebox/server
source venv/bin/activate
alembic upgrade head
```

### 4.5 验证

```bash
source venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8000
# 另开终端
curl http://127.0.0.1:8000/health
# 应返回 {"status":"ok"}
```

Ctrl+C 停止测试。

---

## 五、Systemd 服务

创建 `/etc/systemd/system/safebox.service`：

```ini
[Unit]
Description=SafeBox API Server
After=network.target postgresql.service redis-server.service
Wants=postgresql.service redis-server.service

[Service]
Type=simple
User=safebox
Group=safebox
WorkingDirectory=/home/safebox/server
EnvironmentFile=/home/safebox/server/.env
ExecStart=/home/safebox/server/venv/bin/gunicorn app.main:app \
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

创建日志目录：

```bash
sudo mkdir -p /var/log/safebox
sudo chown safebox:safebox /var/log/safebox
```

启动：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now safebox
sudo systemctl status safebox
```

---

## 六、Apache 反代配置

### 6.1 启用模块

```bash
# Ubuntu/Debian
sudo a2enmod proxy proxy_http ssl headers

# Fedora/RHEL: 模块已内置，确认 LoadModule 在 httpd.conf 中
```

### 6.2 VirtualHost

创建 `/etc/apache2/sites-available/safebox-api.conf`（Ubuntu）或 `/etc/httpd/conf.d/safebox-api.conf`（Fedora）：

```apache
<VirtualHost *:443>
    ServerName api.safebox.你的域名.com

    # TLS 证书 (见下一节)
    SSLEngine on
    SSLCertificateFile      /etc/letsencrypt/live/api.safebox.你的域名.com/fullchain.pem
    SSLCertificateKeyFile   /etc/letsencrypt/live/api.safebox.你的域名.com/privkey.pem

    # 安全头
    Header always set Strict-Transport-Security "max-age=31536000; includeSubDomains"
    Header always set X-Content-Type-Options "nosniff"
    Header always set X-Frame-Options "DENY"

    # 反代到 FastAPI
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8000/
    ProxyPassReverse / http://127.0.0.1:8000/

    # 请求体大小限制 (同步最大 500 条条目)
    LimitRequestBody 5242880

    # 超时
    ProxyTimeout 60

    # 日志
    ErrorLog  ${APACHE_LOG_DIR}/safebox-api-error.log
    CustomLog ${APACHE_LOG_DIR}/safebox-api-access.log combined
</VirtualHost>

# HTTP → HTTPS 重定向
<VirtualHost *:80>
    ServerName api.safebox.你的域名.com
    Redirect permanent / https://api.safebox.你的域名.com/
</VirtualHost>
```

### 6.3 启用站点

```bash
# Ubuntu/Debian
sudo a2ensite safebox-api
sudo systemctl reload apache2

# Fedora/RHEL
sudo systemctl reload httpd
```

---

## 七、TLS 证书 (Let's Encrypt)

```bash
# 安装 certbot
sudo apt install -y certbot python3-certbot-apache   # Ubuntu
# 或
sudo dnf install -y certbot python3-certbot-apache   # Fedora

# 申请证书
sudo certbot --apache -d api.safebox.你的域名.com

# 自动续期 (certbot 自动添加了 systemd timer)
sudo certbot renew --dry-run
```

---

## 八、防火墙

```bash
# UFW (Ubuntu)
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# Firewalld (Fedora)
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

---

## 九、验证部署

### 9.1 健康检查

```bash
curl https://api.safebox.你的域名.com/health
# → {"status":"ok"}
```

### 9.2 注册测试

```bash
curl -X POST https://api.safebox.你的域名.com/api/v1/auth/register/email \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password_hash": "test_hash",
    "password_salt": "test_salt",
    "password_wrapped": "test_wrapped",
    "recovery_wrapped": "test_recovery",
    "encrypted_private": "test_enc_priv",
    "rsa_public_key": "test_rsa_pub",
    "device_name": "Test Device",
    "device_public_key": "test_device_pub",
    "device_wrapped": "test_device_wrapped"
  }'
# → {"user_id":"...", "access_token":"...", "refresh_token":"..."}
```

### 9.3 同步测试

```bash
curl https://api.safebox.你的域名.com/api/v1/sync/pull?since=2020-01-01T00:00:00+00:00 \
  -H "Authorization: Bearer 上一步返回的access_token"
# → {"items":[], "server_time":"...", "has_more":false}
```

---

## 十、监控与维护

### 10.1 日志

```bash
# 应用日志
sudo journalctl -u safebox -f

# Apache 日志
sudo tail -f /var/log/apache2/safebox-api-access.log   # Ubuntu
sudo tail -f /var/log/httpd/safebox-api-access.log     # Fedora

# PostgreSQL 日志
sudo tail -f /var/log/postgresql/postgresql-*.log
```

### 10.2 数据库备份

```bash
# 创建备份脚本 /home/safebox/backup.sh
#!/bin/bash
BACKUP_DIR=/home/safebox/backups
mkdir -p $BACKUP_DIR
DATE=$(date +%Y%m%d_%H%M%S)
pg_dump -U safebox safebox | gzip > $BACKUP_DIR/safebox_$DATE.sql.gz
# 保留最近 30 天的备份
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

# 加入 crontab (每天凌晨 3 点)
# 0 3 * * * /home/safebox/backup.sh
```

### 10.3 升级

```bash
cd /home/safebox/server
source venv/bin/activate
git pull  # 或 rsync 上传新代码
alembic upgrade head
sudo systemctl restart safebox
```

---

## 十一、Android 客户端配置

修改 `app/src/main/java/org/snailtrail/safebox/AppModule.kt` 中的 baseUrl：

```kotlin
fun provideApiService(client: OkHttpClient): ApiService {
    val baseUrl = "https://api.safebox.你的域名.com/"  // ← 改这里
    return Retrofit.Builder()
        .baseUrl(baseUrl)
        // ...
}
```
