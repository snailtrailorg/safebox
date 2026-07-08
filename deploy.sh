#!/bin/bash
# SafeBox 日常部署 — 推送代码 + 重启
# 用法: ./deploy.sh user@host [--web]
set -euo pipefail

SSH="${1:-}"; WEB=false; [[ "${2:-}" == "--web" ]] && WEB=true
[[ -z "$SSH" ]] && { echo "用法: $0 user@host [--web]"; exit 1; }

DST=/data/websites/snailtrail.org/safebox

echo "▶  推送后端..."
rsync -avz --delete \
    --exclude='__pycache__/' --exclude='*.pyc' \
    --exclude='venv/' --exclude='.env' \
    --exclude='test.db' --exclude='.pytest_cache/' \
    server/ "$SSH:~/safebox-server/"

ssh "$SSH" "sudo cp -r ~/safebox-server/* $DST/server/ && sudo chown -R safebox:safebox $DST/server"

if $WEB; then
    echo "▶  构建并推送 Web..."
    (cd web && npm run build)
    rsync -avz --delete web/dist/ "$SSH:~/safebox-web/"
    ssh "$SSH" "sudo cp -r ~/safebox-web/* $DST/web/ && sudo chown -R safebox:safebox $DST/web && sudo systemctl reload nginx"
fi

echo "▶  重启服务..."
ssh "$SSH" 'sudo systemctl restart safebox && echo "  OK: $(sudo systemctl is-active safebox)"'

sleep 2
ssh "$SSH" 'curl -s http://127.0.0.1:8000/health'
echo "✅ 完成"
