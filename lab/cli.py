"""CLI của platform.

    lab serve [--port 8765]                 chạy API + UI
    lab run config.yaml [--limit N]         chạy một thử nghiệm, in điểm
    lab keys set anthropic sk-...           lưu khoá API cho nhà cung cấp
    lab models                              liệt kê model trong registry
    lab datasets                            liệt kê dataset
"""
from __future__ import annotations

import argparse
import json
import sys
import time


def _init():
    from lab.core import datasets, db, models

    db.conn()
    models.seed()
    datasets.scan()


def cmd_serve(a):
    import uvicorn

    uvicorn.run("lab.api.app:app", host=a.host, port=a.port, reload=False, log_level="info")


def cmd_run(a):
    import yaml

    from lab.core import db
    from lab.core.experiments import ExperimentConfig
    from lab.runner.manager import RUNNER

    _init()
    cfg = yaml.safe_load(open(a.config, encoding="utf-8"))
    if a.limit:
        cfg["limit"] = a.limit
    if a.workers:
        cfg["workers"] = a.workers
    rid = RUNNER.start(ExperimentConfig(**cfg))
    h = RUNNER.handles[rid]
    seq = 0
    while h.thread.is_alive():
        time.sleep(1)
        for e in h.since(seq):
            seq = e["seq"]
            if e["type"] == "sample":
                print(f"\r{e['done']} mẫu  chi phí ${e['cost']}", end="", flush=True)
            elif e["type"] == "log":
                print("\n" + e["msg"])
    r = db.get("runs", id=rid)
    print()
    m = r["metrics"] or {}
    print(json.dumps({"run": rid, "status": r["status"], **{k: m.get(k) for k in ("n", "score", "hash_ok", "f1_nohash", "latency_p95", "cost", "tags", "asr")}},
                     ensure_ascii=False, indent=1))
    if r.get("error"):
        print(r["error"], file=sys.stderr)


def cmd_keys(a):
    from lab.core import models

    _init()
    models.set_secret(a.provider, a.key)
    print(a.provider, models.key_status(a.provider))


def cmd_models(a):
    from lab.core import db, models

    _init()
    for m in db.all_rows("models", order="role, id"):
        print(f"{m['role']:4s} {m['id']:30s} {m['provider_id']:12s} {(m.get('config') or {}).get('model', ''):30s} {models.check_model_ready(m['id']) or 'sẵn sàng'}")


def cmd_datasets(a):
    from lab.core import datasets, db

    _init()
    for d in db.all_rows("datasets", order="kind, created"):
        print(f"{d['kind']:10s} {d['id']:30s} {len(datasets.samples(d['id'])):6d} mẫu  {d['name']}")


def cmd_rescore(a):
    from lab.core import db
    from lab.scoring.rescore import rescore

    _init()
    ids = a.runs or [r["id"] for r in db.query("SELECT id FROM runs WHERE status NOT IN ('running','queued') ORDER BY created")]
    for rid in ids:
        out = rescore(rid)
        print(f"{rid}: {out['old_score']} -> {out['new_score']} ({out['samples_changed']} mẫu đổi ghép cặp)")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="lab")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8765)
    s.set_defaults(fn=cmd_serve)
    s = sub.add_parser("run")
    s.add_argument("config")
    s.add_argument("--limit", type=int, default=0)
    s.add_argument("--workers", type=int, default=0)
    s.set_defaults(fn=cmd_run)
    s = sub.add_parser("keys")
    s.add_argument("action", choices=["set"])
    s.add_argument("provider")
    s.add_argument("key")
    s.set_defaults(fn=cmd_keys)
    s = sub.add_parser("rescore", help="chấm lại run từ trace (mặc định: mọi run)")
    s.add_argument("runs", nargs="*")
    s.set_defaults(fn=cmd_rescore)
    sub.add_parser("models").set_defaults(fn=cmd_models)
    sub.add_parser("datasets").set_defaults(fn=cmd_datasets)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
