#!/usr/bin/env bash
# Khởi động LifeMate Lab: cài phụ thuộc (lần đầu), build UI nếu chưa có, chạy server tại http://127.0.0.1:8765
set -euo pipefail
cd "$(dirname "$0")"
PORT=${PORT:-8765}
if [ ! -x .venv/bin/python ]; then
  uv sync --extra dev
fi
.venv/bin/python -c "import lab, agent_core" 2>/dev/null || uv pip install -e . >/dev/null
if [ ! -f ui/dist/index.html ] || [ "${REBUILD_UI:-0}" = "1" ]; then
  (cd ui && npm install --no-audit --no-fund && npm run build)
fi
echo "LifeMate Lab: http://127.0.0.1:${PORT}"
exec .venv/bin/python -m lab serve --port "$PORT"
