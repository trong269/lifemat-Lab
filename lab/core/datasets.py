"""Dataset: split chính thức (train, public_test), split tổng hợp (lab_data/datasets/synth_*), và tập con (subset)."""
from __future__ import annotations

import json
import time
from collections import Counter
from functools import lru_cache
from pathlib import Path

from agent_core.data import catalog_tools, is_split_dir, load_catalog, load_samples
from agent_core.types import Sample

from . import db
from .paths import DATASETS, HOME, PUBLIC_ONLY_APPS


# ---------------- nguồn dữ liệu (đường dẫn tới dữ liệu BTC, nằm ngoài repo) ----------------
def _split_dirs(path: Path) -> list[Path]:
    """`path` là một thư mục split, hoặc thư mục chứa các split (tìm sâu tối đa 2 cấp)."""
    if is_split_dir(path):
        return [path]
    out = []
    for d in sorted(path.iterdir()) if path.is_dir() else []:
        if d.is_dir() and not d.name.startswith((".", "__")):
            if is_split_dir(d):
                out.append(d)
            else:
                out += [x for x in sorted(d.iterdir()) if x.is_dir() and is_split_dir(x)]
    return out


def source_paths() -> list[Path]:
    import os

    paths = [Path(r["path"]) for r in db.all_rows("data_sources", order="created")]
    paths += [Path(p) for p in os.environ.get("LAB_DATA_ROOTS", "").split(":") if p]
    return paths


def add_source(path: str, notes: str = "") -> dict:
    p = Path(path).expanduser().resolve()
    if not p.is_dir():
        raise ValueError(f"không tìm thấy thư mục {p}")
    splits = _split_dirs(p)
    if not splits:
        raise ValueError(f"không tìm thấy split nào trong {p} (cần thư mục có <tên>.jsonl và <tên>_environment/)")
    if not db.get("data_sources", path=str(p)):
        db.insert("data_sources", {"id": db.new_id("src_"), "path": str(p), "notes": notes, "created": time.time()})
    return {"path": str(p), "splits": [d.name for d in splits], **scan()}


def remove_source(source_id: str) -> dict:
    src = db.get("data_sources", id=source_id)
    if not src:
        raise KeyError(source_id)
    db.delete("data_sources", {"id": source_id})
    removed = []
    for d in db.query("SELECT id, root FROM datasets WHERE kind='official'"):
        if d["root"] and (d["root"] == src["path"] or d["root"].startswith(src["path"].rstrip("/") + "/")):
            removed.append(d["id"])
            db.delete("datasets", {"id": d["id"]})
            for sub in db.query("SELECT id FROM datasets WHERE parent_id=?", (d["id"],)):
                db.delete("datasets", {"id": sub["id"]})
    invalidate()
    return {"removed_datasets": removed}


def scan() -> dict:
    """Đăng ký mọi split tìm thấy trong các nguồn dữ liệu + dataset tổng hợp (gọi khi khởi động và khi thêm nguồn).
    Split đã đăng ký mà đổi chỗ (cùng tên, đường dẫn mới) thì cập nhật đường dẫn — run cũ vẫn dùng được."""
    added, moved = [], []
    roots = [(p, "official") for p in source_paths()] + [(DATASETS, "synthetic")]
    if (HOME / "train").is_dir():          # bố cục cũ: dữ liệu nằm trong repo
        roots.append((HOME, "official"))
    for path, kind in roots:
        if not path.is_dir():
            continue
        for d in (_split_dirs(path) if kind == "official" else [x for x in sorted(path.iterdir()) if x.is_dir() and is_split_dir(x)]):
            old = db.get("datasets", id=d.name)
            root = str(d.parent)
            if not old:
                db.insert("datasets", {"id": d.name, "name": d.name, "root": root, "split": d.name, "kind": kind,
                                       "parent_id": None, "sample_ids": None, "filter": None, "notes": "", "created": time.time()})
                added.append(d.name)
            elif old["root"] != root and not (Path(old["root"]) / d.name).is_dir():
                db.update("datasets", {"id": d.name}, {"root": root})
                moved.append(d.name)
    if added or moved:
        invalidate()
    return {"added": added, "moved": moved}


def train_root() -> Path:
    """Thư mục chứa split `train` (dữ liệu tham chiếu cho catalog, sinh dữ liệu, App Factory)."""
    import os

    env = os.environ.get("LAB_TRAIN_ROOT")
    if env:
        p = Path(env)
        return p.parent if p.name == "train" else p
    d = db.get("datasets", id="train")
    if d and d.get("root") and (Path(d["root"]) / "train").is_dir():
        return Path(d["root"])
    for p in source_paths():
        for sd in _split_dirs(p) if p.is_dir() else []:
            if sd.name == "train":
                return sd.parent
    if (HOME / "train").is_dir():
        return HOME
    raise FileNotFoundError("chưa có dữ liệu train — thêm đường dẫn tới dữ liệu BTC ở trang Dữ liệu")


def get(ds_id: str) -> dict:
    d = db.get("datasets", id=ds_id)
    if not d:
        raise KeyError(f"không có dataset {ds_id}")
    return d


def base_of(ds: dict) -> dict:
    while ds.get("parent_id"):
        ds = get(ds["parent_id"])
    return ds


@lru_cache(maxsize=16)
def _load(root: str, split: str, mtime: float) -> list[Sample]:
    return load_samples(root, split)


def samples(ds_id: str) -> list[Sample]:
    ds = get(ds_id)
    b = base_of(ds)
    p = Path(b["root"]) / b["split"] / f"{b['split']}.jsonl"
    allx = _load(b["root"], b["split"], p.stat().st_mtime)
    if ds.get("sample_ids"):
        keep = set(ds["sample_ids"])
        return [s for s in allx if s.id in keep]
    return allx


def invalidate():
    _load.cache_clear()
    _train_apps.cache_clear()


@lru_cache(maxsize=1)
def _train_apps() -> frozenset:
    try:
        return frozenset(a["id"] for a in load_catalog(train_root(), "train")["apps"])
    except FileNotFoundError:
        return frozenset()


@lru_cache(maxsize=16)
def _tools(root: str, split: str) -> dict:
    return catalog_tools(load_catalog(root, split))


def tools_of(ds_id: str) -> dict:
    b = base_of(get(ds_id))
    return _tools(b["root"], b["split"])


def features(s: Sample, tools: dict) -> dict:
    from lab.scoring.diagnostics import scenario_of

    gold = (s.label or {}).get("tool_calls") if s.label is not None else None
    label_apps = sorted({c["name"].split(".")[0] for c in gold or [] if not c["name"].startswith("sys.")})
    ta = _train_apps()
    return {
        "id": s.id, "text": s.audio_text, "scenario": scenario_of(gold, tools), "label_apps": label_apps,
        "installed": s.installed_apps, "hist_turns": sum(1 for t in s.history if t.role == "user"),
        "n_calls": len(gold) if gold is not None else None, "city": (s.context.get("user_profile") or {}).get("city"),
        "has_label": s.label is not None, "time": s.context.get("current_time"),
        "new_app": bool(ta) and any(a not in ta for a in (label_apps or s.installed_apps)),
        "public_only_app": any(a in PUBLIC_ONLY_APPS for a in s.installed_apps),
    }


def filter_samples(ds_id: str, f: dict | None) -> list[dict]:
    tools = tools_of(ds_id)
    out = []
    f = f or {}
    for s in samples(ds_id):
        x = features(s, tools)
        if f.get("scenario") and x["scenario"] not in f["scenario"]:
            continue
        if f.get("apps") and not set(f["apps"]) & set(x["label_apps"] or x["installed"]):
            continue
        if f.get("installed") and not set(f["installed"]) & set(x["installed"]):
            continue
        if f.get("hist_min") is not None and x["hist_turns"] < f["hist_min"]:
            continue
        if f.get("hist_max") is not None and x["hist_turns"] > f["hist_max"]:
            continue
        if f.get("new_app") is not None and x["new_app"] != f["new_app"]:
            continue
        if f.get("text") and f["text"].lower() not in (x["text"] or "").lower() and f["text"] not in x["id"]:
            continue
        if f.get("city") and x["city"] not in f["city"]:
            continue
        out.append(x)
    return out


def stats(ds_id: str) -> dict:
    feats = filter_samples(ds_id, None)
    c = lambda key: Counter(x[key] for x in feats)  # noqa: E731
    apps = Counter(a for x in feats for a in x["label_apps"])
    inst = Counter(a for x in feats for a in x["installed"])
    return {"n": len(feats), "labeled": sum(x["has_label"] for x in feats), "scenario": dict(c("scenario")),
            "hist_turns": dict(sorted(c("hist_turns").items())), "n_calls": dict(sorted((k, v) for k, v in c("n_calls").items() if k is not None)),
            "city": dict(c("city").most_common()), "label_apps": dict(apps.most_common()), "installed_apps": dict(inst.most_common()),
            "new_app": sum(x["new_app"] for x in feats), "public_only_app": sum(x["public_only_app"] for x in feats)}


def create_subset(parent_id: str, name: str, sample_ids: list[str], flt: dict | None = None, notes: str = "") -> str:
    ds_id = db.new_id("sub_")
    db.insert("datasets", {"id": ds_id, "name": name, "root": None, "split": None, "kind": "subset", "parent_id": parent_id,
                           "sample_ids": sample_ids, "filter": flt, "notes": notes, "created": time.time()})
    return ds_id


def holdout_apps(parent_id: str, apps: list[str], name: str) -> tuple[str, str]:
    """Tạo 2 tập: mẫu dùng các app bị giấu (để đánh giá) và phần còn lại (để train)."""
    feats = filter_samples(parent_id, None)
    hold = [x["id"] for x in feats if set(x["label_apps"]) & set(apps)]
    rest = [x["id"] for x in feats if not set(x["label_apps"]) & set(apps) and not set(x["installed"]) & set(apps)]
    a = create_subset(parent_id, f"{name} — app giấu", hold, {"holdout_apps": apps}, "Đánh giá khả năng tổng quát")
    b = create_subset(parent_id, f"{name} — phần còn lại", rest, {"exclude_apps": apps}, "Dùng để train")
    return a, b


def sample_detail(ds_id: str, sample_id: str) -> dict:
    b = base_of(get(ds_id))
    s = next((x for x in samples(ds_id) if x.id == sample_id), None)
    if s is None:
        raise KeyError(sample_id)
    raw = dict(s.raw)
    return {"sample": raw, "split_dir": str(Path(b["root"]) / b["split"]), "features": features(s, tools_of(ds_id)),
            "audio_files": s.user_audios()}


def read_state(ds_id: str, sample_id: str) -> dict:
    """Chỉ để hiển thị / review trong platform — agent không bao giờ dùng hàm này."""
    b = base_of(get(ds_id))
    p = Path(b["root"]) / b["split"] / f"{b['split']}_environment" / sample_id / "state.json"
    return json.loads(p.read_text(encoding="utf-8"))
