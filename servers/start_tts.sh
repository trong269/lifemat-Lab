#!/usr/bin/env bash
# Server TTS Piper tiếng Việt (CPU, chỉ dùng lúc phát triển): http://127.0.0.1:${PORT:-9100}/v1
#   ./servers/start_tts.sh        bật          ./servers/start_tts.sh stop   tắt
set -euo pipefail
cd "$(dirname "$0")/.."
PORT=${PORT:-9100}
PIDF=servers/.tts_${PORT}.pid
if [ "${1:-}" = "stop" ]; then
  [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null && rm -f "$PIDF" && echo "đã tắt" || echo "không có server đang chạy"; exit 0
fi
if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "đang chạy (pid $(cat "$PIDF"))"; exit 0; fi
if [ ! -x servers/.venv/bin/python ]; then uv venv -q -p 3.12 servers/.venv; fi
servers/.venv/bin/python -c "import piper" 2>/dev/null || VIRTUAL_ENV=servers/.venv uv pip install -q -r servers/requirements-sherpa.txt piper-tts
M=models/piper-vi; mkdir -p "$M"
for v in vais1000/medium/vi_VN-vais1000-medium vivos/x_low/vi_VN-vivos-x_low; do for e in onnx onnx.json; do
  f="$M/$(basename $v).$e"; [ -f "$f" ] || curl -sfL -o "$f" "https://huggingface.co/rhasspy/piper-voices/resolve/main/vi/vi_VN/$v.$e"
done; done
setsid nohup servers/.venv/bin/python servers/tts_server.py --voices "$M" --host "${HOST:-127.0.0.1}" --port "$PORT" > servers/tts_${PORT}.log 2>&1 < /dev/null &
echo $! > "$PIDF"
for i in $(seq 1 60); do curl -sf "http://127.0.0.1:${PORT}/health" | grep -q '"ok":true' && break; sleep 1; done
curl -sf "http://127.0.0.1:${PORT}/health" && echo && echo "TTS server: http://${HOST:-127.0.0.1}:${PORT}/v1  (log: servers/tts_${PORT}.log)"
