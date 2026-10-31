"""Cache LLM/ASR (SQLite riêng) và wrapper tính chi phí."""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
from pathlib import Path

from agent_core.types import LLMResponse, ToolCall

from .models import cost_of
from .paths import CACHE_PATH


class KV:
    def __init__(self, path: Path = CACHE_PATH):
        self.path = path
        self._local = threading.local()

    def _c(self):
        c = getattr(self._local, "c", None)
        if c is None:
            c = sqlite3.connect(self.path, timeout=30, check_same_thread=False)
            c.execute("PRAGMA journal_mode=WAL")
            c.execute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT, ts REAL)")
            c.commit()
            self._local.c = c
        return c

    def get(self, k: str):
        r = self._c().execute("SELECT v FROM kv WHERE k=?", (k,)).fetchone()
        return json.loads(r[0]) if r else None

    def put(self, k: str, v):
        c = self._c()
        c.execute("INSERT OR REPLACE INTO kv VALUES (?,?,?)", (k, json.dumps(v, ensure_ascii=False), time.time()))
        c.commit()


def _h(obj) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, ensure_ascii=False, default=str).encode()).hexdigest()


class MeteredLLM:
    """Bọc LLMBackend: cache theo nội dung request + tính chi phí + ghi usage qua `sink(model_id, kind, usage, cost, cached)`."""

    def __init__(self, inner, model_id: str, price: dict, use_cache: bool = True, sink=None, kv: KV | None = None):
        self.inner, self.model_id, self.price, self.use_cache, self.sink = inner, model_id, price, use_cache, sink
        self.kv = kv or KV()
        self.cfg = inner.cfg
        self.plugin_name = getattr(inner, "plugin_name", "")

    def step(self, system, messages, tools, ctx=None) -> LLMResponse:
        key = None
        if self.use_cache and self.plugin_name != "oracle":
            key = "llm:" + _h([self.inner.cache_material(), system, messages, [t.__dict__ for t in tools]])
            hit = self.kv.get(key)
            if hit:
                r = LLMResponse(text=hit["text"], tool_calls=[ToolCall(**c) for c in hit["tool_calls"]], usage=hit["usage"],
                                stop_reason=hit.get("stop_reason"), raw=hit.get("raw"), cached=True, latency_s=0.0)
                if self.sink:
                    self.sink(self.model_id, "llm", r.usage, 0.0, True)
                return r
        r = self.inner.step(system, messages, tools, ctx)
        r.cost = cost_of(r.usage, self.price)
        if self.sink:
            self.sink(self.model_id, "llm", r.usage, r.cost, False)
        if key and not r.error:
            self.kv.put(key, {"text": r.text, "tool_calls": [c.__dict__ for c in r.tool_calls], "usage": r.usage,
                              "stop_reason": r.stop_reason, "raw": r.raw})
        return r

    def complete(self, system, messages, ctx=None):
        return self.step(system, messages, [], ctx)


class MeteredASR:
    def __init__(self, inner, model_id: str, price: dict, use_cache: bool = True, sink=None, kv: KV | None = None):
        self.inner, self.model_id, self.price, self.use_cache, self.sink = inner, model_id, price, use_cache, sink
        self.kv = kv or KV()
        self.cfg = inner.cfg

    def transcribe_file(self, path):
        mat = self.inner.cache_material()
        key = None
        if self.use_cache and mat is not None:
            fh = hashlib.sha1(Path(path).read_bytes()).hexdigest() if Path(path).is_file() else str(path)
            key = "asr:" + _h([mat, fh])
            hit = self.kv.get(key)
            if hit:
                if self.sink:
                    self.sink(self.model_id, "asr", hit.get("usage", {}), 0.0, True)
                return {**hit, "cached": True, "latency_s": 0.0}
        r = self.inner.transcribe_file(path)
        r["cost"] = cost_of(r.get("usage", {}), self.price)
        if self.sink:
            self.sink(self.model_id, "asr", r.get("usage", {}), r["cost"], False)
        if key and not r.get("error"):
            self.kv.put(key, r)
        return r

    def transcribe_sample(self, sample, split_dir):
        if getattr(self.inner, "plugin_name", "") in ("gold", "transcript_file"):
            return self.inner.transcribe_sample(sample, split_dir)
        out = {}
        for rel in sample.user_audios():
            out[rel] = self.transcribe_file(Path(split_dir) / rel)
        return out
