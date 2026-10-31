"""Kiểu dữ liệu dùng chung. Message trung lập nhà cung cấp:

    {"role": "user" | "assistant" | "tool", "content": str,
     "tool_calls": [{"id", "name", "arguments"}],        # assistant
     "tool_call_id": str,                                 # tool
     "_raw": {...}}                                       # khối gốc của nhà cung cấp (vd thinking của Anthropic), adapter tự dùng lại
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ToolCall:
    name: str
    arguments: dict
    id: str | None = None

    def to_submission(self) -> dict:
        return {"name": self.name, "arguments": self.arguments}


@dataclass
class Turn:
    role: str                      # user | assistant
    audio: str | None = None       # đường dẫn tương đối trong split
    text: str | None = None        # user: audio_text (train); assistant: câu trả lời
    tool_calls: list[dict] = field(default_factory=list)
    tool_results: list[dict] = field(default_factory=list)


@dataclass
class Sample:
    id: str
    split: str
    audio: str | None
    context: dict
    history: list[Turn]
    audio_text: str | None = None
    label: dict | None = None
    raw: dict = field(default_factory=dict)

    @property
    def installed_apps(self) -> list[str]:
        return list(self.context.get("installed_apps", {}))

    def allowed_tools(self) -> list[str]:
        out = [t for a in self.context.get("installed_apps", {}).values() for t in a.get("tools", [])]
        if "sys.ask_missing_info" not in out:
            out.append("sys.ask_missing_info")
        return out

    def user_audios(self) -> list[str]:
        """Mọi audio của user theo thứ tự: các lượt history rồi lượt cuối."""
        out = [t.audio for t in self.history if t.role == "user" and t.audio]
        if self.audio:
            out.append(self.audio)
        return out


@dataclass
class LLMResponse:
    text: str = ""
    tool_calls: list[ToolCall] = field(default_factory=list)
    usage: dict = field(default_factory=dict)     # input_tokens, output_tokens, cache_read_tokens, cache_write_tokens
    stop_reason: str | None = None
    raw: Any = None                               # khối gốc để gửi lại (assistant message)
    cached: bool = False
    latency_s: float = 0.0
    error: str | None = None
    cost: float = 0.0                             # USD, do platform tính theo bảng giá


@dataclass
class ToolSpec:
    name: str            # tên gốc app.tool
    api_name: str        # tên gửi API (không có dấu chấm)
    description: str
    parameters: dict
