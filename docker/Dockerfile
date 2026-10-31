# Docker nộp bài: chỉ agent_core + server ASR + vLLM + trọng số model. Platform (lab/, ui/) KHÔNG nằm trong image.
#   docker build -f docker/Dockerfile -t lifemate:submit .
#   docker run --rm --gpus all --network none -v /path/private_test:/data -v $PWD/result:/app/result lifemate:submit
# Ghim BASE_IMAGE vào một phiên bản cụ thể của vllm/vllm-openai (phát hành trước 26/10/2026) trước khi nộp.
ARG BASE_IMAGE=vllm/vllm-openai:v0.11.0
FROM ${BASE_IMAGE}

ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 PYTHONHASHSEED=0 CUBLAS_WORKSPACE_CONFIG=:4096:8 PYTHONUNBUFFERED=1
WORKDIR /app

COPY servers/requirements-asr.txt /tmp/requirements-asr.txt
RUN pip install --no-cache-dir -r /tmp/requirements-asr.txt pydantic pyyaml httpx openai

COPY agent_core /app/agent_core
COPY servers /app/servers
COPY docker/run.sh /app/run.sh
# trọng số: đặt sẵn trong models/llm và models/asr trước khi build
COPY models/llm /models/llm
COPY models/asr /models/asr

RUN chmod +x /app/run.sh
ENTRYPOINT ["/app/run.sh"]
