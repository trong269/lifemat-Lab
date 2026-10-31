#!/usr/bin/env bash
# Khởi động vLLM (LLM) + server ASR trong container, chờ sẵn sàng, rồi chạy suy luận trên /data.
set -euo pipefail
DATA=${DATA:-/data}
OUT=${OUT:-/app/result/submission.jsonl}
LLM_GPU_UTIL=${LLM_GPU_UTIL:-0.70}

python -m vllm.entrypoints.openai.api_server --model /models/llm --served-model-name lifemate-llm \
  --host 127.0.0.1 --port 8000 --max-model-len 16384 --seed 0 --gpu-memory-utilization "$LLM_GPU_UTIL" \
  --enable-auto-tool-choice --tool-call-parser hermes > /tmp/vllm.log 2>&1 &
python /app/servers/asr_server.py --model /models/asr --host 127.0.0.1 --port 9000 > /tmp/asr.log 2>&1 &

for i in $(seq 1 600); do
  if curl -sf http://127.0.0.1:8000/health >/dev/null && curl -sf http://127.0.0.1:9000/health | grep -q '"ok":true'; then break; fi
  sleep 1
done
curl -sf http://127.0.0.1:8000/health >/dev/null || { echo "vLLM không khởi động được"; tail -50 /tmp/vllm.log; exit 1; }

mkdir -p "$(dirname "$OUT")"
python -m agent_core.infer --data "$DATA" --out "$OUT" --config /app/agent_core/submit_config.yaml
