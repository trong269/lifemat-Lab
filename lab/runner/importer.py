"""Chấm một file dự đoán LLM (dạng submission: {id, tool_calls, state_hash}) do người khác chạy và gửi.

Chạy trong tiến trình con (cần zaic_tools của split): replay tool_calls trên ToolEnv mới như BTC làm, tính state_hash,
chấm với nhãn (nếu split có nhãn). state_hash trong file chỉ để đối chiếu — điểm dùng hash do replay tính (giống BTC).
"""
from __future__ import annotations

import traceback


def import_main(root: str, split: str, sample_ids: list[str], preds: dict, score_opts: dict) -> list[dict]:
    from agent_core.data import load_samples, load_zaic_tools
    from lab.scoring.diagnostics import diagnose, scenario_of
    from lab.scoring.official import ScoreOptions, alt_scores, fuzzy_params_from_catalog, score_sample

    zt = load_zaic_tools(root, split)
    samples = {s.id: s for s in load_samples(root, split)}
    import json
    from pathlib import Path

    catalog = json.loads((Path(root) / split / f"{split}_tools_catalog.json").read_text(encoding="utf-8"))
    tools = {t["name"]: t for a in catalog["apps"] for t in a["tools"]}
    fz = fuzzy_params_from_catalog(catalog)
    opts = ScoreOptions(**(score_opts or {}))
    out = []
    for sid in sample_ids:
        s = samples[sid]
        p = preds.get(sid)
        tags, err = [], None
        try:
            calls = [{"name": c.get("name"), "arguments": c.get("arguments") or {}} for c in (p or {}).get("tool_calls") or []]
            env = zt.ToolEnv(split, sid, root=root)
            for c in calls:
                env.call(c["name"], c["arguments"])
            pred_calls, pred_hash = env.get_tool_calls(), env.get_state_hash()
            results = [x["result"] for x in env.log]
        except Exception:
            calls, pred_calls, pred_hash, results = [], [], None, []
            err = traceback.format_exc()[-1500:]
            tags.append("crash")
        if p is None:
            tags.append("missing_line")
        elif p.get("state_hash") and pred_hash and p["state_hash"] != pred_hash:
            tags.append("hash_replay_mismatch")
        if any(isinstance(r, dict) and r.get("ok") is False for r in results):
            tags.append("rejected_call")
        gold = (s.label or {}).get("tool_calls") if s.label is not None else None
        summary = {"status": "done" if p is not None else "missing", "n_calls": len(pred_calls), "latency_s": p.get("latency_s") if p else None,
                   "time_asr_s": None, "hist_turns": sum(1 for t in s.history if t.role == "user"), "scenario": scenario_of(gold, tools),
                   "apps": sorted({c["name"].split(".")[0] for c in (gold or pred_calls) if c.get("name") and not c["name"].startswith("sys.")}),
                   "cost": 0.0, "tokens_in": 0, "tokens_out": 0, "steps": 0, "asr": None,
                   "sub": {"id": sid, "tool_calls": pred_calls, "state_hash": pred_hash}}
        trace = {"sample_id": sid, "gold": gold, "pred": pred_calls, "pred_results": results, "state_hash": pred_hash,
                 "submitted_state_hash": (p or {}).get("state_hash"), "error": err, "agent": None, "imported": True,
                 "transcripts": {s.audio: p["asr_text"]} if p and isinstance(p.get("asr_text"), str) and s.audio else None, "asr": None}
        if gold is not None:
            genv = zt.ToolEnv(split, sid, root=root)
            for c in gold:
                genv.call(c["name"], c.get("arguments") or {})
            gold_hash = genv.get_state_hash()
            sc = score_sample(pred_calls, pred_hash, gold, gold_hash, fz, opts)
            dg = diagnose(pred_calls, results, gold, sc, tools, fz, "done", opts)
            summary.update(score=sc.score, hash_ok=sc.hash_ok, M=sc.M, U=sc.U, G=sc.G, P=sc.P, R=sc.R, f1_nohash=sc.f1_nohash,
                           tags=sorted(set(dg["tags"]) | set(tags)), alt=alt_scores(pred_calls, pred_hash, gold, gold_hash, fz, opts))
            trace.update(gold_hash=gold_hash, matches=sc.matches, diff=dg["details"])
        else:
            summary["tags"] = tags
        out.append({"sid": sid, "summary": summary, "trace": trace})
    return out
