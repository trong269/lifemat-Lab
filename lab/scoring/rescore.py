"""Chấm lại một run từ trace đã lưu (không gọi lại model): dùng khi đổi tuỳ chọn scorer."""
from __future__ import annotations

import json
import os
from pathlib import Path

from agent_core.data import load_catalog
from lab.core import datasets, db
from lab.core.paths import RUNS

from .aggregate import aggregate
from .diagnostics import diagnose
from .asr_metrics import utterance_metrics
from .official import ScoreOptions, alt_scores, fuzzy_params_from_catalog, score_sample


def rescore(run_id: str, score_opts: dict | None = None) -> dict:
    r = db.get("runs", id=run_id)
    if not r:
        raise KeyError(run_id)
    cfg = r["config"] or {}
    opts_d = {**(cfg.get("score") or {}), **(score_opts or {})}
    opts = ScoreOptions(**opts_d)
    b = datasets.base_of(datasets.get(r["dataset_id"]))
    cat = load_catalog(b["root"], b["split"])
    tools = {t["name"]: t for a in cat["apps"] for t in a["tools"]}
    fz = fuzzy_params_from_catalog(cat)
    src = RUNS / run_id / "traces.jsonl"
    tmp = src.with_suffix(".rescore.tmp")
    changed = 0
    rows = {x["sample_id"]: x for x in db.query("SELECT sample_id, status, tags FROM run_samples WHERE run_id=?", (run_id,))}
    with open(src, encoding="utf-8") as fin, open(tmp, "w", encoding="utf-8") as fout:
        for line in fin:
            t = json.loads(line)
            off = fout.tell()
            vals = {"trace_offset": off}
            gold = t.get("gold")
            if gold is not None and t.get("gold_hash") is not None:
                sc = score_sample(t["pred"], t["state_hash"], gold, t["gold_hash"], fz, opts)
                status = (rows.get(t["sample_id"]) or {}).get("status") or "done"
                dg = diagnose(t["pred"], t.get("pred_results") or [], gold, sc, tools, fz, status, opts)
                old = t.get("matches")
                t["matches"], t["diff"] = sc.matches, dg["details"]
                vals.update(alt=alt_scores(t["pred"], t["state_hash"], gold, t["gold_hash"], fz, opts), score=sc.score, hash_ok=int(sc.hash_ok), M=sc.M, U=sc.U, G=sc.G, P=sc.P, R=sc.R, f1_nohash=sc.f1_nohash,
                            tags=sorted(set(dg["tags"]) | ({"asr_error"} & set((rows.get(t["sample_id"]) or {}).get("tags") or []))))
                changed += [list(x) for x in (old or [])] != [list(x) for x in sc.matches]
            asr = t.get("asr")
            if asr:                                    # tính lại WER theo bộ chuẩn hoá hiện tại
                for a in asr.values():
                    if isinstance(a, dict) and a.get("ref") is not None:
                        a.update(utterance_metrics(a["ref"], a.get("hyp") or ""))
                vals["asr"] = asr
            fout.write(json.dumps(t, ensure_ascii=False, default=str) + "\n")
            db.update("run_samples", {"run_id": run_id, "sample_id": t["sample_id"]}, vals)
    os.replace(tmp, src)
    rows = db.query("SELECT * FROM run_samples WHERE run_id=? ORDER BY idx", (run_id,))
    m = aggregate(rows)
    old_score = r["score"]
    cfg["score"] = {**(cfg.get("score") or {}), **opts_d}
    db.update("runs", {"id": run_id}, {"metrics": m, "score": m.get("score"), "config": cfg})
    (Path(RUNS) / run_id / "metrics.json").write_text(json.dumps(m, ensure_ascii=False, indent=1))
    return {"run_id": run_id, "old_score": old_score, "new_score": m.get("score"), "samples_changed": changed, "options": opts.__dict__}
