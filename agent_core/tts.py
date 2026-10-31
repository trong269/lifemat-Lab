"""TTS (chỉ dùng lúc phát triển, để sinh audio tổng hợp). Trả về bytes WAV; chuyển 16 kHz mono + augmentation nằm ở training/gen_synthetic/audio.py."""
from __future__ import annotations

import os

import httpx
from pydantic import BaseModel, Field

from .registry import register


class OpenAITTSConfig(BaseModel):
    model: str = "gpt-4o-mini-tts"
    base_url: str | None = None
    api_key: str | None = Field(None, json_schema_extra={"secret": True})
    api_key_env: str | None = "OPENAI_API_KEY"
    instructions: str = Field("", description="Hướng dẫn giọng đọc (model hỗ trợ), vd 'giọng miền Nam, nói tự nhiên'")
    timeout_s: float = 120


@register("tts", "openai_tts", OpenAITTSConfig, "Endpoint /audio/speech (OpenAI hoặc server tương thích)")
class OpenAITTS:
    def __init__(self, cfg: OpenAITTSConfig):
        import openai

        self.cfg = cfg
        key = cfg.api_key or (os.environ.get(cfg.api_key_env) if cfg.api_key_env else None) or "EMPTY"
        self.client = openai.OpenAI(api_key=key, base_url=cfg.base_url or None, timeout=cfg.timeout_s)

    def synthesize(self, text: str, voice: str, speed: float = 1.0, instructions: str = "") -> bytes:
        kw = dict(model=self.cfg.model, voice=voice, input=text, response_format="wav", speed=speed)
        ins = instructions or self.cfg.instructions
        if ins:
            kw["instructions"] = ins
        r = self.client.audio.speech.create(**kw)
        return r.read() if hasattr(r, "read") else r.content


class HttpTTSConfig(BaseModel):
    url: str = Field(..., description="POST JSON {text, voice, speed} -> audio/wav")
    api_key: str | None = Field(None, json_schema_extra={"secret": True})
    timeout_s: float = 120


@register("tts", "http_tts", HttpTTSConfig, "Server TTS tự host (POST JSON trả WAV)")
class HttpTTS:
    def __init__(self, cfg: HttpTTSConfig):
        self.cfg = cfg

    def synthesize(self, text: str, voice: str, speed: float = 1.0, instructions: str = "") -> bytes:
        h = {"Authorization": f"Bearer {self.cfg.api_key}"} if self.cfg.api_key else {}
        r = httpx.post(self.cfg.url, json={"text": text, "voice": voice, "speed": speed, "instructions": instructions},
                       headers=h, timeout=self.cfg.timeout_s)
        r.raise_for_status()
        return r.content
