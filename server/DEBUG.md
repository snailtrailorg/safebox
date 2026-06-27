# SafeBox 后端本地调试指南

## 前置条件

在 Fedora 上安装 PostgreSQL 和 Redis：

```bash
sudo dnf install -y postgresql-server postgresql redis
```

## 1. 初始化数据库

```bash
# 初始化 PostgreSQL 数据目录
sudo postgresql-setup --initdb

# 启动服务
sudo systemctl start postgresql
sudo systemctl start redis

# 开机自启
sudo systemctl enable postgresql redis
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

## 3. 验证连接

```bash
psql -h localhost -U safebox -d safebox -c "SELECT 1;"
```

如果提示 peer authentication failed，需要修改 `/var/lib/pgsql/data/pg_hba.conf`：

```
# 把 local all all peer 改为
local   all             all                                     md5
# 把 host all all 127.0.0.1/32 ident 改为
host    all             all             127.0.0.1/32            md5
```

然后重启 PostgreSQL：

```bash
sudo systemctl restart postgresql
```

## 4. 配置环境变量

```bash
cd server/
cp .env.example .env
# 编辑 .env，填入实际的配置值
```

## 5. 运行数据库迁移

```bash
cd server/
alembic upgrade head
```

## 6. 启动开发服务器

```bash
cd server/
make dev
# 或者: uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 7. 运行测试

```bash
cd server/
make test
```

## 8. API 文档

启动后访问：
- Swagger UI: http://localhost:8000/docs
- ReDoc: http://localhost:8000/redoc
- 健康检查: http://localhost:8000/health
