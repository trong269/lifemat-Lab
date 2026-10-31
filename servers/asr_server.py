"""Server ASR tương thích OpenAI `/v1/audio/transcriptions` — platform gọi qua plugin `openai_asr` (base_url http://<máy>:<port>/v1).

Hai backend:
- sherpa-onnx (Zipformer / transducer ONNX, chạy CPU, không cần torch):
      pip install -r servers/requirements-sherpa.txt
      python servers/asr_server.py --backend sherpa-onnx --model models/zipformer-30m-rnnt-vi --port 9000
  Thư mục model cần encoder*.onnx, decoder*.onnx, joiner*.onnx và file token (tokens.txt hoặc config.json dạng "token id").
- transformers (Whisper / PhoWhisper...):
      pip install -r servers/requirements-asr.txt
      python servers/asr_server.py --backend transformers --model vinai/PhoWhisper-medium --port 9000
Giải mã greedy (tất định).
"""
from __future__ import annotations

import argparse
import io
import threading
import time
from pathlib import Path

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile

app = FastAPI(title="LifeMate ASR server")
STATE: dict = {}


# ---------------- backends ----------------
def load_transformers(model: str, device: str, dtype: str, chunk_s: int):
    import torch
    from transformers import pipeline

    torch.manual_seed(0)
    td = {"float16": torch.float16, "bfloat16": torch.bfloat16, "float32": torch.float32}[dtype]
    pipe = pipeline("automatic-speech-recognition", model=model, torch_dtype=td, device=device, chunk_length_s=chunk_s or None)

    def run(x, language: str) -> str:
        gen = {"num_beams": 1, "do_sample": False}
        if STATE.get("whisper", True):
            gen.update(language=language or "vi", task="transcribe")
        try:
            out = pipe({"raw": x, "sampling_rate": 16000}, generate_kwargs=gen)
        except (TypeError, ValueError):
            STATE["whisper"] = False           # không phải Whisper: bỏ language/task
            out = pipe({"raw": x, "sampling_rate": 16000}, generate_kwargs={"num_beams": 1, "do_sample": False})
        return (out.get("text") if isinstance(out, dict) else str(out)).strip()

    return run


def _pick(d: Path, prefix: str, int8: bool) -> str:
    files = sorted(d.glob(f"{prefix}*.onnx"))
    pref = [f for f in files if (".int8." in f.name) == int8] or files
    if not pref:
        raise FileNotFoundError(f"không thấy {prefix}*.onnx trong {d}")
    return str(pref[0])


def load_sherpa(model: str, int8: bool, threads: int, decoding: str, provider: str = "cpu"):
    import sherpa_onnx

    d = Path(model)
    tokens = d / "tokens.txt" if (d / "tokens.txt").is_file() else d / "config.json"
    rec = sherpa_onnx.OfflineRecognizer.from_transducer(
        tokens=str(tokens), encoder=_pick(d, "encoder", int8), decoder=_pick(d, "decoder", int8), joiner=_pick(d, "joiner", int8),
        num_threads=threads, sample_rate=16000, feature_dim=80, decoding_method=decoding, provider=provider)
    lock = threading.Lock()

    def run(x, language: str) -> str:
        s = rec.create_stream()
        s.accept_waveform(16000, x)
        with lock:
            rec.decode_stream(s)
        return s.result.text.strip()

    return run


def read_audio(data: bytes):
    import numpy as np
    import soundfile as sf

    x, sr = sf.read(io.BytesIO(data), dtype="float32", always_2d=False)
    if x.ndim > 1:
        x = x.mean(axis=1)
    if sr != 16000:
        from scipy.signal import resample_poly

        g = np.gcd(sr, 16000)
        x = resample_poly(x, 16000 // g, sr // g).astype("float32")
    return x


def postprocess(text: str) -> str:
    """Model Zipformer trả chữ IN HOA: đưa về chữ thường để LLM dễ đọc."""
    t = " ".join(text.split())
    return t.lower() if STATE.get("lowercase") else t


# ---------------- API ----------------
@app.get("/health")
def health():
    return {"ok": "run" in STATE, "model": STATE.get("name"), "backend": STATE.get("backend")}


@app.get("/v1/models")
def list_models():
    return {"object": "list", "data": [{"id": STATE.get("name", "asr"), "object": "model", "owned_by": STATE.get("backend")}]}


@app.post("/v1/audio/transcriptions")
def transcribe(file: UploadFile = File(...), model: str = Form("asr"), language: str = Form("vi"),
               prompt: str = Form(""), temperature: float = Form(0.0), response_format: str = Form("json")):
    t0 = time.time()
    try:
        x = read_audio(file.file.read())
    except Exception as e:
        raise HTTPException(400, f"không đọc được file audio: {e}") from e
    text = postprocess(STATE["run"](x, language))
    if response_format == "text":
        return text
    return {"text": text, "duration": round(len(x) / 16000, 3), "latency_s": round(time.time() - t0, 3)}


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--backend", choices=["sherpa-onnx", "transformers"], default="transformers")
    ap.add_argument("--model", required=True, help="thư mục model (sherpa-onnx) hoặc model HF / checkpoint (transformers)")
    ap.add_argument("--name", default=None, help="tên model trả về ở /v1/models (mặc định: tên thư mục)")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=9000)
    ap.add_argument("--threads", type=int, default=4, help="sherpa-onnx: số luồng CPU")
    ap.add_argument("--int8", action="store_true", help="sherpa-onnx: dùng bản int8 (nhanh hơn, kém chính xác hơn chút)")
    ap.add_argument("--provider", default="cpu", help="sherpa-onnx: cpu | cuda (cần bản sherpa-onnx có CUDA)")
    ap.add_argument("--decoding", default="greedy_search", help="sherpa-onnx: greedy_search | modified_beam_search")
    ap.add_argument("--keep-case", action="store_true", help="giữ nguyên hoa/thường của model (mặc định đưa về chữ thường)")
    ap.add_argument("--device", default="cuda:0")
    ap.add_argument("--dtype", default="float16")
    ap.add_argument("--chunk-s", type=int, default=0)
    a = ap.parse_args()
    STATE["backend"] = a.backend
    STATE["name"] = a.name or Path(a.model.rstrip("/")).name
    STATE["lowercase"] = not a.keep_case
    if a.backend == "sherpa-onnx":
        STATE["run"] = load_sherpa(a.model, a.int8, a.threads, a.decoding, a.provider)
    else:
        STATE["lowercase"] = False
        STATE["run"] = load_transformers(a.model, a.device, a.dtype, a.chunk_s)
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
