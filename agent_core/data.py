"""Đọc split theo cấu trúc của BTC và nạp đúng zaic_tools của split.

Cấu trúc: <root>/<split>/{<split>.jsonl, <split>_tools_catalog.json, <split>_environment/, audio/, zaic_tools/}
"""
from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

from .types import Sample, Turn


def is_split_dir(p: Path) -> bool:
    return (p / f"{p.name}.jsonl").is_file() and (p / f"{p.name}_environment").is_dir()


def locate_split(path: str | Path, split: str | None = None) -> tuple[Path, str]:
    """Trả (root, split). `path` có thể là chính thư mục split, hoặc thư mục cha của nó (vd /data trong Docker)."""
    p = Path(path).resolve()
    if split:
        if (p / split).is_dir() and is_split_dir(p / split):
            return p, split
        if p.name == split and is_split_dir(p):
            return p.parent, split
    if is_split_dir(p):
        return p.parent, p.name
    cands = [d for d in sorted(p.iterdir()) if d.is_dir() and is_split_dir(d)] if p.is_dir() else []
    if len(cands) == 1:
        return p, cands[0].name
    if split is None and cands:
        raise ValueError(f"{p} chứa nhiều split {[c.name for c in cands]}, hãy chỉ rõ split")
    raise FileNotFoundError(f"không tìm thấy split trong {p}")


def _turn(t: dict) -> Turn:
    return Turn(role=t["role"], audio=t.get("audio"), text=t.get("audio_text") if t["role"] == "user" else t.get("text"),
                tool_calls=t.get("tool_calls") or [], tool_results=t.get("tool_results") or [])


def sample_from_dict(d: dict, split: str) -> Sample:
    return Sample(id=d["id"], split=split, audio=d.get("audio"), context=d.get("context", {}),
                  history=[_turn(t) for t in d.get("history", [])], audio_text=d.get("audio_text"),
                  label=d.get("label"), raw=d)


def load_samples(root: str | Path, split: str) -> list[Sample]:
    path = Path(root) / split / f"{split}.jsonl"
    out = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                out.append(sample_from_dict(json.loads(line), split))
    return out


def load_catalog(root: str | Path, split: str) -> dict:
    return json.load(open(Path(root) / split / f"{split}_tools_catalog.json", encoding="utf-8"))


def catalog_tools(catalog: dict) -> dict[str, dict]:
    return {t["name"]: t for a in catalog.get("apps", []) for t in a.get("tools", [])}


_ZT: dict[str, object] = {}


def load_zaic_tools(root: str | Path, split: str):
    """Nạp package zaic_tools của split. Mỗi split có package riêng cùng tên `zaic_tools`, nên một tiến trình
    chỉ dùng được một split: gọi với split khác trong cùng tiến trình sẽ báo lỗi."""
    split_dir = str((Path(root) / split).resolve())
    if split_dir in _ZT:
        return _ZT[split_dir]
    if _ZT:
        raise RuntimeError(f"tiến trình này đã nạp zaic_tools của {list(_ZT)}; mỗi split cần tiến trình riêng")
    if "zaic_tools" in sys.modules:
        loaded = Path(sys.modules["zaic_tools"].__file__).resolve().parent.parent
        if str(loaded) != split_dir:
            raise RuntimeError(f"zaic_tools đã được nạp từ {loaded}")
    sys.path.insert(0, split_dir)
    mod = importlib.import_module("zaic_tools")
    _ZT[split_dir] = mod
    return mod
