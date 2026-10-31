"""Schema renderer: catalog của BTC -> danh sách ToolSpec gửi cho LLM.

- Tên `app.tool` không hợp lệ với API (OpenAI/Anthropic chỉ nhận [a-zA-Z0-9_-]) -> đổi thành `app__tool`.
- Bỏ các khoá mở rộng `x-*` khỏi JSON Schema, chuyển ý nghĩa của chúng vào description.
"""
from __future__ import annotations

import copy
import re

from pydantic import BaseModel

from .registry import register
from .types import ToolSpec

SEP = "__"


def api_name(name: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]", "_", name.replace(".", SEP))[:64]


def _first_sentence(s: str) -> str:
    s = (s or "").strip()
    m = re.split(r"(?<=[.;])\s", s, maxsplit=1)
    return m[0] if m else s


def _clean_prop(p: dict, short: bool, keep_desc: bool = True) -> dict:
    p = copy.deepcopy(p)
    hints = []
    if "x-ref" in p:
        hints.append(f"ID có thật trong dữ liệu {p['x-ref']}, phải lấy từ kết quả tool đọc, không tự đoán")
    if p.get("x-match") == "fuzzy":
        hints.append("văn bản tự do")
    for k in [k for k in p if k.startswith("x-")]:
        p.pop(k)
    if "items" in p and isinstance(p["items"], dict):
        p["items"] = _clean_prop(p["items"], short, keep_desc)
    desc = p.get("description", "")
    if short:
        desc = _first_sentence(desc)
    desc = "; ".join([d for d in [desc] + hints if d])
    if desc and keep_desc:
        p["description"] = desc
    else:
        p.pop("description", None)
    return p


def _clean_params(params: dict, short: bool, keep_desc: bool = True) -> tuple[dict, list[str]]:
    params = copy.deepcopy(params or {"type": "object", "properties": {}})
    notes = []
    if "x-one-of" in params:
        groups = [" + ".join(g) for g in params["x-one-of"]]
        notes.append("Bắt buộc có một trong: " + " | ".join(groups))
    out = {"type": "object", "properties": {k: _clean_prop(v, short, keep_desc) for k, v in params.get("properties", {}).items()}}
    if params.get("required"):
        out["required"] = list(params["required"])
    return out, notes


class RendererConfig(BaseModel):
    include_kind: bool = True       # thêm [đọc]/[ghi] vào đầu description
    include_returns: bool = False   # thêm tóm tắt dữ liệu trả về


class _Base:
    short = False
    keep_param_desc = True

    def __init__(self, cfg: RendererConfig):
        self.cfg = cfg

    def _desc(self, t: dict, notes: list[str]) -> str:
        kind = {"read": "[đọc] ", "write": "[ghi] ", "meta": "[hệ thống] "}.get(t.get("kind"), "") if self.cfg.include_kind else ""
        d = t.get("description", "")
        if self.short:
            d = _first_sentence(d)
        parts = [kind + d] + notes
        if self.cfg.include_returns and t.get("returns"):
            parts.append("Trả về: " + t["returns"])
        return " ".join(p for p in parts if p).strip()

    def render(self, tools: dict[str, dict], allowed: list[str]) -> list[ToolSpec]:
        out = []
        for name in allowed:
            t = tools.get(name)
            if t is None:
                continue
            params, notes = _clean_params(t.get("parameters", {}), self.short, self.keep_param_desc)
            out.append(ToolSpec(name=name, api_name=api_name(name), description=self._desc(t, notes), parameters=params))
        return out


@register("renderer", "full", RendererConfig, "JSON Schema đầy đủ, mô tả đầy đủ")
class FullRenderer(_Base):
    pass


@register("renderer", "compact", RendererConfig, "Mô tả rút gọn còn câu đầu, ít token hơn")
class CompactRenderer(_Base):
    short = True


@register("renderer", "signature", RendererConfig, "Chữ ký hàm trong description, bỏ mô tả tham số (ít token nhất)")
class SignatureRenderer(_Base):
    short = True
    keep_param_desc = False

    def _desc(self, t, notes):
        props = t.get("parameters", {}).get("properties", {})
        req = set(t.get("parameters", {}).get("required", []))
        sig = ", ".join(f"{k}{'' if k in req else '?'}" for k in props)
        return super()._desc(t, notes) + f" ({sig})"


def name_map(specs: list[ToolSpec]) -> dict[str, str]:
    """api_name -> tên gốc."""
    return {s.api_name: s.name for s in specs}
