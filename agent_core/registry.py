"""Plugin registry: mỗi plugin = (kind, name) + class cấu hình pydantic.

    @register("llm", "anthropic", AnthropicConfig)
    class AnthropicBackend: ...

    build("llm", {"plugin": "anthropic", "model": "..."})   # -> instance

UI sinh form từ `REGISTRY.schema(kind, name)` (JSON Schema của class cấu hình).
"""
from __future__ import annotations

import importlib
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

KINDS = ("asr", "llm", "renderer", "prompt", "guard", "agent", "tts", "postprocess")


@dataclass
class PluginInfo:
    kind: str
    name: str
    cls: type
    config: type[BaseModel]
    description: str


class _Registry:
    def __init__(self):
        self._p: dict[tuple[str, str], PluginInfo] = {}
        self._loaded = False

    def add(self, info: PluginInfo):
        self._p[(info.kind, info.name)] = info

    def _ensure(self):
        if not self._loaded:
            self._loaded = True
            # importing the plugin modules registers them
            for m in ("asr", "llm", "render", "prompts", "guards", "agent", "tts"):
                importlib.import_module(f"agent_core.{m}")

    def get(self, kind: str, name: str) -> PluginInfo:
        self._ensure()
        try:
            return self._p[(kind, name)]
        except KeyError:
            names = [n for k, n in self._p if k == kind]
            raise KeyError(f"không có plugin {kind}:{name} (có: {names})") from None

    def list(self, kind: str | None = None) -> list[PluginInfo]:
        self._ensure()
        return [p for (k, _), p in sorted(self._p.items()) if kind is None or k == kind]

    def schema(self, kind: str, name: str) -> dict:
        return self.get(kind, name).config.model_json_schema()


REGISTRY = _Registry()


def register(kind: str, name: str, config: type[BaseModel], description: str = ""):
    assert kind in KINDS, kind

    def deco(cls):
        REGISTRY.add(PluginInfo(kind, name, cls, config, description or (cls.__doc__ or "").strip().split("\n")[0]))
        cls.plugin_name = name
        return cls

    return deco


def build(kind: str, spec: dict | str | None, **extra: Any):
    """spec: {"plugin": name, ...config} hoặc chỉ tên plugin."""
    if spec is None:
        raise ValueError(f"thiếu cấu hình {kind}")
    if isinstance(spec, str):
        spec = {"plugin": spec}
    spec = dict(spec)
    name = spec.pop("plugin")
    info = REGISTRY.get(kind, name)
    cfg = info.config(**spec)
    return info.cls(cfg, **extra)
