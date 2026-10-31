"""Server giả lập OpenAI Chat Completions + Anthropic Messages, phát lại đáp án train (tra theo câu user cuối).

    .venv/bin/python -m uvicorn tests.mock_llm_server:app --port 8799

Dùng để kiểm thử end-to-end các adapter LLM mà không cần khoá API.
"""
from __future__ import annotations

import json
import time

from fastapi import FastAPI, Request

from agent_core.data import load_samples
from agent_core.render import api_name
from lab.core.datasets import train_root

TRAIN_ROOT = train_root()

app = FastAPI()
BY_TEXT = {}
for s in load_samples(TRAIN_ROOT, "train"):
    BY_TEXT.setdefault(s.audio_text, s)


def _next_call(last_user: str, n_done: int):
    s = BY_TEXT.get(last_user)
    gold = (s.label or {}).get("tool_calls", []) if s else []
    return gold[n_done] if n_done < len(gold) else None


TEXTS = sorted(t for t in BY_TEXT if t)


@app.post("/v1/chat/completions")
async def chat(req: Request):
    b = await req.json()
    msgs = b["messages"]
    system = msgs[0]["content"] if msgs and msgs[0]["role"] == "system" else ""
    last = max(i for i, m in enumerate(msgs) if m["role"] == "user")
    tools = {t["function"]["name"] for t in b.get("tools", [])}
    if not tools and "tạo dữ liệu huấn luyện" in system:          # vai writer của Data Studio
        utt = TEXTS[hash(msgs[last]["content"]) % len(TEXTS)]
        content = json.dumps({"utterance": utt, "expected": "làm theo yêu cầu", "target_apps": []}, ensure_ascii=False)
        return {"id": "x", "object": "chat.completion", "created": int(time.time()), "model": b["model"],
                "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 800, "completion_tokens": 60, "total_tokens": 860}}
    done = sum(len(m.get("tool_calls") or []) for m in msgs[last:] if m["role"] == "assistant")
    c = _next_call(msgs[last]["content"], done)
    if c is not None and api_name(c["name"]) not in tools:
        c = None
    if c is None and done == 0 and msgs[last]["content"] not in BY_TEXT:   # câu lạ: đọc một tool rồi dừng
        reads = sorted(t for t in tools if t.endswith(("__list", "__search", "__get_status", "__get_balance", "__list_bills")))
        if reads:
            c = {"name": reads[0].replace("__", ".", 1), "arguments": {"query": "Lan"} if reads[0].endswith("search") else {}}
    msg = {"role": "assistant", "content": "Đã xong."}
    if c is not None:
        assert api_name(c["name"]) in tools, f"tool {c['name']} không có trong danh sách"
        msg = {"role": "assistant", "content": None, "tool_calls": [{"id": f"call_{done}", "type": "function",
                                                                       "function": {"name": api_name(c["name"]), "arguments": json.dumps(c["arguments"], ensure_ascii=False)}}]}
    return {"id": "x", "object": "chat.completion", "created": int(time.time()), "model": b["model"],
            "choices": [{"index": 0, "message": msg, "finish_reason": "tool_calls" if c else "stop"}],
            "usage": {"prompt_tokens": 1000, "completion_tokens": 20, "total_tokens": 1020}}


BY_STEM = {}
for _s in load_samples(TRAIN_ROOT, "train"):
    if _s.audio:
        BY_STEM[_s.audio.rsplit("/", 1)[-1][:-4]] = _s.audio_text
    for _t in _s.history:
        if _t.role == "user" and _t.audio:
            BY_STEM[_t.audio.rsplit("/", 1)[-1][:-4]] = _t.text


@app.post("/v1/audio/transcriptions")
async def transcriptions(req: Request):
    """ASR giả: trả audio_text của train, cố ý làm sai từ thứ 3 (bỏ dấu) để có WER khác 0."""
    import unicodedata

    form = await req.form()
    f = form["file"]
    stem = f.filename.rsplit("/", 1)[-1].rsplit(".", 1)[0]
    text = BY_STEM.get(stem, "")
    w = text.split()
    if len(w) > 3:
        w[2] = "".join(c for c in unicodedata.normalize("NFD", w[2]) if not unicodedata.combining(c))
    return {"text": " ".join(w)}


@app.post("/v1/audio/speech")
async def speech(req: Request):
    """TTS giả: WAV 24 kHz mono (như API thật), độ dài tỉ lệ số ký tự — để kiểm thử resample + augmentation."""
    import io
    import math
    import struct
    import wave

    from fastapi.responses import Response

    b = await req.json()
    sr, n = 24000, int(24000 * max(0.5, len(b.get("input", "")) / 15))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 220 * i / sr))) for i in range(n)))
    return Response(buf.getvalue(), media_type="audio/wav")


@app.post("/v1/messages")
async def messages(req: Request):
    b = await req.json()
    msgs = b["messages"]
    # user turns that are only tool_result blocks are not "user text"
    def is_text_user(m):
        return m["role"] == "user" and (isinstance(m["content"], str) or any(x.get("type") == "text" for x in m["content"]))

    last = max(i for i, m in enumerate(msgs) if is_text_user(m))
    content = msgs[last]["content"]
    text = content if isinstance(content, str) else next(x["text"] for x in content if x.get("type") == "text")
    done = sum(sum(1 for x in m["content"] if isinstance(x, dict) and x.get("type") == "tool_use")
               for m in msgs[last:] if m["role"] == "assistant" and isinstance(m["content"], list))
    for m in msgs[last + 1:]:
        if m["role"] == "user":
            assert all(x.get("type") == "tool_result" for x in m["content"]), "lượt user sau câu cuối phải là tool_result"
    c = _next_call(text, done)
    tools = {t["name"] for t in b.get("tools", [])}
    if c is not None:
        assert api_name(c["name"]) in tools
        content = [{"type": "tool_use", "id": f"toolu_{done}", "name": api_name(c["name"]), "input": c["arguments"]}]
        stop = "tool_use"
    else:
        content, stop = [{"type": "text", "text": "Đã xong."}], "end_turn"
    return {"id": "msg_x", "type": "message", "role": "assistant", "model": b["model"], "content": content, "stop_reason": stop,
            "stop_sequence": None, "usage": {"input_tokens": 1000, "output_tokens": 20, "cache_read_input_tokens": 500,
                                             "cache_creation_input_tokens": 0}}
