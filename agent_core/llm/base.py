from __future__ import annotations

import json
import os
import re

from pydantic import BaseModel, Field

from ..types import LLMResponse, ToolCall, ToolSpec


class LLMError(RuntimeError):
    pass


def api_error_detail(e) -> str:
    """Thông báo lỗi dễ đọc từ lỗi HTTP của SDK (lấy message trong body, kể cả body dạng list như Gemini)."""
    body = getattr(e, "body", None)
    if isinstance(body, list) and body:
        body = body[0]
    if isinstance(body, dict):
        err = body.get("error", body)
        if isinstance(err, dict) and err.get("message"):
            return str(err["message"])[:400]
    return str(getattr(e, "message", e))[:400]


class BaseLLMConfig(BaseModel):
    model: str = Field("", description="Tên model phía nhà cung cấp")
    api_key: str | None = Field(None, description="Khoá API (platform tự điền từ mục Khoá API)", json_schema_extra={"secret": True})
    api_key_env: str | None = Field(None, description="Tên biến môi trường chứa khoá, dùng khi api_key trống")
    base_url: str | None = None
    max_tokens: int = 2048
    timeout_s: float = 90
    max_retries: int = 2
    extra: dict = Field(default_factory=dict, description="Tham số bổ sung gửi thẳng vào request")

    def key(self) -> str | None:
        if self.api_key:
            return self.api_key
        if self.api_key_env:
            return os.environ.get(self.api_key_env)
        return None


class LLMBackend:
    cfg: BaseLLMConfig

    def step(self, system: str, messages: list[dict], tools: list[ToolSpec], ctx: dict | None = None) -> LLMResponse:
        raise NotImplementedError

    def complete(self, system: str, messages: list[dict], ctx: dict | None = None) -> LLMResponse:
        return self.step(system, messages, [], ctx)

    def cache_material(self) -> dict:
        d = self.cfg.model_dump(exclude={"api_key", "api_key_env", "timeout_s", "max_retries"})
        d["plugin"] = getattr(self, "plugin_name", type(self).__name__)
        return d


_TC_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.S)


def parse_text_tool_calls(text: str) -> tuple[str, list[ToolCall]]:
    """Fallback cho model tự host không bật tool parser: lấy các khối <tool_call>{"name":..,"arguments":..}</tool_call>."""
    calls = []
    for i, m in enumerate(_TC_RE.finditer(text or "")):
        try:
            d = json.loads(m.group(1))
            args = d.get("arguments", d.get("parameters", {}))
            if isinstance(args, str):
                args = json.loads(args)
            calls.append(ToolCall(name=d["name"], arguments=args or {}, id=f"t{i}"))
        except (json.JSONDecodeError, KeyError, TypeError):
            continue
    return (_TC_RE.sub("", text or "").strip() if calls else text), calls
