"""Tổng hợp chỉ số của một run từ các dòng run_samples."""
from __future__ import annotations

from collections import Counter, defaultdict


def _pct(xs: list[float], q: float) -> float:
    if not xs:
        return 0.0
    xs = sorted(xs)
    k = min(len(xs) - 1, max(0, int(round(q * (len(xs) - 1)))))
    return xs[k]


def _bucket_hist(n: int) -> str:
    return "0" if n == 0 else "1-2" if n <= 2 else "3-5" if n <= 5 else "6+"


def _group(rows, keyf):
    g = defaultdict(list)
    for r in rows:
        for k in keyf(r):
            g[k].append(r)
    out = {}
    for k, rs in g.items():
        sc = [r["score"] for r in rs if r["score"] is not None]
        out[k] = {"n": len(rs), "score": round(100 * sum(sc) / len(sc), 2) if sc else None,
                  "hash_ok": round(100 * sum(1 for r in rs if r["hash_ok"]) / len(rs), 1) if sc else None}
    return dict(sorted(out.items(), key=lambda kv: -kv[1]["n"]))


def aggregate(rows: list[dict]) -> dict:
    n = len(rows)
    if not n:
        return {"n": 0}
    scored = [r for r in rows if r.get("score") is not None]
    lat = [r["latency_s"] or 0 for r in rows]
    m = {"n": n, "n_scored": len(scored), "status": dict(Counter(r["status"] for r in rows)),
         "latency_p50": round(_pct(lat, 0.5), 2), "latency_p95": round(_pct(lat, 0.95), 2), "latency_max": round(max(lat), 2),
         "over_30s": sum(1 for x in lat if x > 30),
         "time_asr_mean": round(sum(r["time_asr_s"] or 0 for r in rows) / n, 3),
         "cost": round(sum(r["cost"] or 0 for r in rows), 4), "tokens_in": sum(r["tokens_in"] or 0 for r in rows),
         "tokens_out": sum(r["tokens_out"] or 0 for r in rows), "calls_mean": round(sum(r["n_calls"] or 0 for r in rows) / n, 2),
         "steps_mean": round(sum(r["steps"] or 0 for r in rows) / n, 2)}
    if scored:
        k = len(scored)
        m.update(score=round(100 * sum(r["score"] for r in scored) / k, 3),
                 hash_ok=round(100 * sum(1 for r in scored if r["hash_ok"]) / k, 2),
                 P=round(sum(r["P"] or 0 for r in scored) / k, 4), R=round(sum(r["R"] or 0 for r in scored) / k, 4),
                 f1_nohash=round(100 * sum(r["f1_nohash"] or 0 for r in scored) / k, 3),
                 perfect=sum(1 for r in scored if r["score"] >= 0.999))
        alts = [r.get("alt") for r in scored if r.get("alt")]
        if alts and len(alts) == k:
            m["alt_scores"] = {name: round(100 * sum(a[name] for a in alts) / k, 3) for name in alts[0]}
        m["by_scenario"] = _group(scored, lambda r: [r["scenario"] or "?"])
        m["by_app"] = _group(scored, lambda r: r["apps"] or ["(không app)"])
        m["by_history"] = _group(scored, lambda r: [_bucket_hist(r["hist_turns"] or 0)])
        m["by_new_app"] = _group(scored, lambda r: ["app mới" if r.get("new_app") else "app đã thấy"])
    m["tags"] = dict(Counter(t for r in rows for t in (r["tags"] or [])).most_common())
    # ASR
    we = wn = ce = cn = eh = en = ex = nu = 0
    we_f = wn_f = 0
    for r in rows:
        for a in (r.get("asr") or {}).values():
            if "w_n" in a:
                we += a["w_err"]
                wn += a["w_n"]
                ce += a["c_err"]
                cn += a["c_n"]
                eh += a["e_hit"]
                en += a["e_n"]
                ex += int(a["exact"])
                nu += 1
                if a.get("final"):
                    we_f += a["w_err"]
                    wn_f += a["w_n"]
    if nu:
        m["asr"] = {"utterances": nu, "wer": round(100 * we / max(wn, 1), 2), "cer": round(100 * ce / max(cn, 1), 2),
                    "wer_final": round(100 * we_f / max(wn_f, 1), 2), "entity_recall": round(100 * eh / max(en, 1), 2),
                    "exact": round(100 * ex / nu, 2)}
    return m
