"""Kiểm tra trước khi nộp bài."""
from __future__ import annotations

import ast
import json
import os
import subprocess
import sys
from pathlib import Path

from lab.core import datasets, db
from lab.core.paths import HOME, RUNS

RULE_DATE = "2026-10-26"


def validate_file(run_id: str) -> dict:
    r = db.get("runs", id=run_id)
    b = datasets.base_of(datasets.get(r["dataset_id"]))
    path = RUNS / run_id / "submission.jsonl"
    if not path.is_file():
        return {"returncode": -1, "stdout": "", "stderr": "run này chưa có submission.jsonl", "ok": False}
    env ={**os.environ, "PYTHONPATH": str(Path(b["root"]) / b["split"])}
    p = subprocess.run([sys.executable, "-m", "zaic_tools", "--split", b["split"], "--root", b["root"], "--validate", str(path)],
                       capture_output=True, text=True, timeout=600, env=env, cwd=str(Path(b["root"]) / b["split"]))
    return {"returncode": p.returncode, "stdout": p.stdout[-6000:], "stderr": p.stderr[-3000:], "ok": p.returncode == 0}


def scan_env_access() -> list[str]:
    """Tìm chỗ agent_core có thể đọc trực tiếp <split>_environment / state.json (luật thi cấm)."""
    hits = []
    for f in sorted((HOME / "agent_core").rglob("*.py")):
        tree = ast.parse(f.read_text(encoding="utf-8"))
        doc_nodes = set()
        for node in ast.walk(tree):
            if isinstance(node, (ast.Module, ast.FunctionDef, ast.ClassDef, ast.AsyncFunctionDef)) and ast.get_docstring(node, clean=False):
                doc_nodes.add(id(node.body[0].value))
        for node in ast.walk(tree):
            if isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in doc_nodes:
                v = node.value
                if "state.json" in v or ("_environment" in v and not (f.name == "data.py")):
                    hits.append(f"{f.relative_to(HOME)}:{node.lineno}: {v[:80]}")
    return hits


def checks(run_id: str, run_id2: str | None = None) -> dict:
    r = db.get("runs", id=run_id)
    if not r:
        raise KeyError(run_id)
    cfg = r["config"] or {}
    m = r.get("metrics") or {}
    items = []

    def add(name, ok, detail, level="error"):
        items.append({"name": name, "ok": bool(ok), "detail": detail, "level": "ok" if ok else level})

    ds = datasets.get(r["dataset_id"])
    n_ds = len(datasets.samples(r["dataset_id"]))
    add("Đủ dòng cho mọi mẫu", r["done"] == n_ds, f"{r['done']}/{n_ds} mẫu" + ("" if ds["kind"] != "subset" else " (đây là tập con)"))
    add("P95 thời gian < 30 giây", (m.get("latency_p95") or 0) < 30, f"P95 = {m.get('latency_p95')}s, max = {m.get('latency_max')}s, "
        f"{m.get('over_30s', 0)} mẫu vượt 30s")
    st = m.get("status") or {}
    add("Không có mẫu lỗi/timeout", not any(k in st for k in ("timeout", "crash", "llm_error")), json.dumps(st, ensure_ascii=False), "warn")
    llm = db.get("models", id=cfg.get("llm_model")) or {}
    asr = db.get("models", id=cfg.get("asr_model")) or {}
    add("LLM dùng được khi nộp (chạy offline)", bool(llm.get("submit_ok")), f"{llm.get('id')} — {llm.get('source') or ''}")
    add("ASR dùng được khi nộp (chạy offline)", bool(asr.get("submit_ok")), f"{asr.get('id')}")
    lp, ap = llm.get("n_params_b"), asr.get("n_params_b")
    add("LLM < 5B tham số", lp is not None and lp < 5, f"{lp}B" if lp is not None else "chưa khai báo số tham số")
    add("Tổng hệ thống < 6B tham số", lp is not None and ap is not None and lp + ap < 6,
        f"{(lp or 0) + (ap or 0):.2f}B" if lp is not None and ap is not None else "chưa khai báo đủ số tham số")
    cl = llm.get("context_len")
    add("Context LLM ≤ 16K", cl is not None and cl <= 16384, f"{cl}" if cl else "chưa khai báo")
    for mm in (llm, asr):
        if mm.get("release_date"):
            add(f"{mm['id']} phát hành trước {RULE_DATE}", mm["release_date"] < RULE_DATE, mm["release_date"])
    hits = scan_env_access()
    add("agent_core không đọc *_environment/state.json", not hits, "; ".join(hits) or "không phát hiện")
    lc = (cfg.get("llm_overrides") or {}).get("temperature")
    add("Giải mã tất định", lc in (None, 0, 0.0), f"temperature ghi đè = {lc}", "warn")
    if run_id2:
        a = {x["sample_id"]: x["sub"] for x in db.query("SELECT sample_id, sub FROM run_samples WHERE run_id=?", (run_id,))}
        b = {x["sample_id"]: x["sub"] for x in db.query("SELECT sample_id, sub FROM run_samples WHERE run_id=?", (run_id2,))}
        common = set(a) & set(b)
        same = sum(1 for k in common if json.loads(json.dumps(a[k])) == json.loads(json.dumps(b[k])))
        add("Tất định (2 lần chạy giống nhau)", common and same == len(common), f"{same}/{len(common)} mẫu giống hệt")
    return {"run_id": run_id, "items": items, "passed": all(i["ok"] or i["level"] == "warn" for i in items)}
