"""Nhà cung cấp, khoá API, Model registry, bảng giá và tính chi phí.

- Khoá API lưu ở lab_data/secrets.json (quyền 600), không bao giờ ghi vào cấu hình, trace hay log.
- Model registry: mỗi model (LLM / ASR / TTS) = nhà cung cấp + tên model + tham số + giá + thông tin kiểm tra luật.
"""
from __future__ import annotations

import json
import os
import time

from . import db
from .paths import SECRETS_PATH

DEFAULT_PROVIDERS = [
    {"id": "anthropic", "kind": "anthropic", "base_url": None, "api_key_env": "ANTHROPIC_API_KEY", "notes": "Claude"},
    {"id": "openai", "kind": "openai_compat", "base_url": None, "api_key_env": "OPENAI_API_KEY", "notes": "OpenAI API"},
    {"id": "gemini", "kind": "openai_compat", "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
     "api_key_env": "GEMINI_API_KEY", "notes": "Gemini qua endpoint OpenAI-compatible"},
    {"id": "openrouter", "kind": "openai_compat", "base_url": "https://openrouter.ai/api/v1", "api_key_env": "OPENROUTER_API_KEY",
     "notes": "OpenRouter"},
    {"id": "vllm", "kind": "openai_compat", "base_url": "http://localhost:8000/v1", "api_key_env": None,
     "notes": "vLLM / llama.cpp tự host (sửa base_url thành địa chỉ máy GPU thuê)"},
    {"id": "asr_server", "kind": "openai_compat", "base_url": "http://localhost:9000/v1", "api_key_env": None,
     "notes": "servers/asr_server.py trên máy GPU thuê"},
    {"id": "local", "kind": "builtin", "base_url": None, "api_key_env": None, "notes": "Plugin nội bộ (oracle, gold, file)"},
]

DEFAULT_MODELS = [
    {"id": "oracle", "name": "Oracle (phát lại đáp án)", "role": "llm", "provider_id": "local", "plugin": "oracle", "config": {},
     "price": {}, "source": "builtin", "submit_ok": 0, "notes": "Kiểm thử pipeline, chỉ dùng với dữ liệu có nhãn"},
    {"id": "gold-asr", "name": "Transcript gold (audio_text)", "role": "asr", "provider_id": "local", "plugin": "gold", "config": {},
     "price": {}, "source": "builtin", "submit_ok": 0, "notes": "Dùng audio_text có sẵn của train / dữ liệu tổng hợp"},
]

PRICE_FIELDS = {"input": "USD / 1 triệu token vào", "output": "USD / 1 triệu token ra", "cache_read": "USD / 1 triệu token đọc cache",
                "cache_write": "USD / 1 triệu token ghi cache", "audio_min": "USD / phút audio", "chars_1k": "USD / 1000 ký tự (TTS)"}


def seed():
    for p in DEFAULT_PROVIDERS:
        if not db.get("providers", id=p["id"]):
            db.insert("providers", {**p, "created": time.time()})
    for m in DEFAULT_MODELS:
        if not db.get("models", id=m["id"]):
            db.insert("models", {**m, "created": time.time()})


# ---------- secrets ----------
def _load_secrets() -> dict:
    if SECRETS_PATH.is_file():
        return json.loads(SECRETS_PATH.read_text() or "{}")
    return {}


def set_secret(provider_id: str, key: str | None):
    s = _load_secrets()
    if key:
        s[provider_id] = key
    else:
        s.pop(provider_id, None)
    SECRETS_PATH.write_text(json.dumps(s))
    os.chmod(SECRETS_PATH, 0o600)


def provider_key(provider_id: str) -> str | None:
    s = _load_secrets()
    if s.get(provider_id):
        return s[provider_id]
    p = db.get("providers", id=provider_id)
    if p and p.get("api_key_env"):
        return os.environ.get(p["api_key_env"])
    return None


def key_status(provider_id: str) -> str:
    s = _load_secrets()
    if s.get(provider_id):
        k = s[provider_id]
        return f"đã lưu (…{k[-4:]})"
    p = db.get("providers", id=provider_id)
    if p and p.get("api_key_env") and os.environ.get(p["api_key_env"]):
        return f"từ biến môi trường {p['api_key_env']}"
    return "chưa có"


# ---------- model -> plugin spec ----------
PLUGIN_BY_ROLE = {("llm", "anthropic"): "anthropic", ("llm", "openai_compat"): "openai_compat",
                  ("asr", "openai_compat"): "openai_asr", ("tts", "openai_compat"): "openai_tts"}


def model_spec(model_id: str, overrides: dict | None = None) -> tuple[str, dict, dict]:
    """-> (kind, plugin spec có khoá API, giá). kind ∈ llm | asr | tts."""
    m = db.get("models", id=model_id)
    if not m:
        raise KeyError(f"không có model '{model_id}' trong registry")
    p = db.get("providers", id=m["provider_id"]) or {"kind": "builtin"}
    plugin = m.get("plugin") or PLUGIN_BY_ROLE.get((m["role"], p["kind"]))
    if not plugin:
        raise ValueError(f"không biết plugin cho model {model_id} ({m['role']}, {p['kind']})")
    spec = {"plugin": plugin, **(m.get("config") or {})}
    if p["kind"] != "builtin":
        if p.get("base_url") and not spec.get("base_url"):
            spec["base_url"] = p["base_url"]
        key = provider_key(p["id"])
        if key:
            spec["api_key"] = key
        elif p["kind"] == "openai_compat" and p.get("base_url") and not p.get("api_key_env"):
            spec["api_key"] = "EMPTY"
    if overrides:
        spec.update(overrides)
    return m["role"], spec, m.get("price") or {}


def check_model_ready(model_id: str) -> str | None:
    """None = sẵn sàng; ngược lại là thông báo lỗi tiếng Việt."""
    m = db.get("models", id=model_id)
    if not m:
        return f"không có model '{model_id}'"
    p = db.get("providers", id=m["provider_id"]) or {"kind": "builtin"}
    if p["kind"] == "builtin":
        return None
    if p.get("api_key_env") and not provider_key(p["id"]):
        return f"chưa có khoá API cho nhà cung cấp '{p['id']}' (nhập ở mục Khoá API hoặc đặt biến {p['api_key_env']})"
    if not (m.get("config") or {}).get("model"):
        return f"model '{model_id}' chưa điền tên model"
    return None


# ---------- cost ----------
def cost_of(usage: dict, price: dict) -> float:
    if not price or not usage:
        return 0.0
    c = 0.0
    inp = usage.get("input_tokens", 0) or 0
    c += inp * price.get("input", 0) / 1e6
    c += (usage.get("output_tokens", 0) or 0) * price.get("output", 0) / 1e6
    # không ghi giá cache riêng -> dùng hệ số do adapter báo (Anthropic: đọc 0.1x, ghi 1.25x; OpenAI-compatible: đọc 0.5x)
    cr = price.get("cache_read", price.get("input", 0) * usage.get("cache_read_ratio", 1.0))
    cw = price.get("cache_write", price.get("input", 0) * usage.get("cache_write_ratio", 1.0))
    c += (usage.get("cache_read_tokens", 0) or 0) * cr / 1e6
    c += (usage.get("cache_write_tokens", 0) or 0) * cw / 1e6
    c += (usage.get("audio_seconds", 0) or 0) / 60 * price.get("audio_min", 0)
    c += (usage.get("chars", 0) or 0) / 1000 * price.get("chars_1k", 0)
    return c


def log_usage(owner: str, model_id: str, kind: str, usage: dict, cost: float, cached: bool):
    db.insert("usage_log", {"ts": time.time(), "owner": owner, "model_id": model_id, "kind": kind,
                            "input_tokens": usage.get("input_tokens", 0), "output_tokens": usage.get("output_tokens", 0),
                            "cache_read_tokens": usage.get("cache_read_tokens", 0), "audio_seconds": usage.get("audio_seconds", 0),
                            "chars": usage.get("chars", 0), "cost": cost, "cached": int(cached)})
