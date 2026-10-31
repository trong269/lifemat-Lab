"""Import file dự đoán do thành viên khác chạy trên server khác:

- ASR: transcript JSONL -> thành một "model ASR" (plugin transcript_file) dùng được trong mọi thử nghiệm và ASR Lab.
- LLM: file kết quả dạng submission {id, tool_calls, state_hash} -> một run "đã import", được replay trên zaic_tools và chấm như run thường.
"""
from __future__ import annotations

import json
import multiprocessing as mp
import re
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from agent_core.asr import parse_transcript_file
from lab.core import datasets, db
from lab.core.jobs import JOBS, JobCtx
from lab.core.paths import PREDICTIONS, RUNS


def _slug(s: str) -> str:
    import unicodedata

    s = unicodedata.normalize("NFD", s).replace("đ", "d").replace("Đ", "D")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9._-]+", "-", s).strip("-")[:50] or "pred"


def _coverage_asr(by_sample: dict, by_file: dict) -> list[dict]:
    """Dataset nào khớp với file transcript, và bao nhiêu mẫu có đủ transcript."""
    out = []
    for d in db.all_rows("datasets", order="kind, created"):
        if d["kind"] == "subset":
            continue
        try:
            ss = datasets.samples(d["id"])
        except Exception:
            continue
        hit = full = 0
        for s in ss:
            rec = by_sample.get(s.id)
            n_hist = sum(1 for t in s.history if t.role == "user" and t.audio)
            if rec is not None:
                hit += 1
                full += int(rec["final"] is not None and len([x for x in rec["history"] if x is not None]) >= n_hist)
            elif s.audio and Path(s.audio).stem in by_file:
                hit += 1
                full += int(all(Path(t.audio).stem in by_file for t in s.history if t.role == "user" and t.audio))
        if hit:
            out.append({"dataset_id": d["id"], "n": len(ss), "matched": hit, "complete": full})
    return out


def import_asr(content: bytes, name: str, notes: str = "") -> dict:
    pid = db.new_id("asrp_")
    path = PREDICTIONS / f"{pid}.jsonl"
    path.write_bytes(content)
    try:
        by_sample, by_file = parse_transcript_file(str(path))
    except (json.JSONDecodeError, UnicodeDecodeError, AttributeError) as e:
        path.unlink(missing_ok=True)
        raise ValueError(f"file không đúng định dạng JSONL: {e}") from e
    if not by_sample and not by_file:
        path.unlink(missing_ok=True)
        raise ValueError("không đọc được transcript nào (cần trường id + asr_text/text, hoặc audio + text)")
    cov = _coverage_asr(by_sample, by_file)
    if not cov:
        path.unlink(missing_ok=True)
        raise ValueError("file không khớp mẫu nào của các dataset đã thêm (kiểm tra trường id)")
    mid = "asr-" + _slug(name)
    if db.get("models", id=mid):
        mid = f"{mid}-{pid[-6:]}"
    db.insert("models", {"id": mid, "name": name, "role": "asr", "provider_id": "local", "plugin": "transcript_file",
                         "config": {"path": str(path)}, "price": {}, "source": "import", "submit_ok": 0,
                         "notes": notes or f"Import từ file, {len(by_sample) + len(by_file)} bản ghi", "created": time.time()})
    return {"model_id": mid, "records": len(by_sample) + len(by_file), "coverage": cov}


def _parse_llm(content: bytes) -> dict[str, dict]:
    preds = {}
    for i, line in enumerate(content.decode("utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            d = json.loads(line)
        except json.JSONDecodeError as e:
            raise ValueError(f"dòng {i} không phải JSON: {e}") from e
        if "id" not in d or not isinstance(d.get("tool_calls", []), list):
            raise ValueError(f"dòng {i} thiếu id hoặc tool_calls không phải list")
        preds[str(d["id"])] = d
    if not preds:
        raise ValueError("file rỗng")
    return preds


def import_llm(content: bytes, name: str, dataset_id: str | None = None, notes: str = "", missing_as_zero: bool = False) -> dict:
    """missing_as_zero=False: chỉ chấm các mẫu có trong file (file của một phần dataset);
    True: chấm cả dataset, mẫu thiếu dòng = 0 điểm (kiểm tra một file nộp đầy đủ)."""
    preds = _parse_llm(content)
    if not dataset_id:   # tự đoán dataset theo id
        best = None
        for d in db.all_rows("datasets", order="kind, created"):
            if d["kind"] == "subset":
                continue
            try:
                ids = {s.id for s in datasets.samples(d["id"])}
            except Exception:
                continue
            hit = len(ids & set(preds))
            if hit and (best is None or hit > best[1]):
                best = (d["id"], hit)
        if not best:
            raise ValueError("id trong file không khớp dataset nào đã thêm")
        dataset_id = best[0]
    ds = datasets.get(dataset_id)
    base = datasets.base_of(ds)
    all_ids = [s.id for s in datasets.samples(dataset_id)]
    if not set(all_ids) & set(preds):
        raise ValueError(f"id trong file không khớp dataset {dataset_id}")
    ids = all_ids if missing_as_zero else [i for i in all_ids if i in preds]
    rid = db.new_id("run_")
    cfg = {"name": name, "dataset": dataset_id, "llm_model": f"(import) {name}", "asr_model": "(import)", "imported": True,
           "score": {}, "notes": notes, "missing_as_zero": missing_as_zero, "sample_ids": None if missing_as_zero else ids}
    db.insert("runs", {"id": rid, "experiment_id": None, "name": name, "dataset_id": dataset_id, "config": cfg, "status": "running",
                       "total": len(ids), "done": 0, "created": time.time(), "started": time.time(), "kind": "import"})
    (RUNS / rid).mkdir(parents=True, exist_ok=True)
    (RUNS / rid / "imported.jsonl").write_bytes(content)

    def job(ctx: JobCtx, payload):
        from lab.runner.importer import import_main
        from lab.runner.manager import RS_COLS, RUNNER

        try:
            with ProcessPoolExecutor(max_workers=1, mp_context=mp.get_context("spawn")) as ex:
                res = ex.submit(import_main, base["root"], base["split"], ids, preds, {}).result()
            order = {sid: i for i, sid in enumerate(ids)}
            with open(RUNS / rid / "traces.jsonl", "w", encoding="utf-8") as f:
                for r in res:
                    off = f.tell()
                    f.write(json.dumps(r["trace"], ensure_ascii=False, default=str) + "\n")
                    row = {"run_id": rid, "sample_id": r["sid"], "idx": order[r["sid"]], "trace_offset": off, "new_app": 0}
                    row.update({k: r["summary"].get(k) for k in RS_COLS})
                    db.insert("run_samples", row, replace=True)
            ctx.progress(len(res), len(ids))
            RUNNER.finalize(rid, "done")
            extra = sorted(set(preds) - set(all_ids))
            if extra:
                db.update("runs", {"id": rid}, {"error": f"{len(extra)} id trong file không thuộc dataset (bỏ qua), vd {extra[:3]}"})
            return {"run_id": rid}
        except Exception as e:
            db.update("runs", {"id": rid}, {"status": "error", "error": str(e)[:2000], "finished": time.time()})
            raise

    job_id = JOBS.start("import_llm", job, {"run_id": rid, "dataset_id": dataset_id, "name": name})
    return {"run_id": rid, "job_id": job_id, "dataset_id": dataset_id, "lines": len(preds), "scored": len(ids),
            "dataset_size": len(all_ids), "missing": len(set(all_ids) - set(preds))}


def list_imports() -> dict:
    asr = [m for m in db.all_rows("models", order="created DESC") if m.get("plugin") == "transcript_file"]
    llm = db.query("SELECT id, name, dataset_id, status, score, done, total, created FROM runs WHERE kind='import' ORDER BY created DESC")
    return {"asr": asr, "llm": llm}


def delete_asr(model_id: str):
    m = db.get("models", id=model_id)
    if not m or m.get("plugin") != "transcript_file":
        raise KeyError(model_id)
    p = Path((m.get("config") or {}).get("path", ""))
    db.delete("models", {"id": model_id})
    if p.is_file() and PREDICTIONS in p.parents:
        p.unlink()
