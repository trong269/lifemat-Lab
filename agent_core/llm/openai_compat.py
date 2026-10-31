"""Mọi endpoint dạng OpenAI Chat Completions: OpenAI, Gemini (endpoint OpenAI-compatible), OpenRouter, vLLM, llama.cpp."""
from __future__ import annotations

import json
import time
from typing import Literal

from pydantic import Field

from ..registry import register
from ..render import api_name
from ..types import LLMResponse, ToolCall
from .base import BaseLLMConfig, LLMBackend, LLMError, api_error_detail, parse_text_tool_calls


class OpenAICompatConfig(BaseLLMConfig):
    api_key_env: str | None = "OPENAI_API_KEY"
    temperature: float | None = Field(0.0, description="Để trống nếu model không nhận temperature (vd model reasoning)")
    top_p: float | None = None
    seed: int | None = Field(None, description="Một số API (vd Gemini) không nhận seed — chỉ điền khi server hỗ trợ (vLLM)")
    reasoning_effort: Literal["", "minimal", "low", "medium", "high"] = ""
    max_tokens_param: Literal["auto", "max_tokens", "max_completion_tokens"] = "auto"
    send_parallel_flag: bool = Field(False, description="Gửi parallel_tool_calls=false khi agent chỉ cho 1 call/bước "
                                                        "(OpenAI, vLLM hỗ trợ; một số server không nhận nên mặc định tắt — agent vẫn tự bỏ call thừa)")
    parse_text_tool_calls: bool = Field(True, description="Đọc <tool_call>{...}</tool_call> trong text nếu server không trả tool_calls")


def to_openai(system: str, messages: list[dict]) -> list[dict]:
    out = [{"role": "system", "content": system}]
    for m in messages:
        if m["role"] == "assistant":
            d = {"role": "assistant", "content": m.get("content") or ""}
            if m.get("tool_calls"):
                d["tool_calls"] = [{"id": c["id"], "type": "function",
                                    "function": {"name": api_name(c["name"]), "arguments": json.dumps(c.get("arguments") or {}, ensure_ascii=False)}}
                                   for c in m["tool_calls"]]
                if not d["content"]:
                    d["content"] = None
            out.append(d)
        elif m["role"] == "tool":
            out.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m.get("content") or "{}"})
        else:
            out.append({"role": "user", "content": m.get("content") or ""})
    return out


@register("llm", "openai_compat", OpenAICompatConfig, "OpenAI / Gemini / OpenRouter / vLLM / llama.cpp (Chat Completions)")
class OpenAICompatBackend(LLMBackend):
    def __init__(self, cfg: OpenAICompatConfig):
        import openai

        self.cfg = cfg
        self._openai = openai
        self.client = openai.OpenAI(api_key=cfg.key() or "EMPTY", base_url=cfg.base_url or None,
                                    timeout=cfg.timeout_s, max_retries=cfg.max_retries)

    def step(self, system, messages, tools, ctx=None) -> LLMResponse:
        cfg = self.cfg
        kw = dict(model=cfg.model, messages=to_openai(system, messages))
        if tools:
            kw["tools"] = [{"type": "function", "function": {"name": t.api_name, "description": t.description, "parameters": t.parameters}}
                           for t in tools]
            if cfg.send_parallel_flag and (ctx or {}).get("single_tool_call"):
                kw["parallel_tool_calls"] = False
        mt = cfg.max_tokens_param
        if mt == "auto":
            mt = "max_completion_tokens" if (cfg.base_url or "").find("api.openai.com") >= 0 or not cfg.base_url else "max_tokens"
        kw[mt] = cfg.max_tokens
        if cfg.temperature is not None:
            kw["temperature"] = cfg.temperature
        if cfg.top_p is not None:
            kw["top_p"] = cfg.top_p
        if cfg.seed is not None:
            kw["seed"] = cfg.seed
        if cfg.reasoning_effort:
            kw["reasoning_effort"] = cfg.reasoning_effort
        if cfg.extra:
            kw["extra_body"] = dict(cfg.extra)
        t0 = time.time()
        try:
            r = self.client.chat.completions.create(**kw)
        except self._openai.APIStatusError as e:
            raise LLMError(f"HTTP {e.status_code}: {api_error_detail(e)}") from e
        except self._openai.APIConnectionError as e:
            raise LLMError(f"kết nối lỗi: {e}") from e
        if not r.choices:
            raise LLMError("phản hồi không có choices")
        msg = r.choices[0].message
        text = msg.content or ""
        calls = []
        for i, tc in enumerate(msg.tool_calls or []):
            fn = tc.function
            try:
                args = json.loads(fn.arguments) if fn.arguments else {}
            except json.JSONDecodeError:
                args = {"__parse_error__": fn.arguments}
            calls.append(ToolCall(name=fn.name, arguments=args if isinstance(args, dict) else {"__parse_error__": fn.arguments}, id=tc.id or f"c{i}"))
        if not calls and cfg.parse_text_tool_calls:
            text, calls = parse_text_tool_calls(text)
        u = r.usage
        cached = 0
        if u is not None and getattr(u, "prompt_tokens_details", None) is not None:
            cached = getattr(u.prompt_tokens_details, "cached_tokens", 0) or 0
        # prompt_tokens đã gồm cả token đọc từ cache: tách ra để không tính tiền hai lần
        prompt = (u.prompt_tokens if u else 0) or 0
        usage = {"input_tokens": max(0, prompt - cached), "output_tokens": (u.completion_tokens if u else 0) or 0,
                 "cache_read_tokens": cached, "cache_write_tokens": 0, "cache_read_ratio": 0.5}
        return LLMResponse(text=text.strip(), tool_calls=calls, usage=usage, stop_reason=r.choices[0].finish_reason,
                           latency_s=time.time() - t0)
