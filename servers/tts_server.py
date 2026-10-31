"""Server TTS tương thích OpenAI `/v1/audio/speech` dùng Piper (ONNX, CPU) — chỉ dùng lúc phát triển để sinh audio tổng hợp.

    python servers/tts_server.py --voices models/piper-vi --port 9100

Mỗi file *.onnx (kèm *.onnx.json) trong thư mục là một giọng. Tham số `voice` của request:
- "<tên giọng>"            vd "vi_VN-vais1000-medium"
- "<tên giọng>:<speaker>"  với giọng nhiều người đọc, vd "vi_VN-vivos-x_low:12"
- "random"                 chọn ngẫu nhiên một giọng / người đọc
Platform gọi qua plugin `openai_tts` (base_url http://<máy>:<port>/v1).
"""
from __future__ import annotations

import argparse
import io
import json
import random
import threading
import wave
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel

app = FastAPI(title="LifeMate TTS server")
VOICES: dict[str, dict] = {}
LOCK = threading.Lock()


class SpeechRequest(BaseModel):
    model: str = "piper"
    input: str
    voice: str = "random"
    speed: float = 1.0
    response_format: str = "wav"
    instructions: str | None = None       # Piper không dùng; nhận để tương thích


def load(dirpath: str):
    from piper import PiperVoice

    for f in sorted(Path(dirpath).glob("*.onnx")):
        cfg = json.loads(Path(str(f) + ".json").read_text(encoding="utf-8"))
        VOICES[f.stem] = {"voice": PiperVoice.load(str(f)), "speakers": int(cfg.get("num_speakers", 1)),
                          "sample_rate": cfg.get("audio", {}).get("sample_rate")}
    if not VOICES:
        raise SystemExit(f"không có giọng *.onnx trong {dirpath}")


def resolve(name: str) -> tuple[str, int | None]:
    if not name or name == "random" or (":" not in name and name not in VOICES):   # vd "alloy" -> ngẫu nhiên
        v = random.choice(list(VOICES))
        n = VOICES[v]["speakers"]
        return v, (random.randrange(n) if n > 1 else None)
    base, _, spk = name.partition(":")
    if base not in VOICES:
        raise HTTPException(400, f"không có giọng '{base}' (có: {list(VOICES)})")
    n = VOICES[base]["speakers"]
    sid = int(spk) if spk else (0 if n > 1 else None)
    if sid is not None and not 0 <= sid < n:
        raise HTTPException(400, f"giọng {base} chỉ có {n} người đọc")
    return base, sid


@app.get("/health")
def health():
    return {"ok": bool(VOICES), "voices": {k: v["speakers"] for k, v in VOICES.items()}}


@app.get("/v1/models")
def models():
    return {"object": "list", "data": [{"id": k, "object": "model", "speakers": v["speakers"]} for k, v in VOICES.items()]}


@app.post("/v1/audio/speech")
def speech(req: SpeechRequest):
    from piper import SynthesisConfig

    text = (req.input or "").strip()
    if not text:
        raise HTTPException(400, "input rỗng")
    if req.response_format not in ("wav", "pcm"):
        raise HTTPException(400, "chỉ hỗ trợ response_format wav")
    name, sid = resolve(req.voice)
    cfg = SynthesisConfig(speaker_id=sid, length_scale=1.0 / max(0.5, min(2.0, req.speed or 1.0)))
    buf = io.BytesIO()
    with LOCK, wave.open(buf, "wb") as w:
        VOICES[name]["voice"].synthesize_wav(text, w, syn_config=cfg)
    return Response(buf.getvalue(), media_type="audio/wav", headers={"x-voice": f"{name}:{sid}" if sid is not None else name})


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--voices", default="models/piper-vi")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=9100)
    a = ap.parse_args()
    load(a.voices)
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")
