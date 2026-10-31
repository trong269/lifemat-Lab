"""Split tổng hợp có cấu trúc giống split của BTC: <name>/{<name>.jsonl, <name>_tools_catalog.json, <name>_environment/, audio/, zaic_tools/}.

zaic_tools = bản sao zaic_tools của train + module các app tự tạo đã duyệt (lab_data/apps/<app>/module.py).
"""
from __future__ import annotations

import fcntl
import json
import shutil
from contextlib import contextmanager
from pathlib import Path

from lab.core.datasets import train_root
from lab.core.paths import APPS, DATASETS, PUBLIC_ONLY_APPS


def approved_apps() -> dict[str, dict]:
    out = {}
    for d in sorted(APPS.iterdir()) if APPS.is_dir() else []:
        f = d / "spec.json"
        if f.is_file() and (d / "APPROVED").is_file():
            out[d.name] = {"spec": json.loads(f.read_text(encoding="utf-8")), "module": d / "module.py",
                           "example_state": json.loads((d / "example_state.json").read_text(encoding="utf-8"))}
    return out


def base_catalog() -> dict:
    return json.loads((train_root() / "train" / "train_tools_catalog.json").read_text(encoding="utf-8"))


def create_split(name: str, extra_apps: list[str] | None = None) -> Path:
    d = DATASETS / name
    if d.exists():
        raise FileExistsError(f"split {name} đã tồn tại")
    (d / f"{name}_environment").mkdir(parents=True)
    (d / "audio").mkdir()
    shutil.copytree(train_root() / "train" / "zaic_tools", d / "zaic_tools", ignore=shutil.ignore_patterns("__pycache__"))
    cat = base_catalog()
    apps = approved_apps()
    for a in extra_apps or []:
        if a in PUBLIC_ONLY_APPS:
            raise ValueError(f"app {a} chỉ có ở public_test — không được dùng")
        if a not in apps:
            raise KeyError(f"app tự tạo {a} chưa được duyệt")
        shutil.copy(apps[a]["module"], d / "zaic_tools" / "apps" / f"{a}.py")
        cat["apps"].append(apps[a]["spec"])
    (d / f"{name}_tools_catalog.json").write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
    (d / f"{name}.jsonl").write_text("", encoding="utf-8")
    return d


def write_state(split_dir: Path, sid: str, state: dict):
    p = split_dir / f"{split_dir.name}_environment" / sid
    p.mkdir(parents=True, exist_ok=True)
    (p / "state.json").write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")


def read_state(split_dir: Path, sid: str) -> dict:
    return json.loads((split_dir / f"{split_dir.name}_environment" / sid / "state.json").read_text(encoding="utf-8"))


def read_records(split_dir: Path) -> list[dict]:
    p = split_dir / f"{split_dir.name}.jsonl"
    return [json.loads(line) for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_records(split_dir: Path, recs: list[dict]):
    p = split_dir / f"{split_dir.name}.jsonl"
    tmp = p.with_suffix(".tmp")
    tmp.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in recs), encoding="utf-8")
    tmp.replace(p)


def append_record(split_dir: Path, rec: dict):
    with split_lock(split_dir):
        with open(split_dir / f"{split_dir.name}.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")


@contextmanager
def split_lock(split_dir: Path):
    """Khoá giữa các tiến trình khi đọc-sửa-ghi file jsonl của split."""
    with open(split_dir / ".lock", "w") as lf:
        fcntl.flock(lf, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(lf, fcntl.LOCK_UN)
