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
cp docs/env.example .env
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
# 后端（两个终端窗口）
cd server && source venv/bin/activate && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Web 前端
cd web && npm install && npm run dev
```

- 前端: http://localhost:5173
- 后端: http://localhost:8000
- Swagger: http://localhost:8000/docs
- 健康检查: http://localhost:8000/health

Vite dev server 自动把 `/api/` 请求转发到后端 `localhost:8000`，不需要单独访问后端。

## 6. 运行测试

```bash
# 后端
cd server && make test

# Web 前端
cd web && npm test
```

## 7. 常见调试问题

### 验证码怎么看？

本地开发时 SMTP 未配置，发送验证码时会打印到 uvicorn 终端：
```
[DEV] 验证码 123456 应发送到 user@example.com
```

### 测试失败：注册返回 422

测试里的注册请求缺少 `verification_code` 字段。schema 要求必填，即使测试也应该传 `"verification_code": "000000"`。

### 验证码被消费但注册失败

可能原因：RSA 密钥生成太慢导致超时（浏览器端 PBKDF2 600k 迭代 + RSA-4096 生成约 500ms-2s）。检查浏览器控制台和网络面板。

### Web Crypto 跨平台兼容

Web Crypto API 的 RSA-OAEP 分块大小必须与 Android `CryptoManager.kt` 一致（446 字节/块（OAEP-SHA256））。`web/src/__tests__/cross-platform.test.ts` 已验证字节级兼容。

### 600k 次 PBKDF2 卡顿

在浏览器中约 200-500ms，仅在登录/注册时执行一次。如需优化，可移到 Web Worker 避免阻塞主线程。

## 8. API 调试

Vite 配置了代理转发，所以前端 fetch `/api/v1/auth/...` 会自动到 `localhost:8000`。如果直接用 curl：

```bash
# 注册
curl -X POST http://localhost:8000/api/v1/auth/register/email \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","verification_code":"123456","password_hash":"h","password_salt":"s","password_wrapped":"w","encrypted_private":"e","rsa_public_key":"p"}'

# 健康检查
curl http://localhost:8000/health
```
