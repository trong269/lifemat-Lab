#!/usr/bin/env bash
# Chạy server ASR Zipformer (sherpa-onnx) ở nền.
#   ./servers/start_zipformer.sh                      Zipformer-30M  ở http://127.0.0.1:9000/v1
#   MODEL=150m ./servers/start_zipformer.sh           Zipformer-150M ở http://127.0.0.1:9001/v1
#   MODEL=150m ./servers/start_zipformer.sh stop      tắt
# Biến môi trường: MODEL (30m | 150m), PORT (mặc định 9000 / 9001), HOST (127.0.0.1; 0.0.0.0 để máy khác gọi được),
#   THREADS (4 / 8), INT8=1 (bản int8), PROVIDER=cuda (cần servers/.venv-gpu có sherpa-onnx bản CUDA)
set -euo pipefail
cd "$(dirname "$0")/.."
MODEL=${MODEL:-30m}
if [ "$MODEL" = "150m" ]; then
  PORT=${PORT:-9001}; THREADS=${THREADS:-8}; M=models/zipformer-150m-crctc-rnnt-vi; REPO=hynt/ZipFormer-150M-CR-CTC-RNNT-6000h; EP=epoch-11-avg-2; NAME=zipformer-150m
else
  PORT=${PORT:-9000}; THREADS=${THREADS:-4}; M=models/zipformer-30m-rnnt-vi; REPO=hynt/Zipformer-30M-RNNT-6000h; EP=epoch-20-avg-10; NAME=zipformer-30m-rnnt
fi
PY=servers/.venv/bin/python
[ "${PROVIDER:-cpu}" = "cuda" ] && PY=servers/.venv-gpu/bin/python
PIDF=servers/.zipformer_${PORT}.pid
if [ "${1:-}" = "stop" ]; then
  [ -f "$PIDF" ] && kill "$(cat "$PIDF")" 2>/dev/null && rm -f "$PIDF" && echo "đã tắt" || echo "không có server đang chạy"
  exit 0
fi
if [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF")" 2>/dev/null; then echo "đang chạy (pid $(cat "$PIDF"))"; exit 0; fi
if [ ! -x servers/.venv/bin/python ]; then
  uv venv -q -p 3.12 servers/.venv && VIRTUAL_ENV=servers/.venv uv pip install -q -r servers/requirements-sherpa.txt
fi
if [ ! -f "$M/encoder-$EP.onnx" ]; then
  mkdir -p "$M"
  for f in config.json encoder-$EP.onnx decoder-$EP.onnx joiner-$EP.onnx encoder-$EP.int8.onnx decoder-$EP.int8.onnx joiner-$EP.int8.onnx; do
    curl -sfL -o "$M/$f" "https://huggingface.co/$REPO/resolve/main/$f"
  done
fi
EXTRA=()
[ "${INT8:-0}" = "1" ] && EXTRA+=(--int8)
setsid nohup "$PY" servers/asr_server.py --backend sherpa-onnx --model "$M" --name "$NAME" --provider "${PROVIDER:-cpu}" \
  --host "${HOST:-127.0.0.1}" --port "$PORT" --threads "$THREADS" "${EXTRA[@]}" > servers/zipformer_${PORT}.log 2>&1 &
echo $! > "$PIDF"
for i in $(seq 1 60); do curl -sf "http://127.0.0.1:${PORT}/health" | grep -q '"ok":true' && break; sleep 1; done
curl -sf "http://127.0.0.1:${PORT}/health" && echo && echo "ASR server: http://${HOST:-127.0.0.1}:${PORT}/v1  (log: servers/zipformer_${PORT}.log)"
