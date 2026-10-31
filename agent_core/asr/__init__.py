"""ASR: audio -> transcript cho lượt cuối và các lượt user trong history.

- gold:            dùng audio_text có sẵn (train / dữ liệu tổng hợp) — tách riêng lỗi của agent
- transcript_file: nạp file JSONL transcript có sẵn
- openai_asr:      mọi endpoint dạng OpenAI /audio/transcriptions: API OpenAI, vLLM (Whisper), servers/asr_server.py trên GPU thuê
Hậu xử lý (postprocess): vi_numbers — đổi số đọc bằng chữ sang chữ số.
"""
from __future__ import annotations

import json
import time
import wave
from pathlib import Path

from pydantic import BaseModel, Field

from ..registry import register
from ..types import Sample
from ..vi_numbers import convert as vi_convert


def audio_seconds(path: Path) -> float:
    try:
        with wave.open(str(path)) as w:
            return w.getnframes() / float(w.getframerate())
    except (wave.Error, FileNotFoundError, EOFError):
        return 0.0


class ASRBackend:
    cfg: BaseModel

    def transcribe_file(self, path: Path) -> dict:
        raise NotImplementedError

    def transcribe_sample(self, sample: Sample, split_dir: Path) -> dict[str, dict]:
        out = {}
        for rel in sample.user_audios():
            out[rel] = self.transcribe_file(Path(split_dir) / rel)
        return out

    def cache_material(self) -> dict | None:
        """None = không cache (vd gold)."""
        d = self.cfg.model_dump(exclude={"api_key", "api_key_env", "timeout_s"})
        d["plugin"] = getattr(self, "plugin_name", "")
        return d


class GoldConfig(BaseModel):
    pass


@register("asr", "gold", GoldConfig, "Dùng audio_text có sẵn (chỉ có ở train và dữ liệu tổng hợp)")
class GoldASR(ASRBackend):
    def __init__(self, cfg):
        self.cfg = cfg

    def cache_material(self):
        return None

    def transcribe_sample(self, sample, split_dir):
        out = {}
        for t in sample.history:
            if t.role == "user" and t.audio:
                out[t.audio] = {"text": t.text or "", "latency_s": 0.0, "error": None if t.text is not None else "không có audio_text"}
        if sample.audio:
            out[sample.audio] = {"text": sample.audio_text or "", "latency_s": 0.0,
                                 "error": None if sample.audio_text is not None else "không có audio_text"}
        return out


class TranscriptFileConfig(BaseModel):
    path: str = Field(..., description="File JSONL transcript (xem định dạng bên dưới)")


TEXT_KEYS = ("asr_text", "text", "transcript", "hyp", "pred", "prediction")


def _text_of(d: dict):
    for k in TEXT_KEYS:
        if isinstance(d.get(k), str):
            return d[k]
    return None


def parse_transcript_file(path: str) -> tuple[dict[str, dict], dict[str, str]]:
    """Hai định dạng (có thể trộn):
    1. theo mẫu: {"id": "train_0001", "asr_text": "...", "history": [{"role": "user", "asr_text": "..."}, {"role": "assistant", ...}]}
       -> lượt user thứ k trong history ứng với audio user thứ k của mẫu (thứ tự giữ nguyên)
    2. theo file audio: {"audio": "audio/<id>/<id>_u1.wav" | "file": ... , "text": "..."}
    Trả về (theo_mẫu {id: {"final": str|None, "history": [str|None]}}, theo_file {tên_file_không_đuôi: str})."""
    by_sample, by_file = {}, {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            d = json.loads(line)
            key = d.get("audio") or d.get("file") or d.get("audio_path")
            if key:
                t = _text_of(d)
                if t is not None:
                    by_file[Path(key).stem] = t
                continue
            if d.get("id") is not None:
                hist = [_text_of(t) for t in d.get("history") or [] if t.get("role") == "user"]
                by_sample[str(d["id"])] = {"final": _text_of(d), "history": hist}
    return by_sample, by_file


@register("asr", "transcript_file", TranscriptFileConfig, "Dùng transcript từ file JSONL (vd kết quả ASR do thành viên khác chạy và gửi)")
class TranscriptFileASR(ASRBackend):
    def __init__(self, cfg):
        self.cfg = cfg
        self.by_sample, self.by_file = parse_transcript_file(cfg.path)

    def cache_material(self):
        return None

    def transcribe_file(self, path):
        t = self.by_file.get(Path(path).stem)
        return {"text": t or "", "latency_s": 0.0, "error": None if t is not None else "không có trong file transcript"}

    def transcribe_sample(self, sample, split_dir):
        rec = self.by_sample.get(sample.id)
        if rec is None:
            return super().transcribe_sample(sample, split_dir)
        out = {}
        users = [t for t in sample.history if t.role == "user" and t.audio]
        for k, t in enumerate(users):
            txt = rec["history"][k] if k < len(rec["history"]) else None
            if txt is None:
                txt = self.by_file.get(Path(t.audio).stem)
            out[t.audio] = {"text": txt or "", "latency_s": 0.0, "error": None if txt is not None else "thiếu transcript lượt history"}
        if sample.audio:
            txt = rec["final"] if rec["final"] is not None else self.by_file.get(Path(sample.audio).stem)
            out[sample.audio] = {"text": txt or "", "latency_s": 0.0, "error": None if txt is not None else "thiếu transcript lượt cuối"}
        return out


class OpenAIASRConfig(BaseModel):
    model: str = Field("whisper-1", description="Tên model ở endpoint")
    base_url: str | None = Field(None, description="vd http://<gpu-box>:9000/v1 cho servers/asr_server.py; trống = API OpenAI")
    api_key: str | None = Field(None, json_schema_extra={"secret": True})
    api_key_env: str | None = "OPENAI_API_KEY"
    language: str = "vi"
    prompt: str = Field("", description="Gợi ý từ vựng (tuỳ chọn)")
    temperature: float = 0.0
    timeout_s: float = 60
    max_retries: int = 2


@register("asr", "openai_asr", OpenAIASRConfig, "Endpoint /audio/transcriptions (OpenAI API, vLLM Whisper, asr_server trên GPU thuê)")
class OpenAIASR(ASRBackend):
    def __init__(self, cfg: OpenAIASRConfig):
        import os

        import openai

        self.cfg = cfg
        key = cfg.api_key or (os.environ.get(cfg.api_key_env) if cfg.api_key_env else None) or "EMPTY"
        self.client = openai.OpenAI(api_key=key, base_url=cfg.base_url or None, timeout=cfg.timeout_s, max_retries=cfg.max_retries)
        self._openai = openai

    def transcribe_file(self, path):
        t0 = time.time()
        secs = audio_seconds(Path(path))
        try:
            with open(path, "rb") as f:
                kw = dict(model=self.cfg.model, file=f, language=self.cfg.language or None, temperature=self.cfg.temperature)
                if self.cfg.prompt:
                    kw["prompt"] = self.cfg.prompt
                r = self.client.audio.transcriptions.create(**{k: v for k, v in kw.items() if v is not None})
            text = r.text if hasattr(r, "text") else str(r)
            return {"text": text.strip(), "latency_s": time.time() - t0, "usage": {"audio_seconds": secs}, "error": None}
        except (self._openai.APIError, OSError) as e:
            return {"text": "", "latency_s": time.time() - t0, "usage": {"audio_seconds": secs}, "error": str(e)[:300]}


class ViNumbersConfig(BaseModel):
    pass


@register("postprocess", "vi_numbers", ViNumbersConfig, "Đổi số đọc bằng chữ sang chữ số (ba trăm rưỡi -> 350)")
class ViNumbers:
    def __init__(self, cfg):
        self.cfg = cfg

    def apply(self, text: str) -> str:
        return vi_convert(text)


class ReplaceConfig(BaseModel):
    pairs: dict[str, str] = Field(default_factory=dict, description="Thay thế cụm từ: {\"sai\": \"đúng\"}")


@register("postprocess", "replace", ReplaceConfig, "Thay thế cụm từ theo từ điển")
class Replace:
    def __init__(self, cfg):
        self.cfg = cfg

    def apply(self, text: str) -> str:
        for a, b in self.cfg.pairs.items():
            text = text.replace(a, b)
        return text
