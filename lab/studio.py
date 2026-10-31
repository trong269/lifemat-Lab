"""Lớp dịch vụ Data Studio: sinh dữ liệu, duyệt/sửa, gán nhãn lại, xuất, TTS, App Factory."""
from __future__ import annotations

import json
import multiprocessing as mp
import random
import subprocess
import sys
import time
from collections import Counter, defaultdict
from pathlib import Path

from lab.core import datasets, db, models
from lab.core.jobs import JOBS, JobCtx
from lab.core.paths import DATASETS, EXPORTS, HOME, PUBLIC_ONLY_APPS


def _model_payload(model_id: str | None, role: str = "llm") -> dict | None:
    if not model_id:
        return None
    err = models.check_model_ready(model_id)
    if err:
        raise ValueError(err)
    kind, spec, price = models.model_spec(model_id)
    if kind != role:
        raise ValueError(f"model {model_id} là {kind}, cần {role}")
    return {"id": model_id, "spec": spec, "price": price}


def run_ops(req: dict, timeout: int = 600) -> dict:
    """Chạy training.gen_synthetic.ops trong tiến trình con (nạp đúng zaic_tools của split)."""
    p = subprocess.run([sys.executable, "-m", "training.gen_synthetic.ops"], input=json.dumps(req, ensure_ascii=False),
                       capture_output=True, text=True, timeout=timeout, cwd=str(HOME))
    lines = [x for x in p.stdout.strip().splitlines() if x.startswith("{")]
    if not lines:
        raise RuntimeError(f"ops lỗi: {p.stderr[-2000:]}")
    out = json.loads(lines[-1])
    if not out.get("ok"):
        raise RuntimeError(out.get("error") or "ops lỗi")
    return out


# ---------------- generation ----------------
def start_generation(recipe: dict, name: str | None = None, dataset_id: str | None = None) -> dict:
    from training.gen_synthetic.generate import Recipe
    from training.gen_synthetic.split import create_split

    r = Recipe(**recipe)
    bad = [a for a in r.apps_pool + r.extra_apps if a in PUBLIC_ONLY_APPS]
    if bad:
        raise ValueError(f"không được dùng app chỉ có ở public_test: {bad}")
    if not r.writer_model or not r.labeler_model:
        raise ValueError("cần chọn model viết câu (writer) và model teacher (labeler)")
    mods = {"writer": _model_payload(r.writer_model), "labeler": _model_payload(r.labeler_model),
            "labeler2": _model_payload(r.labeler2_model)}
    batch_id = db.new_id("batch_")
    start_index = 0
    if dataset_id:            # nối thêm vào split tổng hợp đã có
        ds = datasets.get(dataset_id)
        if ds["kind"] != "synthetic":
            raise ValueError("chỉ nối thêm vào dataset tổng hợp")
        split = ds["split"]
        from training.gen_synthetic.split import read_records

        start_index = len(read_records(DATASETS / split)) + 1000 * (1 + len(db.all_rows("synth_batches", dataset_id=dataset_id)))
    else:
        split = "synth_" + time.strftime("%m%d_%H%M%S")
        create_split(split, r.extra_apps)
        datasets.scan()
        dataset_id = split
        db.update("datasets", {"id": split}, {"name": name or split, "notes": f"Sinh bởi {r.writer_model} / {r.labeler_model}"})
    spec = {"split": split, "recipe": r.model_dump(), "models": mods, "batch_id": batch_id, "start_index": start_index}
    db.insert("synth_batches", {"id": batch_id, "name": name or split, "recipe": r.model_dump(), "dataset_id": dataset_id,
                                "status": "running", "n_target": r.n_samples, "n_done": 0, "job_id": None, "created": time.time()})
    # spec chứa khoá API: truyền qua closure, không lưu vào payload của job
    job_id = JOBS.start("generate", lambda ctx, p: _gen_job(ctx, p, spec),
                        {"split": split, "batch_id": batch_id, "dataset_id": dataset_id}, budget=r.budget_usd)
    db.update("synth_batches", {"id": batch_id}, {"job_id": job_id})
    return {"batch_id": batch_id, "job_id": job_id, "dataset_id": dataset_id, "calibration": teacher_calibration(r.labeler_model)}


def _gen_job(ctx: JobCtx, payload: dict, spec: dict):
    from training.gen_synthetic.generate import generation_main

    mctx = mp.get_context("spawn")
    q, stop = mctx.Queue(), mctx.Event()
    p = mctx.Process(target=generation_main, args=(spec, q, stop), daemon=True)
    p.start()
    n_t = spec["recipe"]["n_samples"]
    done = fails = 0
    ctx.progress(0, n_t)
    while True:
        if ctx.should_stop() and not stop.is_set():
            stop.set()
            ctx.log("đang dừng (đợi các mẫu đang sinh xong)…")
        try:
            m = q.get(timeout=1)
        except Exception:
            if not p.is_alive():
                break
            continue
        t = m["type"]
        if t == "usage":
            ctx.add_cost(m["cost"])
            models.log_usage(ctx.id, m["model_id"], m["kind"], m["usage"], m["cost"], m["cached"])
        elif t == "sample":
            done += 1
            db.insert("synth_samples", {"dataset_id": payload["dataset_id"], "sample_id": m["sid"], "batch_id": payload["batch_id"],
                                        "scenario": m["scenario"], "status": "pending", "flags": m["flags"],
                                        "disagreement": m["disagreement"], "spot_check": m["spot_check"], "provenance": m["provenance"],
                                        "updated": time.time()}, replace=True)
            ctx.progress(done + fails, n_t)
            db.update("synth_batches", {"id": payload["batch_id"]}, {"n_done": done, "cost": ctx.cost})
        elif t == "fail":
            fails += 1
            ctx.log(f"mẫu {m['i']} lỗi: {m['error'][:200]}")
            ctx.progress(done + fails, n_t)
        elif t == "fatal":
            ctx.log(m["error"][-800:])
            raise RuntimeError("tiến trình sinh dữ liệu lỗi: " + m["error"][-500:])
        elif t == "end":
            break
    p.join(timeout=10)
    datasets.invalidate()
    st = "cancelled" if ctx.cancelled else "stopped_budget" if ctx.over_budget() else "done"
    db.update("synth_batches", {"id": payload["batch_id"]}, {"status": st, "n_done": done, "cost": ctx.cost})
    return {"done": done, "failed": fails, "dataset_id": payload["dataset_id"]}


def teacher_calibration(model_id: str) -> dict:
    """Điểm gần nhất của model khi chạy trên train (hoặc tập con của train) — dùng để quyết định có nên sinh hàng loạt."""
    rows = db.query("SELECT r.id, r.name, r.score, r.done, r.dataset_id, json_extract(r.config,'$.prompt') AS prompt, r.finished "
                    "FROM runs r LEFT JOIN datasets d ON d.id = r.dataset_id "
                    "WHERE json_extract(r.config,'$.llm_model')=? AND r.score IS NOT NULL AND (r.dataset_id='train' OR d.parent_id='train') "
                    "ORDER BY r.finished DESC", (model_id,))
    # run tốt nhất có đủ mẫu (một run thử với timeout ngắn không được làm lu mờ kết quả hiệu chỉnh thật)
    enough = [r for r in rows if r["done"] >= 50]
    best = max(enough or rows, key=lambda r: r["score"]) if rows else None
    ok = bool(best and best["score"] >= 85 and best["done"] >= 50)
    msg = ("chưa có lần chạy nào của model này trên train — nên hiệu chỉnh teacher trước khi sinh hàng loạt" if not best else
           f"điểm tốt nhất trên train: {best['score']:.1f} ({best['done']} mẫu, run {best['name']})"
           + ("" if ok else " — dưới ngưỡng 85 hoặc ít hơn 50 mẫu"))
    return {"ok": ok, "message": msg, "runs": rows[:5]}


def duplicates(dataset_id: str, threshold: float = 0.8, limit: int = 200) -> list[dict]:
    """Cặp mẫu gần trùng theo câu yêu cầu (Jaccard trên 3-gram từ)."""
    import re
    import unicodedata

    feats = datasets.filter_samples(dataset_id, None)

    def sh(t):
        w = re.findall(r"\w+", unicodedata.normalize("NFC", (t or "").lower()))
        return {" ".join(w[i:i + 3]) for i in range(max(1, len(w) - 2))}

    items = [(f["id"], f["text"], sh(f["text"])) for f in feats if f["text"]]
    index: dict[str, list[int]] = defaultdict(list)
    for i, (_, _, s) in enumerate(items):
        for g in s:
            index[g].append(i)
    out, seen = [], set()
    for i, (a, ta, sa) in enumerate(items):
        cand = Counter(j for g in sa for j in index[g] if j > i)
        for j, inter in cand.items():
            sb = items[j][2]
            jac = inter / len(sa | sb)
            if jac >= threshold and (i, j) not in seen:
                seen.add((i, j))
                out.append({"a": a, "b": items[j][0], "text_a": ta, "text_b": items[j][1], "jaccard": round(jac, 3)})
    out.sort(key=lambda x: -x["jaccard"])
    return out[:limit]


def coverage(dataset_id: str) -> dict:
    """Phân bố thực tế so với mục tiêu của công thức (kịch bản, vùng miền, app trọng tâm, số lượt history)."""
    from training.gen_synthetic.split import read_records

    ds = datasets.get(dataset_id)
    recs = read_records(DATASETS / ds["split"])
    batches = db.all_rows("synth_batches", dataset_id=dataset_id)
    target = {}
    if batches:
        w = batches[0]["recipe"].get("weights", {})
        tot = sum(w.values()) or 1
        target = {k: round(v / tot, 4) for k, v in w.items()}
    n = len(recs) or 1
    sc = Counter((r.get("meta") or {}).get("scenario") for r in recs)
    return {"n": len(recs), "scenario": {k: {"actual": round(sc.get(k, 0) / n, 4), "target": target.get(k), "count": sc.get(k, 0)}
                                         for k in sorted(set(sc) | set(target), key=str)},
            "region": dict(Counter((r.get("meta") or {}).get("region") for r in recs)),
            "focus_apps": dict(Counter(a for r in recs for a in (r.get("meta") or {}).get("focus") or []).most_common()),
            "history_turns": dict(sorted(Counter(sum(1 for t in r.get("history", []) if t["role"] == "user") for r in recs).items())),
            "n_calls": dict(sorted(Counter(len((r.get("label") or {}).get("tool_calls") or []) for r in recs).items()))}


# ---------------- review ----------------
def queue(dataset_id: str, status: str | None = None, flagged: str | None = None, scenario: str | None = None,
          spot: bool | None = None, limit: int = 500) -> list[dict]:
    rows = db.all_rows("synth_samples", order="sample_id", dataset_id=dataset_id)
    out = []
    for r in rows:
        if status and r["status"] != status:
            continue
        nerr = sum(1 for f in r["flags"] or [] if f["level"] == "error")
        nwarn = sum(1 for f in r["flags"] or [] if f["level"] == "warn")
        if flagged == "error" and not nerr:
            continue
        if flagged == "any" and not (nerr or nwarn):
            continue
        if flagged == "clean" and (nerr or nwarn):
            continue
        if scenario and r["scenario"] != scenario:
            continue
        if spot is not None and bool(r["spot_check"]) != spot:
            continue
        r["n_err"], r["n_warn"] = nerr, nwarn
        out.append(r)
    out.sort(key=lambda r: (r["status"] != "pending", -r["disagreement"], -r["n_err"], -r["n_warn"], r["sample_id"]))
    return out[:limit]


def review_summary(dataset_id: str) -> dict:
    rows = db.all_rows("synth_samples", order="sample_id", dataset_id=dataset_id)
    from collections import Counter

    st = Counter(r["status"] for r in rows)
    err = sum(1 for r in rows if any(f["level"] == "error" for f in r["flags"] or []))
    spot = [r for r in rows if r["spot_check"] and r["status"] in ("approved", "rejected")]
    spot_bad = sum(1 for r in spot if r["status"] == "rejected")
    return {"n": len(rows), "status": dict(st), "with_error": err, "disagreement": sum(r["disagreement"] for r in rows),
            "spot_checked": len(spot), "spot_rejected": spot_bad,
            "spot_error_rate": round(spot_bad / len(spot), 3) if spot else None,
            "scenario": dict(Counter(r["scenario"] for r in rows))}


def sample_full(dataset_id: str, sid: str) -> dict:
    from training.gen_synthetic.split import read_records

    ds = datasets.get(dataset_id)
    d = DATASETS / ds["split"]
    rec = next((r for r in read_records(d) if r["id"] == sid), None)
    if rec is None:
        raise KeyError(sid)
    base_p = d / "_gen" / f"{sid}.base.json"
    row = db.get("synth_samples", dataset_id=dataset_id, sample_id=sid) or {}
    edits = db.query("SELECT ts, field FROM sample_edits WHERE dataset_id=? AND sample_id=? ORDER BY ts DESC", (dataset_id, sid))
    return {"record": rec, "state": datasets.read_state(dataset_id, sid),
            "base_state": json.loads(base_p.read_text(encoding="utf-8")) if base_p.is_file() else None,
            "review": row, "edits": edits}


def set_status(dataset_id: str, sids: list[str], status: str, reviewer: str = "me"):
    assert status in ("pending", "approved", "rejected", "needs_relabel")
    for sid in sids:
        db.update("synth_samples", {"dataset_id": dataset_id, "sample_id": sid}, {"status": status, "reviewer": reviewer, "updated": time.time()})


def edit_sample(dataset_id: str, sid: str, edits: dict) -> dict:
    ds = datasets.get(dataset_id)
    before = sample_full(dataset_id, sid)
    out = run_ops({"cmd": "resim", "split": ds["split"], "sid": sid, "edits": edits})
    for k in out.get("changed", []):
        db.insert("sample_edits", {"dataset_id": dataset_id, "sample_id": sid, "ts": time.time(), "field": k,
                                   "before": _field(before, k), "after": edits.get(k)})
    status = "needs_relabel" if "audio_text" in edits and "tool_calls" not in edits else "pending"
    db.update("synth_samples", {"dataset_id": dataset_id, "sample_id": sid}, {"flags": out["flags"], "status": status, "updated": time.time()})
    datasets.invalidate()
    return out


def _field(full: dict, k: str):
    rec = full["record"]
    return {"audio_text": rec.get("audio_text"), "history": rec.get("history"), "tool_calls": (rec.get("label") or {}).get("tool_calls"),
            "state": {a: v for a, v in full["state"].items() if a != "_meta"}, "base_state": full.get("base_state"),
            "context": rec.get("context")}.get(k)


def relabel(dataset_id: str, sids: list[str], model_id: str, rules: str = "rules_v2") -> str:
    ds = datasets.get(dataset_id)
    m = _model_payload(model_id)
    m["rules"] = rules

    def job(ctx: JobCtx, payload):
        for i, sid in enumerate(sids):
            if ctx.should_stop():
                break
            try:
                out = run_ops({"cmd": "relabel", "split": ds["split"], "sid": sid, "model": m})
                for u in out.get("usage", []):
                    ctx.add_cost(u["cost"])
                    models.log_usage(ctx.id, u["model_id"], "llm", u["usage"], u["cost"], False)
                db.update("synth_samples", {"dataset_id": dataset_id, "sample_id": sid}, {"flags": out["flags"], "status": "pending", "updated": time.time()})
            except Exception as e:
                ctx.log(f"{sid}: {e}")
            ctx.progress(i + 1, len(sids))
        datasets.invalidate()
        return {"n": len(sids)}

    return JOBS.start("relabel", job, {"dataset_id": dataset_id, "sids": sids, "model": model_id})


def spot_check(dataset_id: str, rate: float, seed: int = 0) -> int:
    rows = db.all_rows("synth_samples", order="sample_id", dataset_id=dataset_id)
    rng = random.Random(seed)
    n = 0
    for r in rows:
        v = int(rng.random() < rate)
        db.update("synth_samples", {"dataset_id": dataset_id, "sample_id": r["sample_id"]}, {"spot_check": v})
        n += v
    return n


# ---------------- export ----------------
def start_export(name: str, components: list[dict], options: dict) -> str:
    from training.gen_synthetic.export import ExportOptions, export
    from training.gen_synthetic.split import read_records

    opts = ExportOptions(**options)
    vid = db.new_id("ver_")
    out_dir = EXPORTS / f"{vid}_{name.replace(' ', '_')[:40]}"
    comps = []
    for c in components:
        ds = datasets.get(c["dataset_id"])
        b = datasets.base_of(ds)
        if b["split"] == "public_test":
            raise ValueError("không được xuất public_test (luật thi)")
        comps.append({"dataset_id": c["dataset_id"], "root": b["root"], "split": b["split"], "weight": float(c.get("weight", 1.0)),
                      "statuses": c.get("statuses") or ["approved"], "kind": ds["kind"], "sample_ids": ds.get("sample_ids")})

    def source(comp):
        if comp["kind"] == "synthetic" or (comp["kind"] == "subset" and comp["split"].startswith("synth_")):
            ok = {r["sample_id"] for r in db.all_rows("synth_samples", order="sample_id", dataset_id=comp["dataset_id"])
                  if r["status"] in comp["statuses"]}
            recs = [r for r in read_records(Path(comp["root"]) / comp["split"]) if r["id"] in ok]
        else:
            recs = [s.raw for s in datasets.samples(comp["dataset_id"])]
        if comp.get("sample_ids"):
            keep = set(comp["sample_ids"])
            recs = [r for r in recs if r["id"] in keep]
        return recs

    def job(ctx: JobCtx, payload):
        ctx.progress(0, 1)
        stats = export(comps, out_dir, opts, source)
        db.insert("dataset_versions", {"id": vid, "name": name, "components": components, "options": opts.model_dump(),
                                       "export_path": str(out_dir), "stats": stats, "created": time.time()})
        ctx.progress(1, 1)
        return stats

    return JOBS.start("export", job, {"name": name, "components": components, "options": options})


# ---------------- TTS ----------------
def start_tts(dataset_id: str, tts_model: str, voices: dict[str, list[str]], statuses: list[str] | None, augment: dict | None,
              overwrite: bool = False, seed: int = 0) -> str:
    from agent_core.registry import build
    from training.gen_synthetic.audio import AugmentOptions
    from training.gen_synthetic.split import read_records

    ds = datasets.get(dataset_id)
    if ds["kind"] != "synthetic":
        raise ValueError("TTS chỉ áp dụng cho dataset tổng hợp")
    m = _model_payload(tts_model, "tts")
    aug = AugmentOptions(**(augment or {}))

    def job(ctx: JobCtx, payload):
        from training.gen_synthetic.audio import augment as do_aug
        from training.gen_synthetic.audio import decode_wav, write_wav

        tts = build("tts", m["spec"])
        d = DATASETS / ds["split"]
        ok = None
        if statuses:
            ok = {r["sample_id"] for r in db.all_rows("synth_samples", order="sample_id", dataset_id=dataset_id) if r["status"] in statuses}
        recs = [r for r in read_records(d) if ok is None or r["id"] in ok]
        rng = random.Random(seed)
        jobs_list = []
        for r in recs:
            region = (r.get("meta") or {}).get("region", "bac")
            vlist = voices.get(region) or voices.get("default") or ["alloy"]
            voice = rng.choice(vlist)
            for t in r.get("history", []):
                if t.get("role") == "user" and t.get("audio_text"):
                    jobs_list.append((t["audio"], t["audio_text"], voice, region))
            jobs_list.append((r["audio"], r["audio_text"], voice, region))
        ctx.progress(0, len(jobs_list))
        from agent_core.prompts import WEEKDAYS  # noqa: F401
        from training.gen_synthetic.common import REGIONS

        for i, (rel, text, voice, region) in enumerate(jobs_list):
            if ctx.should_stop():
                break
            p = d / rel
            if p.exists() and not overwrite:
                ctx.progress(i + 1)
                continue
            try:
                wav = tts.synthesize(text, voice, rng.uniform(0.95, 1.08), f"Đọc tự nhiên bằng tiếng Việt, {REGIONS.get(region, '')}")
                x = do_aug(decode_wav(wav), aug, rng)
                write_wav(p, x)
                c = models.cost_of({"chars": len(text)}, m["price"])
                ctx.add_cost(c)
                models.log_usage(ctx.id, tts_model, "tts", {"chars": len(text)}, c, False)
            except Exception as e:
                ctx.log(f"{rel}: {e}")
            ctx.progress(i + 1)
        return {"files": len(jobs_list)}

    return JOBS.start("tts", job, {"dataset_id": dataset_id, "model": tts_model})


def tts_preview(tts_model: str, text: str, voice: str, augment: dict | None = None) -> bytes:
    import io
    import wave

    from agent_core.registry import build
    from training.gen_synthetic.audio import AugmentOptions, decode_wav
    from training.gen_synthetic.audio import augment as do_aug

    m = _model_payload(tts_model, "tts")
    wav = build("tts", m["spec"]).synthesize(text, voice)
    x = decode_wav(wav)
    if augment:
        x = do_aug(x, AugmentOptions(**{**augment, "prob": 1.0}), random.Random())
    import numpy as np

    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes((np.clip(x, -1, 1) * 32767).astype(np.int16).tobytes())
    models.log_usage("tts_preview", tts_model, "tts", {"chars": len(text)}, models.cost_of({"chars": len(text)}, m["price"]), False)
    return buf.getvalue()


# ---------------- App Factory ----------------
def app_generate(idea: str, model_id: str) -> str:
    m = _model_payload(model_id)

    def job(ctx: JobCtx, payload):
        from agent_core.registry import build
        from lab.core.cache import MeteredLLM
        from training.gen_synthetic.app_factory import generate_app, validate_app

        def sink(mid, kind, usage, cost, cached):
            ctx.add_cost(cost)
            models.log_usage(ctx.id, mid, kind, usage, cost, cached)

        llm = MeteredLLM(build("llm", m["spec"]), model_id, m["price"], False, sink)
        ctx.progress(0, 2)
        app = generate_app(idea, llm)
        errs = validate_app(app)
        rid = db.new_id("app_")
        report = {"validation": errs}
        if not errs:
            report.update(run_ops({"cmd": "app_test", "app": app}, timeout=120))
        db.insert("gen_apps", {"id": rid, "app_id": app.get("app_id"), "status": "draft", "spec": app,
                               "code": app.get("code"), "example_state": app.get("example_state"), "test_report": report,
                               "notes": idea, "created": time.time(), "updated": time.time()})
        ctx.progress(2, 2)
        return {"gen_app_id": rid, "app_id": app.get("app_id"), "errors": errs + report.get("errors", [])}

    return JOBS.start("app_factory", job, {"idea": idea, "model": model_id})


def app_create(app: dict, notes: str = "") -> dict:
    """Tạo bản nháp app thủ công (không cần LLM), rồi kiểm tra + kiểm thử như khi lưu."""
    rid = db.new_id("app_")
    db.insert("gen_apps", {"id": rid, "app_id": app.get("app_id"), "status": "draft", "spec": app, "code": app.get("code"),
                           "example_state": app.get("example_state"), "test_report": None, "notes": notes,
                           "created": time.time(), "updated": time.time()})
    return {"id": rid, "report": app_save(rid, app)}


def app_save(rid: str, app: dict) -> dict:
    from training.gen_synthetic.app_factory import validate_app

    errs = validate_app(app)
    report = {"validation": errs}
    if not errs:
        report.update(run_ops({"cmd": "app_test", "app": app}, timeout=120))
    db.update("gen_apps", {"id": rid}, {"app_id": app.get("app_id"), "spec": app, "code": app.get("code"),
                                        "example_state": app.get("example_state"), "test_report": report, "updated": time.time()})
    return report


def app_approve(rid: str, approve: bool = True):
    from training.gen_synthetic.app_factory import approve as do_approve
    from training.gen_synthetic.app_factory import unapprove

    r = db.get("gen_apps", id=rid)
    app = r["spec"]
    if approve:
        rep = r.get("test_report") or {}
        if rep.get("validation") or not rep.get("passed"):
            raise ValueError("app chưa qua kiểm thử, không thể duyệt")
        do_approve(app)
        db.update("gen_apps", {"id": rid}, {"status": "approved", "updated": time.time()})
    else:
        unapprove(app["app_id"])
        db.update("gen_apps", {"id": rid}, {"status": "draft", "updated": time.time()})
