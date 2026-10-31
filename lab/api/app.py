"""FastAPI: toàn bộ API của platform (tiền tố /api) + phục vụ UI đã build (ui/dist)."""
from __future__ import annotations

import asyncio
import json
import time
from collections import Counter, defaultdict
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import ValidationError

from agent_core.llm.base import LLMError
from agent_core.prompts import PROMPT_DIR, available_rules
from agent_core.registry import KINDS, REGISTRY
from lab import playground as pg
from lab import predictions, studio, submission
from lab.core import datasets, db, models
from lab.core.experiments import ExperimentConfig, estimate, resolve
from lab.core.jobs import JOBS
from lab.core.paths import DATASETS, HOME, RUNS
from lab.runner.manager import RUNNER, read_trace
from lab.scoring.asr_metrics import normalize as asr_normalize
from lab.scoring.diagnostics import ERROR_TAGS

app = FastAPI(title="LifeMate Lab", version="0.1")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
def _startup():
    db.conn()
    models.seed()
    datasets.scan()
    # run đang dở khi tắt server -> đánh dấu tạm dừng để có thể tiếp tục
    for r in db.query("SELECT id FROM runs WHERE status IN ('running','queued')"):
        db.update("runs", {"id": r["id"]}, {"status": "interrupted"})
    for j in db.query("SELECT id FROM jobs WHERE status IN ('running','cancelling')"):
        db.update("jobs", {"id": j["id"]}, {"status": "interrupted"})


@app.exception_handler(KeyError)
async def _ke(_: Request, e: KeyError):
    return JSONResponse({"detail": f"không tìm thấy: {e}"}, status_code=404)


@app.exception_handler(ValueError)
async def _ve(_: Request, e: ValueError):
    return JSONResponse({"detail": str(e)}, status_code=400)


@app.exception_handler(ValidationError)
async def _pe(_: Request, e: ValidationError):
    return JSONResponse({"detail": e.errors(include_url=False, include_context=False)}, status_code=422)


@app.exception_handler(LLMError)
async def _le(_: Request, e: LLMError):
    return JSONResponse({"detail": f"Lỗi từ nhà cung cấp model — {e}"}, status_code=502)


@app.exception_handler(TimeoutError)
async def _te(_: Request, e: TimeoutError):
    return JSONResponse({"detail": str(e) or "quá thời gian chờ"}, status_code=504)


@app.exception_handler(RuntimeError)
async def _re(_: Request, e: RuntimeError):
    return JSONResponse({"detail": str(e)}, status_code=500)


# ======================= chung =======================
@app.get("/api/health")
def health():
    return {"ok": True, "time": time.time()}


@app.get("/api/overview")
def overview():
    runs = db.query("SELECT id, name, dataset_id, status, score, cost, done, total, created FROM runs ORDER BY created DESC LIMIT 8")
    jobs = db.query("SELECT id, kind, status, progress, total, cost, created FROM jobs ORDER BY created DESC LIMIT 8")
    cost = db.query("SELECT COALESCE(SUM(cost),0) AS c FROM usage_log")[0]["c"]
    today = db.query("SELECT COALESCE(SUM(cost),0) AS c FROM usage_log WHERE ts > ?", (time.time() - 86400,))[0]["c"]
    provs = [{"id": p["id"], "key": models.key_status(p["id"])} for p in db.all_rows("providers", order="id") if p["kind"] != "builtin"]
    best = db.query("SELECT id, name, score, dataset_id FROM runs WHERE score IS NOT NULL ORDER BY score DESC LIMIT 5")
    return {"runs": runs, "jobs": jobs, "cost_total": cost, "cost_24h": today, "providers": provs, "best_runs": best,
            "n_models": len(db.all_rows("models")), "n_datasets": len(db.all_rows("datasets"))}


@app.get("/api/plugins")
def plugins():
    out = defaultdict(list)
    for p in REGISTRY.list():
        out[p.kind].append({"name": p.name, "description": p.description, "schema": p.config.model_json_schema()})
    return {k: out.get(k, []) for k in KINDS}


@app.get("/api/meta")
def meta():
    from training.gen_synthetic.app_factory import IDEAS
    from training.gen_synthetic.generate import Recipe
    from training.gen_synthetic.scenarios import SCENARIOS

    return {"error_tags": ERROR_TAGS, "scenarios": {k: {"name": v["name"], "desc": v["desc"], "expect": v["expect"]} for k, v in SCENARIOS.items()},
            "recipe_schema": Recipe.model_json_schema(), "recipe_default": Recipe().model_dump(),
            "experiment_schema": ExperimentConfig.model_json_schema(), "experiment_default": ExperimentConfig().model_dump(),
            "price_fields": models.PRICE_FIELDS, "app_ideas": IDEAS, "rules": available_rules()}


# ---------- prompts / bộ luật ----------
@app.get("/api/prompts")
def prompts_list():
    return [{"name": n, "chars": len((PROMPT_DIR / f"{n}.md").read_text(encoding="utf-8"))} for n in available_rules()]


@app.get("/api/prompts/{name}")
def prompt_get(name: str):
    p = PROMPT_DIR / f"{name}.md"
    if not p.is_file():
        raise KeyError(name)
    return {"name": name, "text": p.read_text(encoding="utf-8")}


@app.put("/api/prompts/{name}")
def prompt_put(name: str, body: dict):
    import re

    if not re.fullmatch(r"[a-zA-Z0-9_\-]{1,60}", name):
        raise ValueError("tên bộ luật chỉ gồm chữ, số, _ và -")
    (PROMPT_DIR / f"{name}.md").write_text(body["text"], encoding="utf-8")
    return {"ok": True}


# ======================= nhà cung cấp, khoá, model =======================
@app.get("/api/providers")
def providers():
    return [{**p, "key_status": models.key_status(p["id"])} for p in db.all_rows("providers", order="id")]


@app.post("/api/providers")
def provider_upsert(body: dict):
    pid = body["id"]
    row = {"id": pid, "kind": body.get("kind", "openai_compat"), "base_url": body.get("base_url") or None,
           "api_key_env": body.get("api_key_env") or None, "notes": body.get("notes", ""), "created": time.time()}
    if row["kind"] not in ("anthropic", "openai_compat"):
        raise ValueError("kind phải là anthropic hoặc openai_compat")
    db.insert("providers", row, replace=True)
    return row


@app.delete("/api/providers/{pid}")
def provider_delete(pid: str):
    if db.query("SELECT id FROM models WHERE provider_id=?", (pid,)):
        raise ValueError("còn model dùng nhà cung cấp này")
    db.delete("providers", {"id": pid})
    models.set_secret(pid, None)
    return {"ok": True}


@app.put("/api/providers/{pid}/key")
def provider_key(pid: str, body: dict):
    if not db.get("providers", id=pid):
        raise KeyError(pid)
    models.set_secret(pid, (body.get("key") or "").strip() or None)
    return {"ok": True, "key_status": models.key_status(pid)}


@app.get("/api/models")
def models_list(role: str | None = None):
    rows = db.all_rows("models", order="role, id")
    out = []
    for m in rows:
        if role and m["role"] != role:
            continue
        m["ready"] = models.check_model_ready(m["id"])
        out.append(m)
    return out


@app.post("/api/models")
def model_upsert(body: dict):
    mid = body.get("id", "").strip()
    if not mid:
        raise ValueError("cần ID model")
    if body.get("role") not in ("llm", "asr", "tts"):
        raise ValueError("role phải là llm, asr hoặc tts")
    prov = db.get("providers", id=body.get("provider_id"))
    if not prov:
        raise ValueError("nhà cung cấp không tồn tại")
    if prov["kind"] == "anthropic" and body["role"] != "llm":
        raise ValueError("nhà cung cấp kiểu Anthropic chỉ dùng cho LLM; model nhận dạng giọng nói / đọc văn bản hãy chọn "
                         "'Server của tôi' (OpenAI-compatible)")
    old = db.get("models", id=mid) or {}
    row = {"id": mid, "name": body.get("name") or mid, "role": body["role"], "provider_id": body["provider_id"],
           "plugin": body.get("plugin") or None, "config": body.get("config") or {}, "price": body.get("price") or {},
           "n_params_b": body.get("n_params_b"), "context_len": body.get("context_len"), "release_date": body.get("release_date") or None,
           "license": body.get("license") or None, "submit_ok": int(bool(body.get("submit_ok"))), "source": body.get("source") or "api",
           "base_model": body.get("base_model"), "train_dataset": body.get("train_dataset"), "train_script": body.get("train_script"),
           "notes": body.get("notes", ""), "created": old.get("created", time.time())}
    if row["config"].get("api_key"):
        raise ValueError("không lưu khoá API trong model — nhập ở mục Khoá API của nhà cung cấp")
    db.insert("models", row, replace=True)
    return row


@app.delete("/api/models/{mid}")
def model_delete(mid: str):
    db.delete("models", {"id": mid})
    return {"ok": True}


@app.post("/api/models/{mid}/test")
def model_test(mid: str, body: dict | None = None):
    from agent_core.registry import build
    from agent_core.types import ToolSpec

    err = models.check_model_ready(mid)
    if err:
        raise ValueError(err)
    kind, spec, price = models.model_spec(mid)
    t0 = time.time()
    if kind == "llm":
        if spec["plugin"] == "oracle":
            return {"ok": True, "output": "oracle không cần kiểm tra", "latency_s": 0}
        llm = build("llm", spec)
        tool = ToolSpec("alarm.create", "alarm__create", "[ghi] Tạo báo thức",
                        {"type": "object", "properties": {"time": {"type": "string", "description": "ISO-8601"}}, "required": ["time"]})
        r = llm.step("Bạn là trợ lý. Thời điểm hiện tại 2026-11-20T21:00:00+07:00. Dùng tool khi cần.",
                     [{"role": "user", "content": (body or {}).get("text") or "Đặt báo thức 6 giờ sáng mai giúp tôi."}], [tool])
        c = models.cost_of(r.usage, price)
        models.log_usage("model_test", mid, "llm", r.usage, c, False)
        return {"ok": True, "latency_s": round(time.time() - t0, 2), "text": r.text,
                "tool_calls": [{"name": x.name, "arguments": x.arguments} for x in r.tool_calls], "usage": r.usage, "cost": c}
    if kind == "asr":
        asr = build("asr", spec)
        f = (body or {}).get("audio") or next((datasets.train_root() / "train" / "audio").glob("*/*.wav"), None)
        if spec["plugin"] in ("gold", "transcript_file"):
            return {"ok": True, "output": "plugin nội bộ, không cần kiểm tra"}
        r = asr.transcribe_file(Path(f))
        c = models.cost_of(r.get("usage", {}), price)
        models.log_usage("model_test", mid, "asr", r.get("usage", {}), c, False)
        return {"ok": not r.get("error"), "latency_s": round(time.time() - t0, 2), "text": r.get("text"), "error": r.get("error"),
                "audio": str(f), "cost": c}
    tts = build("tts", spec)
    wav = tts.synthesize((body or {}).get("text") or "Xin chào, tôi là trợ lý LifeMate.", (body or {}).get("voice") or "alloy")
    return {"ok": True, "latency_s": round(time.time() - t0, 2), "bytes": len(wav)}


# ======================= datasets =======================
@app.get("/api/datasets")
def datasets_list():
    out = []
    for d in db.all_rows("datasets", order="kind, created"):
        try:
            n = len(datasets.samples(d["id"]))
        except Exception as e:  # split bị xoá
            n, d["error"] = 0, str(e)
        d["n"] = n
        if d["kind"] == "synthetic":
            d["review"] = studio.review_summary(d["id"])
        d.pop("sample_ids", None)
        out.append(d)
    return out


@app.get("/api/datasets/{ds}/stats")
def dataset_stats(ds: str):
    return datasets.stats(ds)


@app.post("/api/datasets/{ds}/samples")
def dataset_samples(ds: str, body: dict | None = None):
    body = body or {}
    rows = datasets.filter_samples(ds, body.get("filter"))
    off, lim = int(body.get("offset", 0)), int(body.get("limit", 100))
    return {"total": len(rows), "rows": rows[off: off + lim], "ids": [r["id"] for r in rows] if body.get("with_ids") else None}


@app.get("/api/datasets/{ds}/samples/{sid}")
def dataset_sample(ds: str, sid: str, state: bool = True):
    d = datasets.sample_detail(ds, sid)
    if state:
        d["state"] = datasets.read_state(ds, sid)
    return d


@app.get("/api/audio")
def audio(ds: str, path: str):
    b = datasets.base_of(datasets.get(ds))
    base = (Path(b["root"]) / b["split"]).resolve()
    p = (base / path).resolve()
    if base not in p.parents or p.suffix.lower() != ".wav" or not p.is_file():
        raise HTTPException(404, "không có file audio")
    return FileResponse(p, media_type="audio/wav")


@app.post("/api/datasets/{ds}/subset")
def dataset_subset(ds: str, body: dict):
    ids = body.get("sample_ids")
    if ids is None:
        ids = [r["id"] for r in datasets.filter_samples(ds, body.get("filter"))]
    if not ids:
        raise ValueError("tập con rỗng")
    return {"id": datasets.create_subset(ds, body.get("name") or "Tập con", ids, body.get("filter"), body.get("notes", "")), "n": len(ids)}


@app.post("/api/datasets/{ds}/holdout")
def dataset_holdout(ds: str, body: dict):
    a, b = datasets.holdout_apps(ds, body["apps"], body.get("name") or "Giấu app")
    return {"holdout": a, "rest": b}


@app.delete("/api/datasets/{ds}")
def dataset_delete(ds: str):
    d = datasets.get(ds)
    if d["kind"] == "official":
        raise ValueError("không xoá dataset chính thức")
    if d["kind"] == "synthetic":
        import shutil

        shutil.rmtree(DATASETS / d["split"], ignore_errors=True)
        db.delete("synth_samples", {"dataset_id": ds})
    db.delete("datasets", {"id": ds})
    datasets.invalidate()
    return {"ok": True}


# ---------- nguồn dữ liệu (dữ liệu BTC nằm ngoài repo) ----------
@app.get("/api/data_sources")
def data_sources():
    out = []
    for src in db.all_rows("data_sources", order="created"):
        ds = [d for d in db.query("SELECT id, root, split FROM datasets WHERE kind='official'")
              if d["root"] and (d["root"] == src["path"] or d["root"].startswith(src["path"].rstrip("/") + "/"))]
        out.append({**src, "exists": Path(src["path"]).is_dir(), "datasets": [d["id"] for d in ds]})
    try:
        tr = str(datasets.train_root())
    except FileNotFoundError:
        tr = None
    return {"sources": out, "train_root": tr}


@app.post("/api/data_sources")
def data_source_add(body: dict):
    return datasets.add_source(body["path"], body.get("notes", ""))


@app.delete("/api/data_sources/{sid}")
def data_source_delete(sid: str):
    return datasets.remove_source(sid)


# ---------- import file dự đoán (ASR / LLM) ----------
def _read_upload(file: UploadFile | None, path: str | None) -> bytes:
    if file is not None:
        return file.file.read()
    if path:
        p = Path(path).expanduser()
        if not p.is_file():
            raise ValueError(f"không tìm thấy file {p}")
        return p.read_bytes()
    raise ValueError("cần tải file lên hoặc nhập đường dẫn file")


@app.get("/api/predictions")
def predictions_list():
    return predictions.list_imports()


@app.post("/api/predictions/asr")
def predictions_asr(file: UploadFile | None = File(None), path: str | None = Form(None), name: str = Form(...), notes: str = Form("")):
    return predictions.import_asr(_read_upload(file, path), name, notes)


@app.post("/api/predictions/llm")
def predictions_llm(file: UploadFile | None = File(None), path: str | None = Form(None), name: str = Form(...),
                    dataset_id: str | None = Form(None), notes: str = Form(""), missing_as_zero: bool = Form(False)):
    return predictions.import_llm(_read_upload(file, path), name, dataset_id or None, notes, missing_as_zero)


@app.delete("/api/predictions/asr/{model_id}")
def predictions_asr_delete(model_id: str):
    predictions.delete_asr(model_id)
    return {"ok": True}


@app.post("/api/datasets/rescan")
def dataset_rescan():
    datasets.scan()
    datasets.invalidate()
    return {"ok": True}


# ======================= thử nghiệm & run =======================
@app.get("/api/experiments")
def experiments_list():
    return db.all_rows("experiments", order="updated DESC")


@app.post("/api/experiments")
def experiment_save(body: dict):
    cfg = ExperimentConfig(**body["config"])
    eid = body.get("id") or db.new_id("exp_")
    old = db.get("experiments", id=eid) or {}
    db.insert("experiments", {"id": eid, "name": body.get("name") or cfg.name, "config": cfg.model_dump(),
                              "created": old.get("created", time.time()), "updated": time.time()}, replace=True)
    return {"id": eid}


@app.get("/api/experiments/{eid}")
def experiment_get(eid: str):
    e = db.get("experiments", id=eid)
    if not e:
        raise KeyError(eid)
    return e


@app.delete("/api/experiments/{eid}")
def experiment_delete(eid: str):
    db.delete("experiments", {"id": eid})
    return {"ok": True}


@app.post("/api/experiments/validate")
def experiment_validate(body: dict):
    cfg = ExperimentConfig(**body)
    spec = resolve(cfg)
    return {"ok": True, "n": len(spec["sample_ids"])}


@app.post("/api/experiments/estimate")
def experiment_estimate(body: dict):
    return estimate(ExperimentConfig(**body))


@app.get("/api/runs")
def runs_list(kind: str | None = None):
    rows = db.query("SELECT id, experiment_id, name, dataset_id, status, total, done, score, cost, created, finished, kind, "
                    "json_extract(metrics,'$.hash_ok') AS hash_ok, json_extract(metrics,'$.latency_p95') AS p95, "
                    "json_extract(metrics,'$.asr.wer') AS wer, json_extract(config,'$.llm_model') AS llm_model, "
                    "json_extract(config,'$.asr_model') AS asr_model FROM runs ORDER BY created DESC")
    for r in rows:
        r["active"] = RUNNER.is_active(r["id"])
    return rows


@app.post("/api/runs")
def run_start(body: dict):
    cfg = ExperimentConfig(**body["config"])
    rid = RUNNER.start(cfg, body.get("experiment_id"), body.get("name"))
    return {"id": rid}


@app.get("/api/runs/{rid}")
def run_get(rid: str):
    r = db.get("runs", id=rid)
    if not r:
        raise KeyError(rid)
    r["active"] = RUNNER.is_active(rid)
    return r


@app.post("/api/runs/{rid}/samples")
def run_samples(rid: str, body: dict | None = None):
    body = body or {}
    rows = db.query("SELECT sample_id, idx, status, score, hash_ok, M, U, G, P, R, f1_nohash, tags, scenario, apps, hist_turns, new_app, "
                    "n_calls, latency_s, time_asr_s, cost, tokens_in, tokens_out, steps, asr FROM run_samples WHERE run_id=? ORDER BY idx", (rid,))
    f = body.get("filter") or {}
    out = []
    for r in rows:
        if f.get("tag") and f["tag"] not in (r["tags"] or []):
            continue
        if f.get("scenario") and r["scenario"] != f["scenario"]:
            continue
        if f.get("app") and f["app"] not in (r["apps"] or []):
            continue
        if f.get("status") and r["status"] != f["status"]:
            continue
        if f.get("max_score") is not None and (r["score"] is None or r["score"] > f["max_score"]):
            continue
        if f.get("min_score") is not None and (r["score"] is None or r["score"] < f["min_score"]):
            continue
        if f.get("q") and f["q"] not in r["sample_id"]:
            continue
        a = r.pop("asr") or {}
        fin = next((x for x in a.values() if x.get("final")), None)
        r["wer"] = round(100 * fin["w_err"] / max(fin["w_n"], 1), 1) if fin and "w_n" in fin else None
        out.append(r)
    sort = body.get("sort")
    if sort:
        key, rev = sort.lstrip("-"), sort.startswith("-")
        out.sort(key=lambda r: (r.get(key) is None, r.get(key) if r.get(key) is not None else 0), reverse=rev)
    off, lim = int(body.get("offset", 0)), int(body.get("limit", 200))
    return {"total": len(out), "rows": out[off: off + lim]}


@app.post("/api/runs/{rid}/rescore")
def run_rescore(rid: str, body: dict | None = None):
    """Chấm lại từ trace đã lưu (không gọi lại model), với tuỳ chọn scorer hiện tại (+ ghi đè trong body.score)."""
    from lab.scoring.rescore import rescore

    if RUNNER.is_active(rid):
        raise ValueError("run đang chạy")
    return rescore(rid, (body or {}).get("score"))


@app.get("/api/runs/{rid}/asr")
def run_asr(rid: str, limit: int = 300, only_errors: bool = True):
    """Từng câu đã nhận dạng (ref / hyp / WER), xếp theo WER giảm dần."""
    out = []
    for r in db.query("SELECT sample_id, asr, score FROM run_samples WHERE run_id=?", (rid,)):
        for rel, a in (r["asr"] or {}).items():
            if "w_n" not in a:
                continue
            w = a["w_err"] / max(a["w_n"], 1)
            if only_errors and a.get("exact"):
                continue
            out.append({"sample_id": r["sample_id"], "audio": rel, "final": a.get("final"), "ref": a.get("ref"), "hyp": a.get("hyp"),
                        "ref_norm": asr_normalize(a.get("ref") or ""), "hyp_norm": asr_normalize(a.get("hyp") or ""),
                        "raw": a.get("raw"), "wer": round(100 * w, 1), "entity_recall": round(100 * a["e_hit"] / a["e_n"], 1) if a["e_n"] else None,
                        "score": r["score"], "error": a.get("error")})
    out.sort(key=lambda x: -x["wer"])
    return out[:limit]


@app.get("/api/runs/{rid}/samples/{sid}")
def run_trace(rid: str, sid: str):
    t = read_trace(rid, sid)
    if t is None:
        raise KeyError(sid)
    for a in (t.get("asr") or {}).values():      # chữ đã chuẩn hoá (đúng cách tính WER) để so sánh trên giao diện
        if isinstance(a, dict) and a.get("ref") is not None:
            a["ref_norm"], a["hyp_norm"] = asr_normalize(a["ref"]), asr_normalize(a.get("hyp") or "")
    r = db.get("runs", id=rid)
    row = db.get("run_samples", run_id=rid, sample_id=sid)
    try:
        det = datasets.sample_detail(r["dataset_id"], sid)
    except KeyError:
        det = None
    return {"trace": t, "row": row, "sample": det}


@app.post("/api/runs/{rid}/pause")
def run_pause(rid: str):
    RUNNER.pause(rid)
    return {"ok": True}


@app.post("/api/runs/{rid}/resume")
def run_resume(rid: str):
    if (db.get("runs", id=rid) or {}).get("kind") == "import":
        raise ValueError("run import từ file không tiếp tục được")
    RUNNER.resume(rid)
    return {"ok": True}


@app.post("/api/runs/{rid}/cancel")
def run_cancel(rid: str):
    RUNNER.cancel(rid)
    return {"ok": True}


@app.delete("/api/runs/{rid}")
def run_delete(rid: str):
    import shutil

    if RUNNER.is_active(rid):
        raise ValueError("run đang chạy, hãy huỷ trước")
    db.delete("run_samples", {"run_id": rid})
    db.delete("runs", {"id": rid})
    shutil.rmtree(RUNS / rid, ignore_errors=True)
    return {"ok": True}


@app.post("/api/runs/{rid}/rerun")
def run_rerun(rid: str, body: dict | None = None):
    """Chạy lại (toàn bộ hoặc chỉ các mẫu lỗi / các mẫu đã chọn) thành run mới, có thể ghi đè cấu hình."""
    body = body or {}
    r = db.get("runs", id=rid)
    if r.get("kind") == "import":
        raise ValueError("run import từ file không chạy lại được (không có model) — hãy import file mới")
    cfg = dict(r["config"])
    cfg.update(body.get("overrides") or {})
    which = body.get("which", "all")
    if which == "failed":
        cfg["sample_ids"] = [x["sample_id"] for x in db.query(
            "SELECT sample_id FROM run_samples WHERE run_id=? AND (status!='done' OR score IS NULL OR score<1)", (rid,))]
    elif which == "errors":
        cfg["sample_ids"] = [x["sample_id"] for x in db.query("SELECT sample_id FROM run_samples WHERE run_id=? AND status!='done'", (rid,))]
    elif isinstance(which, list):
        cfg["sample_ids"] = which
    if which != "all" and not cfg.get("sample_ids"):
        raise ValueError("không có mẫu nào cần chạy lại")
    cfg["limit"] = 0 if cfg.get("sample_ids") else cfg.get("limit", 0)
    nid = RUNNER.start(ExperimentConfig(**cfg), r["experiment_id"], body.get("name") or f"{r['name']} (chạy lại)")
    return {"id": nid}


@app.get("/api/runs/{rid}/submission")
def run_submission(rid: str):
    p = RUNS / rid / "submission.jsonl"
    if not p.is_file():
        raise KeyError("submission.jsonl")
    return FileResponse(p, filename=f"submission_{rid}.jsonl", media_type="application/jsonl")


@app.websocket("/api/runs/{rid}/ws")
async def run_ws(ws: WebSocket, rid: str):
    await ws.accept()
    seq = 0
    try:
        while True:
            r = db.get("runs", id=rid)
            h = RUNNER.handles.get(rid)
            evs = h.since(seq) if h else []
            if evs:
                seq = evs[-1]["seq"]
            await ws.send_json({"run": {k: r[k] for k in ("status", "done", "total", "cost", "score")} if r else None,
                                "active": RUNNER.is_active(rid), "events": evs[-200:]})
            if r and not RUNNER.is_active(rid) and r["status"] not in ("running", "queued"):
                await asyncio.sleep(1.0)
                await ws.send_json({"run": {k: r[k] for k in ("status", "done", "total", "cost", "score")}, "active": False, "events": [], "final": True})
                break
            await asyncio.sleep(0.8)
    except WebSocketDisconnect:
        pass


# ---------- so sánh ----------
@app.post("/api/compare")
def compare(body: dict):
    ids = body["run_ids"]
    runs = [db.get("runs", id=i) for i in ids]
    if any(r is None for r in runs):
        raise KeyError("run")
    per = {}
    for r in runs:
        for x in db.query("SELECT sample_id, score, status, tags FROM run_samples WHERE run_id=?", (r["id"],)):
            per.setdefault(x["sample_id"], {})[r["id"]] = {"score": x["score"], "status": x["status"], "tags": x["tags"]}
    rows, flips = [], Counter()
    for sid, d in per.items():
        if len(d) < len(ids):
            continue
        sc = [d[i]["score"] for i in ids]
        if any(s is None for s in sc):
            continue
        spread = max(sc) - min(sc)
        if spread > 1e-9:
            a, b = sc[0], sc[-1]
            kind = "better" if b > a else "worse" if b < a else "mixed"
            flips[kind] += 1
            rows.append({"sample_id": sid, "scores": sc, "kind": kind, "delta": round(b - a, 4), "tags": [d[i]["tags"] for i in ids]})
    rows.sort(key=lambda x: x["delta"])
    return {"runs": [{"id": r["id"], "name": r["name"], "score": r["score"], "metrics": r["metrics"], "config": r["config"]} for r in runs],
            "common": sum(1 for d in per.values() if len(d) == len(ids)), "flips": dict(flips), "rows": rows}


# ---------- chi phí ----------
@app.get("/api/costs")
def costs(days: int = 30):
    since = time.time() - days * 86400
    by_model = db.query("SELECT model_id, kind, SUM(cost) AS cost, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens, "
                        "SUM(audio_seconds) AS audio_seconds, SUM(chars) AS chars, COUNT(*) AS calls, SUM(cached) AS cached "
                        "FROM usage_log WHERE ts>? GROUP BY model_id, kind ORDER BY cost DESC", (since,))
    by_owner = db.query("SELECT owner, SUM(cost) AS cost, COUNT(*) AS calls, MIN(ts) AS first FROM usage_log WHERE ts>? GROUP BY owner "
                        "ORDER BY first DESC LIMIT 200", (since,))
    by_day = db.query("SELECT date(ts, 'unixepoch', 'localtime') AS day, SUM(cost) AS cost FROM usage_log WHERE ts>? GROUP BY day ORDER BY day", (since,))
    total = db.query("SELECT COALESCE(SUM(cost),0) AS c FROM usage_log")[0]["c"]
    return {"total": total, "by_model": by_model, "by_owner": by_owner, "by_day": by_day}


# ---------- nộp bài ----------
@app.get("/api/submission/{rid}/checks")
def sub_checks(rid: str, other: str | None = None):
    return submission.checks(rid, other)


@app.post("/api/submission/{rid}/validate")
def sub_validate(rid: str):
    return submission.validate_file(rid)


@app.get("/api/lb_scores")
def lb_list():
    rows = db.query("SELECT l.*, r.name AS run_name, r.score AS local_score, r.dataset_id FROM lb_scores l LEFT JOIN runs r ON r.id=l.run_id ORDER BY ts DESC")
    return rows


@app.post("/api/lb_scores")
def lb_add(body: dict):
    db.insert("lb_scores", {"run_id": body.get("run_id"), "score": float(body["score"]), "note": body.get("note", ""), "ts": time.time()})
    return {"ok": True}


@app.delete("/api/lb_scores/{lid}")
def lb_delete(lid: int):
    db.delete("lb_scores", {"id": lid})
    return {"ok": True}


# ======================= jobs =======================
@app.get("/api/jobs")
def jobs_list(kind: str | None = None):
    rows = db.query("SELECT id, kind, status, progress, total, cost, budget, payload, error, created, updated FROM jobs "
                    + ("WHERE kind=? " if kind else "") + "ORDER BY created DESC LIMIT 200", (kind,) if kind else ())
    return rows


@app.get("/api/jobs/{jid}")
def job_get(jid: str):
    j = db.get("jobs", id=jid)
    if not j:
        raise KeyError(jid)
    return j


@app.post("/api/jobs/{jid}/cancel")
def job_cancel(jid: str):
    JOBS.cancel(jid)
    return {"ok": True}


# ======================= Data Studio =======================
@app.get("/api/recipes")
def recipes_list():
    return db.all_rows("recipes", order="updated DESC")


@app.post("/api/recipes")
def recipe_save(body: dict):
    from training.gen_synthetic.generate import Recipe

    r = Recipe(**body["config"])
    rid = body.get("id") or db.new_id("rcp_")
    old = db.get("recipes", id=rid) or {}
    db.insert("recipes", {"id": rid, "name": body.get("name") or "Công thức", "config": r.model_dump(),
                          "created": old.get("created", time.time()), "updated": time.time()}, replace=True)
    return {"id": rid}


@app.delete("/api/recipes/{rid}")
def recipe_delete(rid: str):
    db.delete("recipes", {"id": rid})
    return {"ok": True}


@app.post("/api/synth/preview")
def synth_preview(body: dict):
    """Chạy thử một đợt nhỏ (mặc định 5 mẫu) vào một split mới để xem trước chất lượng."""
    rec = dict(body["recipe"])
    rec["n_samples"] = int(body.get("n", 5))
    return studio.start_generation(rec, name=(body.get("name") or "Xem trước"))


@app.post("/api/synth/generate")
def synth_generate(body: dict):
    return studio.start_generation(body["recipe"], body.get("name"), body.get("dataset_id"))


@app.get("/api/synth/calibration")
def synth_calibration(model: str):
    return studio.teacher_calibration(model)


@app.get("/api/datasets/{ds}/duplicates")
def dataset_duplicates(ds: str, threshold: float = 0.8):
    return studio.duplicates(ds, threshold)


@app.get("/api/synth/{ds}/coverage")
def synth_coverage(ds: str):
    return studio.coverage(ds)


@app.get("/api/synth/batches")
def synth_batches():
    return db.all_rows("synth_batches", order="created DESC")


@app.get("/api/synth/{ds}/queue")
def synth_queue(ds: str, status: str | None = None, flagged: str | None = None, scenario: str | None = None, spot: int | None = None):
    return studio.queue(ds, status, flagged, scenario, None if spot is None else bool(spot))


@app.get("/api/synth/{ds}/summary")
def synth_summary(ds: str):
    return studio.review_summary(ds)


@app.get("/api/synth/{ds}/samples/{sid}")
def synth_sample(ds: str, sid: str):
    return studio.sample_full(ds, sid)


@app.post("/api/synth/{ds}/review")
def synth_review(ds: str, body: dict):
    studio.set_status(ds, body["sample_ids"], body["status"])
    return {"ok": True}


@app.put("/api/synth/{ds}/samples/{sid}")
def synth_edit(ds: str, sid: str, body: dict):
    return studio.edit_sample(ds, sid, body["edits"])


@app.post("/api/synth/{ds}/relabel")
def synth_relabel(ds: str, body: dict):
    return {"job_id": studio.relabel(ds, body["sample_ids"], body["model"], body.get("rules", "rules_v2"))}


@app.post("/api/synth/{ds}/spot_check")
def synth_spot(ds: str, body: dict):
    return {"n": studio.spot_check(ds, float(body.get("rate", 0.1)), int(body.get("seed", 0)))}


@app.post("/api/synth/{ds}/tts")
def synth_tts(ds: str, body: dict):
    return {"job_id": studio.start_tts(ds, body["model"], body.get("voices") or {}, body.get("statuses"), body.get("augment"),
                                       bool(body.get("overwrite")), int(body.get("seed", 0)))}


@app.post("/api/tts/preview")
def tts_preview(body: dict):
    wav = studio.tts_preview(body["model"], body["text"], body.get("voice") or "alloy", body.get("augment"))
    return Response(wav, media_type="audio/wav")


@app.get("/api/exports")
def exports_list():
    return db.all_rows("dataset_versions", order="created DESC")


@app.post("/api/exports")
def export_start(body: dict):
    return {"job_id": studio.start_export(body.get("name") or "export", body["components"], body.get("options") or {})}


@app.get("/api/exports/{vid}/download")
def export_download(vid: str, file: str = "sft.jsonl"):
    v = db.get("dataset_versions", id=vid)
    if not v:
        raise KeyError(vid)
    p = Path(v["export_path"]) / Path(file).name
    if not p.is_file():
        raise KeyError(file)
    return FileResponse(p, filename=f"{vid}_{p.name}")


@app.get("/api/exports/{vid}/preview")
def export_preview(vid: str, n: int = 3):
    v = db.get("dataset_versions", id=vid)
    f = Path(v["export_path"]) / ("sft.jsonl" if (v.get("options") or {}).get("kind", "sft") == "sft" else "asr_manifest.jsonl")
    out = []
    with open(f, encoding="utf-8") as fh:
        for i, line in enumerate(fh):
            if i >= n:
                break
            out.append(json.loads(line))
    return out


# ---------- App Factory ----------
@app.get("/api/apps")
def apps_list():
    from training.gen_synthetic.split import approved_apps

    rows = db.all_rows("gen_apps", order="updated DESC")
    appr = set(approved_apps())
    for r in rows:
        r["approved_on_disk"] = r["app_id"] in appr
    return rows


@app.get("/api/apps/{rid}")
def app_get(rid: str):
    r = db.get("gen_apps", id=rid)
    if not r:
        raise KeyError(rid)
    return r


@app.post("/api/apps")
def app_create(body: dict):
    return studio.app_create(body["app"], body.get("notes", ""))


@app.post("/api/apps/generate")
def app_generate(body: dict):
    return {"job_id": studio.app_generate(body["idea"], body["model"])}


@app.put("/api/apps/{rid}")
def app_save(rid: str, body: dict):
    return studio.app_save(rid, body["app"])


@app.post("/api/apps/{rid}/approve")
def app_approve(rid: str, body: dict | None = None):
    studio.app_approve(rid, (body or {}).get("approve", True))
    return {"ok": True}


@app.delete("/api/apps/{rid}")
def app_delete(rid: str):
    r = db.get("gen_apps", id=rid)
    if r and r["status"] == "approved":
        raise ValueError("bỏ duyệt app trước khi xoá")
    db.delete("gen_apps", {"id": rid})
    return {"ok": True}


@app.get("/api/catalog/apps")
def catalog_apps():
    """App dùng được để sinh dữ liệu: app của train + app tự tạo đã duyệt (không gồm 11 app chỉ có ở public_test)."""
    from training.gen_synthetic.split import approved_apps, base_catalog

    out = [{"id": a["id"], "name_vi": a.get("name_vi"), "group": a.get("group"), "source": "train", "n_tools": len(a["tools"])}
           for a in base_catalog()["apps"] if a["id"] != "sys"]
    for k, v in approved_apps().items():
        out.append({"id": k, "name_vi": v["spec"].get("name_vi"), "group": v["spec"].get("group"), "source": "generated",
                    "n_tools": len(v["spec"].get("tools", []))})
    return out


# ======================= playground =======================
@app.post("/api/playground")
def pg_open(body: dict):
    return pg.PLAYGROUND.open(body["dataset_id"], body["sample_id"], body.get("llm_model"), body.get("renderer", "compact"),
                              body.get("prompt"), body.get("guards"), body.get("text"))


@app.post("/api/playground/{sid}")
def pg_cmd(sid: str, body: dict):
    return pg.PLAYGROUND.cmd(sid, body)


@app.delete("/api/playground/{sid}")
def pg_close(sid: str):
    pg.PLAYGROUND.close(sid)
    return {"ok": True}


# ======================= UI =======================
UI_DIST = HOME / "ui" / "dist"


@app.get("/{path:path}")
def spa(path: str):
    if path.startswith("api/"):
        raise HTTPException(404)
    f = UI_DIST / path
    if path and f.is_file() and UI_DIST in f.resolve().parents:
        return FileResponse(f)
    idx = UI_DIST / "index.html"
    if idx.is_file():
        return FileResponse(idx)
    return JSONResponse({"detail": "UI chưa được build: cd ui && npm install && npm run build"}, status_code=404)
