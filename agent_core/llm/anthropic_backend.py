"""Claude qua SDK chính thức `anthropic` (Messages API + tool use, một bước mỗi lần gọi)."""
from __future__ import annotations

import time
from typing import Literal

from pydantic import Field

from ..registry import register
from ..render import api_name
from ..types import LLMResponse, ToolCall
from .base import BaseLLMConfig, LLMBackend, LLMError, api_error_detail

FALLBACK_MODELS = {"claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"}


class AnthropicConfig(BaseLLMConfig):
    api_key_env: str | None = "ANTHROPIC_API_KEY"
    thinking: Literal["adaptive", "omit", "disabled"] = Field(
        "omit", description="omit = không gửi tham số thinking (model mới tự chạy adaptive); disabled chỉ dùng cho model cũ cho phép tắt")
    effort: Literal["", "low", "medium", "high", "xhigh", "max"] = Field("", description="output_config.effort; trống = mặc định của model")
    prompt_cache: bool = Field(True, description="Cache system prompt + danh sách tool")
    refusal_fallback: bool = Field(False, description="Bật fallbacks='default' (server-side) cho các model hỗ trợ")


def _merge(msgs: list[dict]) -> list[dict]:
    out: list[dict] = []
    for m in msgs:
        if out and out[-1]["role"] == m["role"]:
            a, b = out[-1]["content"], m["content"]
            a = a if isinstance(a, list) else [{"type": "text", "text": a}]
            b = b if isinstance(b, list) else [{"type": "text", "text": b}]
            out[-1]["content"] = a + b
        else:
            out.append(dict(m))
    return out


def to_anthropic(messages: list[dict]) -> list[dict]:
    out: list[dict] = []
    for m in messages:
        role = m["role"]
        if role == "user":
            out.append({"role": "user", "content": m.get("content") or "(im lặng)"})
        elif role == "tool":
            out.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m.get("content") or "{}"}]})
        elif role == "assistant":
            raw = (m.get("_raw") or {}).get("anthropic")
            if raw:
                out.append({"role": "assistant", "content": raw})
                continue
            blocks = []
            if m.get("content"):
                blocks.append({"type": "text", "text": m["content"]})
            for c in m.get("tool_calls") or []:
                blocks.append({"type": "tool_use", "id": c["id"], "name": api_name(c["name"]), "input": c.get("arguments") or {}})
            if not blocks:
                blocks.append({"type": "text", "text": "(đã xử lý)"})
            out.append({"role": "assistant", "content": blocks})
    return _merge(out)


@register("llm", "anthropic", AnthropicConfig, "Claude (Anthropic SDK)")
class AnthropicBackend(LLMBackend):
    def __init__(self, cfg: AnthropicConfig):
        import anthropic

        self.cfg = cfg
        self._anthropic = anthropic
        kw = {"max_retries": cfg.max_retries, "timeout": cfg.timeout_s}
        if cfg.key():
            kw["api_key"] = cfg.key()
        if cfg.base_url:
            kw["base_url"] = cfg.base_url
        self.client = anthropic.Anthropic(**kw)

    def step(self, system, messages, tools, ctx=None) -> LLMResponse:
        cfg = self.cfg
        sys_block = {"type": "text", "text": system}
        tool_defs = [{"name": t.api_name, "description": t.description, "input_schema": t.parameters} for t in tools]
        if cfg.prompt_cache:
            if tool_defs:
                tool_defs[-1]["cache_control"] = {"type": "ephemeral"}
            sys_block["cache_control"] = {"type": "ephemeral"}
        kw = dict(model=cfg.model, max_tokens=cfg.max_tokens, system=[sys_block], messages=to_anthropic(messages))
        if tool_defs:
            kw["tools"] = tool_defs
            if (ctx or {}).get("single_tool_call"):
                kw["tool_choice"] = {"type": "auto", "disable_parallel_tool_use": True}
        if cfg.thinking == "adaptive":
            kw["thinking"] = {"type": "adaptive"}
        elif cfg.thinking == "disabled":
            kw["thinking"] = {"type": "disabled"}
        if cfg.effort:
            kw["output_config"] = {"effort": cfg.effort}
        extra_body = dict(cfg.extra)
        extra_headers = {}
        if cfg.refusal_fallback and cfg.model in FALLBACK_MODELS:
            extra_body["fallbacks"] = "default"
            extra_headers["anthropic-beta"] = "server-side-fallback-2026-07-01"
        if extra_body:
            kw["extra_body"] = extra_body
        if extra_headers:
            kw["extra_headers"] = extra_headers
        t0 = time.time()
        try:
            r = self.client.messages.create(**kw)
        except self._anthropic.APIStatusError as e:
            raise LLMError(f"Anthropic {e.status_code}: {api_error_detail(e)}") from e
        except self._anthropic.APIConnectionError as e:
            raise LLMError(f"Anthropic kết nối lỗi: {e}") from e
        text, calls, has_thinking = [], [], False
        for b in r.content:
            if b.type == "text":
                text.append(b.text)
            elif b.type == "tool_use":
                calls.append(ToolCall(name=b.name, arguments=dict(b.input or {}), id=b.id))
            elif b.type in ("thinking", "redacted_thinking"):
                has_thinking = True
        u = r.usage
        usage = {"input_tokens": u.input_tokens or 0, "output_tokens": u.output_tokens or 0,
                 "cache_read_tokens": getattr(u, "cache_read_input_tokens", 0) or 0,
                 "cache_write_tokens": getattr(u, "cache_creation_input_tokens", 0) or 0,
                 # hệ số giá so với token vào khi bảng giá không ghi riêng: đọc cache 0.1x, ghi cache 1.25x
                 "cache_read_ratio": 0.1, "cache_write_ratio": 1.25}
        # thinking blocks must be sent back unchanged on the next step
        raw = {"anthropic": [b.model_dump(exclude_none=True) for b in r.content]} if has_thinking else None
        return LLMResponse(text="\n".join(text).strip(), tool_calls=calls, usage=usage, stop_reason=r.stop_reason, raw=raw,
                           latency_s=time.time() - t0, error="refusal" if r.stop_reason == "refusal" else None)
