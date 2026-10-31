"""Oracle: phát lại đáp án của mẫu train, mỗi bước một call. Dùng để kiểm thử pipeline, scorer, runner mà không tốn tiền."""
from __future__ import annotations

from ..registry import register
from ..render import api_name
from ..types import LLMResponse, ToolCall
from .base import BaseLLMConfig, LLMBackend


class OracleConfig(BaseLLMConfig):
    model: str = "oracle"


@register("llm", "oracle", OracleConfig, "Phát lại đáp án (chỉ dùng cho mẫu có nhãn)")
class OracleBackend(LLMBackend):
    def __init__(self, cfg: OracleConfig):
        self.cfg = cfg

    def step(self, system, messages, tools, ctx=None) -> LLMResponse:
        sample = (ctx or {}).get("sample")
        gold = (sample.label or {}).get("tool_calls", []) if sample is not None else []
        last_user = max(i for i, m in enumerate(messages) if m["role"] == "user")
        done = sum(len(m.get("tool_calls") or []) for m in messages[last_user:] if m["role"] == "assistant")
        if done >= len(gold):
            return LLMResponse(text="Đã xong.")
        c = gold[done]
        return LLMResponse(tool_calls=[ToolCall(name=api_name(c["name"]), arguments=c.get("arguments") or {}, id=f"o{done}")])
