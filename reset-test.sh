#!/bin/bash
# 清空服务器数据库 + Redis，跑迁移，重启，验证
set -euo pipefail

SSH_HOST="michael@snailtrail.org"
DST=/data/websites/snailtrail.org/safebox

echo "=== 1. 清理 Redis ==="
ssh "$SSH_HOST" 'sudo /usr/bin/redis6-cli FLUSHALL && echo "  Redis 已清空"'

echo ""
echo "=== 2. 清理 PostgreSQL ==="
ssh "$SSH_HOST" <<'DBEOF'
sudo -u postgres psql <<'PSQL'
DROP DATABASE IF EXISTS safebox WITH (FORCE);
CREATE DATABASE safebox OWNER safebox;
\c safebox
GRANT ALL ON SCHEMA public TO safebox;
PSQL
echo "  数据库已重建"
DBEOF

echo ""
echo "=== 3. 跑 Alembic 迁移 ==="
ssh "$SSH_HOST" "sudo -u safebox bash -c 'cd $DST/server && PYTHONPATH=$DST/server $DST/server/venv/bin/alembic upgrade head' && echo '  迁移完成'"

echo ""
echo "=== 4. 重启服务 ==="
ssh "$SSH_HOST" 'sudo systemctl restart safebox && echo "  服务已重启"'
sleep 2

echo ""
echo "=== 5. 验证健康检查 ==="
ssh "$SSH_HOST" 'curl -sf http://127.0.0.1:8000/health && echo ""' && echo "  ✅ 健康检查通过"

echo ""
echo "=== 6. HTTPS 可达性 ==="
curl -sf https://safebox.snailtrail.org/health && echo "  ✅ HTTPS 可达"

echo ""
echo "✅ 全部完成 — 数据库和 Redis 已清空，服务正常运行"
