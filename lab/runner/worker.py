"""Tiến trình worker: nạp zaic_tools của MỘT split, chạy pipeline cho từng mẫu được giao, chấm điểm và gửi kết quả về.

Mỗi split có package `zaic_tools` riêng cùng tên, nên mỗi run chạy worker trong tiến trình riêng.
"""
from __future__ import annotations

import os
import signal
import time
import traceback


def _ref_texts(s) -> dict:
    out = {t.audio: t.text for t in s.history if t.role == "user" and t.audio and t.text is not None}
    if s.audio and s.audio_text is not None:
        out[s.audio] = s.audio_text
    return out


def worker_main(spec: dict, wid: int, task_q, res_q):
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    os.environ.setdefault("PYTHONHASHSEED", "0")
    from agent_core.data import load_samples, load_zaic_tools
    from agent_core.pipeline import Pipeline, PipelineConfig
    from agent_core.registry import build
    from lab.core.cache import MeteredASR, MeteredLLM
    from lab.scoring.asr_metrics import utterance_metrics
    from lab.scoring.diagnostics import diagnose, scenario_of
    from lab.scoring.official import ScoreOptions, alt_scores, fuzzy_params_from_catalog, score_sample

    root, split = spec["root"], spec["split"]
    try:
        zt = load_zaic_tools(root, split)
        samples = {s.id: s for s in load_samples(root, split)}
        events: list = []
        sink = lambda mid, kind, usage, cost, cached: events.append((mid, kind, usage, cost, cached))  # noqa: E731
        pcfg = PipelineConfig(**spec["pipeline"])
        llm = MeteredLLM(build("llm", pcfg.llm), spec["llm_model"], spec["prices"]["llm"], spec["use_cache"], sink)
        asr = MeteredASR(build("asr", pcfg.asr), spec["asr_model"], spec["prices"]["asr"], spec["use_cache"], sink)
        pipe = Pipeline(pcfg, root, split, llm=llm, asr=asr)
        fuzzy = fuzzy_params_from_catalog(pipe.catalog)
        opts = ScoreOptions(**(spec.get("score") or {}))
        asr_is_gold = (pcfg.asr if isinstance(pcfg.asr, dict) else {"plugin": pcfg.asr}).get("plugin") == "gold"
    except Exception:
        res_q.put({"type": "fatal", "wid": wid, "error": traceback.format_exc()})
        return

    def finalize(s, pred_calls, pred_hash, pred_results, status, err, out, t0):
        gold = (s.label or {}).get("tool_calls") if s.label is not None else None
        summary = {"status": status, "n_calls": len(pred_calls), "latency_s": round(time.time() - t0, 3),
                   "time_asr_s": (out or {}).get("time_asr_s", 0.0), "hist_turns": sum(1 for t in s.history if t.role == "user"),
                   "scenario": scenario_of(gold, pipe.tools),
                   "apps": sorted({c["name"].split(".")[0] for c in (gold or pred_calls) if not c["name"].startswith("sys.")})}
        detail = {"gold": gold, "pred": pred_calls, "pred_results": pred_results, "state_hash": pred_hash, "error": err}
        if gold is not None and spec.get("mode") != "asr_only":
            genv = zt.ToolEnv(split, s.id, root=root)
            for c in gold:
                genv.call(c["name"], c.get("arguments") or {})
            gold_hash = genv.get_state_hash()
            sc = score_sample(pred_calls, pred_hash, gold, gold_hash, fuzzy, opts)
            dg = diagnose(pred_calls, pred_results, gold, sc, pipe.tools, fuzzy, status, opts)
            summary.update(score=sc.score, hash_ok=sc.hash_ok, M=sc.M, U=sc.U, G=sc.G, P=sc.P, R=sc.R, f1_nohash=sc.f1_nohash, tags=dg["tags"],
                           alt=alt_scores(pred_calls, pred_hash, gold, gold_hash, fuzzy, opts))
            detail.update(gold_hash=gold_hash, matches=sc.matches, diff=dg["details"])
        else:
            tags = [status] if status in ("timeout", "llm_error", "crash") else []
            if any(isinstance(r, dict) and r.get("ok") is False for r in pred_results):
                tags.append("rejected_call")
            summary["tags"] = tags
        # ASR
        asr_rows = {}
        if out and not asr_is_gold:
            refs = _ref_texts(s)
            for rel, r in (out.get("asr") or {}).items():
                row = {"hyp": (out.get("transcripts") or {}).get(rel, r.get("text", "")), "raw": r.get("text", ""), "error": r.get("error"),
                       "latency_s": r.get("latency_s", 0), "final": rel == s.audio}
                if rel in refs:
                    row["ref"] = refs[rel]
                    row.update(utterance_metrics(refs[rel], row["hyp"]))
                asr_rows[rel] = row
            if any(r.get("error") for r in asr_rows.values()):
                summary["tags"] = sorted(set(summary.get("tags", [])) | {"asr_error"})
        summary["asr"] = asr_rows or None
        cost = sum(e[3] for e in events)
        summary["cost"] = cost
        summary["tokens_in"] = sum((e[2] or {}).get("input_tokens", 0) for e in events if e[1] == "llm")
        summary["tokens_out"] = sum((e[2] or {}).get("output_tokens", 0) for e in events if e[1] == "llm")
        summary["steps"] = len(((out or {}).get("trace") or {}).get("steps", []))
        summary["usage_events"] = list(events)
        summary["sub"] = {"id": s.id, "tool_calls": pred_calls, "state_hash": pred_hash}
        return {"type": "done", "wid": wid, "sid": s.id, "summary": summary,
                "trace": {"sample_id": s.id, **detail, "transcripts": (out or {}).get("transcripts"), "asr": asr_rows or None,
                          "agent": (out or {}).get("trace")}}

    res_q.put({"type": "ready", "wid": wid})
    while True:
        task = task_q.get()
        if task is None:
            break
        sid = task["sid"]
        s = samples[sid]
        events.clear()
        t0 = time.time()
        env = zt.ToolEnv(split, sid, root=root)
        if task["type"] == "replay":
            for c in task.get("calls", []):
                env.call(c["name"], c.get("arguments") or {})
            res = finalize(s, env.get_tool_calls(), env.get_state_hash(), [x["result"] for x in env.log], task.get("status", "timeout"),
                           task.get("error"), None, t0)
            res["summary"]["latency_s"] = task.get("latency_s", res["summary"]["latency_s"])
            res_q.put(res)
            continue
        res_q.put({"type": "start", "wid": wid, "sid": sid, "t": t0})
        out, err, status = None, None, "done"
        try:
            if spec.get("mode") == "asr_only":
                raw, texts = pipe.transcripts(s)
                out = {"asr": raw, "transcripts": texts, "trace": {"status": "done", "steps": []}, "time_asr_s": round(time.time() - t0, 3)}
                res_q.put(finalize(s, [], env.get_state_hash(), [], "done", None, out, t0))
                continue
            out = pipe.run(s, env, on_call=lambda c, r: res_q.put({"type": "call", "wid": wid, "sid": sid,
                                                                    "call": {"name": c.name, "arguments": c.arguments}}))
            st = out["trace"]["status"]
            status = {"deadline": "timeout", "llm_error": "llm_error", "refusal": "llm_error"}.get(st, "done")
            err = out["trace"].get("error")
        except Exception:
            status, err = "crash", traceback.format_exc()[-3000:]
        res_q.put(finalize(s, env.get_tool_calls(), env.get_state_hash(), [x["result"] for x in env.log], status, err, out, t0))
