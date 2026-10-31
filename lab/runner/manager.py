"""Quản lý run: chia mẫu cho các worker, watchdog timeout, lưu kết quả, tạm dừng / tiếp tục / huỷ, hạn mức chi phí."""
from __future__ import annotations

import json
import multiprocessing as mp
import threading
import time
import traceback
from collections import deque
from pathlib import Path

from lab.core import datasets, db, models
from lab.core.experiments import ExperimentConfig, redact, resolve
from lab.core.paths import RUNS
from lab.scoring.aggregate import aggregate

from .worker import worker_main

RS_COLS = ["status", "score", "hash_ok", "M", "U", "G", "P", "R", "f1_nohash", "tags", "scenario", "apps", "hist_turns", "n_calls",
           "latency_s", "time_asr_s", "cost", "tokens_in", "tokens_out", "steps", "asr", "sub", "alt"]


class RunHandle:
    def __init__(self, run_id: str, cfg: ExperimentConfig):
        self.run_id, self.cfg = run_id, cfg
        self.paused = False
        self.cancelled = False
        self.events: list[dict] = []
        self.seq = 0
        self.lock = threading.Lock()
        self.thread: threading.Thread | None = None
        self.status = "queued"

    def emit(self, ev: dict):
        with self.lock:
            self.seq += 1
            ev["seq"] = self.seq
            self.events.append(ev)
            if len(self.events) > 2000:
                self.events = self.events[-1000:]

    def since(self, seq: int) -> list[dict]:
        with self.lock:
            return [e for e in self.events if e["seq"] > seq]


class Runner:
    def __init__(self):
        self.handles: dict[str, RunHandle] = {}

    # ---------- public ----------
    def start(self, cfg: ExperimentConfig, experiment_id: str | None = None, name: str | None = None, run_id: str | None = None) -> str:
        spec = resolve(cfg)                         # kiểm tra model/khoá trước khi tạo run
        resume = run_id is not None
        run_id = run_id or db.new_id("run_")
        if not resume:
            db.insert("runs", {"id": run_id, "experiment_id": experiment_id, "name": name or cfg.name, "dataset_id": cfg.dataset,
                               "config": cfg.model_dump(), "status": "queued", "total": len(spec["sample_ids"]), "done": 0,
                               "created": time.time(), "kind": "agent"})
        h = RunHandle(run_id, cfg)
        self.handles[run_id] = h
        h.thread = threading.Thread(target=self._run, args=(h, spec), daemon=True)
        h.thread.start()
        return run_id

    def resume(self, run_id: str) -> str:
        r = db.get("runs", id=run_id)
        if not r:
            raise KeyError(run_id)
        h = self.handles.get(run_id)
        if h and h.thread and h.thread.is_alive():
            h.paused = False
            db.update("runs", {"id": run_id}, {"status": "running"})
            h.emit({"type": "status", "status": "running"})
            return run_id
        return self.start(ExperimentConfig(**r["config"]), r["experiment_id"], r["name"], run_id=run_id)

    def pause(self, run_id: str):
        h = self.handles.get(run_id)
        if not h or not (h.thread and h.thread.is_alive()):
            raise ValueError("run không đang chạy")
        h.paused = True
        db.update("runs", {"id": run_id}, {"status": "paused"})
        h.emit({"type": "status", "status": "paused"})

    def cancel(self, run_id: str):
        h = self.handles.get(run_id)
        if h:
            h.cancelled = True
        else:
            db.update("runs", {"id": run_id}, {"status": "cancelled"})

    def is_active(self, run_id: str) -> bool:
        h = self.handles.get(run_id)
        return bool(h and h.thread and h.thread.is_alive())

    # ---------- internal ----------
    def _run(self, h: RunHandle, spec: dict):
        run_id = h.run_id
        rdir = RUNS / run_id
        rdir.mkdir(parents=True, exist_ok=True)
        (rdir / "config.json").write_text(json.dumps({"experiment": h.cfg.model_dump(), "resolved": redact(spec)}, ensure_ascii=False, indent=1))
        done_ids = {r["sample_id"] for r in db.query("SELECT sample_id FROM run_samples WHERE run_id=?", (run_id,))}
        order = {sid: i for i, sid in enumerate(spec["sample_ids"])}
        pending = deque(sid for sid in spec["sample_ids"] if sid not in done_ids)
        cost = sum(r["cost"] or 0 for r in db.query("SELECT cost FROM run_samples WHERE run_id=?", (run_id,)))
        train_apps = datasets._train_apps()
        db.update("runs", {"id": run_id}, {"status": "running", "started": time.time(), "error": None})
        h.status = "running"
        h.emit({"type": "status", "status": "running"})
        ctx = mp.get_context("spawn")
        res_q = ctx.Queue()
        n_workers = max(1, min(spec["workers"], len(pending) or 1))
        procs: dict[int, tuple] = {}
        current: dict[int, dict] = {}
        idle: set[int] = set()
        replay_for: dict[int, dict] = {}
        next_wid = [0]
        timeout = spec["timeout_s"]
        grace = max(10.0, 0.5 * timeout)
        stop_reason = None
        failures = 0
        trace_f = open(rdir / "traces.jsonl", "a", encoding="utf-8")

        def spawn():
            wid = next_wid[0]
            next_wid[0] += 1
            tq = ctx.Queue()
            p = ctx.Process(target=worker_main, args=(spec, wid, tq, res_q), daemon=True)
            p.start()
            procs[wid] = (p, tq)
            return wid

        def kill(wid):
            p, _ = procs.pop(wid)
            p.terminate()
            p.join(timeout=5)
            idle.discard(wid)

        def store(res):
            nonlocal cost
            sid = res["sid"]
            s = res["summary"]
            off = trace_f.tell()
            trace_f.write(json.dumps(res["trace"], ensure_ascii=False, default=str) + "\n")
            trace_f.flush()
            row = {"run_id": run_id, "sample_id": sid, "idx": order.get(sid, 0), "trace_offset": off,
                   "new_app": int(bool(train_apps) and any(a not in train_apps for a in s.get("apps") or []))}
            row.update({k: s.get(k) for k in RS_COLS})
            db.insert("run_samples", row, replace=True)
            for mid, kind, usage, c, cached in s.get("usage_events", []):
                models.log_usage(run_id, mid, kind, usage, c, cached)
            cost += s.get("cost") or 0
            done = db.query("SELECT COUNT(*) AS n FROM run_samples WHERE run_id=?", (run_id,))[0]["n"]
            db.update("runs", {"id": run_id}, {"done": done, "cost": cost})
            h.emit({"type": "sample", "sid": sid, "score": s.get("score"), "status": s["status"], "tags": s.get("tags"),
                    "latency_s": s.get("latency_s"), "done": done, "cost": round(cost, 4)})

        try:
            for _ in range(n_workers):
                spawn()
            while True:
                if h.cancelled:
                    stop_reason = "cancelled"
                    break
                budget = spec.get("budget_usd")
                if budget and cost >= budget and not stop_reason:
                    stop_reason = "stopped_budget"
                    pending.clear()
                if not pending and not current and not replay_for:
                    break
                # dispatch
                for wid in list(idle):
                    if wid in replay_for:
                        procs[wid][1].put(replay_for.pop(wid))
                        idle.discard(wid)
                    elif pending and not h.paused:
                        sid = pending.popleft()
                        procs[wid][1].put({"type": "run", "sid": sid})
                        current[wid] = {"sid": sid, "t": time.time(), "calls": []}
                        idle.discard(wid)
                try:
                    msg = res_q.get(timeout=0.3)
                except Exception:
                    msg = None
                if msg:
                    t, wid = msg["type"], msg.get("wid")
                    if t == "ready":
                        idle.add(wid)
                    elif t == "fatal":
                        raise RuntimeError("worker không khởi động được:\n" + msg["error"])
                    elif t == "start" and wid in current:
                        current[wid]["t"] = msg["t"]
                    elif t == "call" and wid in current:
                        current[wid]["calls"].append(msg["call"])
                    elif t == "done":
                        current.pop(wid, None)
                        if wid in procs:
                            idle.add(wid)
                        store(msg)
                # watchdog
                now = time.time()
                for wid, (p, _) in list(procs.items()):
                    if wid not in current and not p.is_alive():
                        procs.pop(wid)
                        idle.discard(wid)
                        failures += 1
                        if failures > 3 * n_workers:
                            raise RuntimeError("worker liên tục chết khi khởi động; xem log của tiến trình")
                        nw = spawn()
                        if wid in replay_for:
                            replay_for[nw] = replay_for.pop(wid)
                for wid, cur in list(current.items()):
                    p, _ = procs.get(wid, (None, None))
                    dead = p is None or not p.is_alive()
                    if dead or now - cur["t"] > timeout + grace:
                        if not dead:
                            kill(wid)
                        else:
                            procs.pop(wid, None)
                        current.pop(wid)
                        nw = spawn()
                        replay_for[nw] = {"type": "replay", "sid": cur["sid"], "calls": cur["calls"],
                                          "status": "crash" if dead else "timeout", "latency_s": round(now - cur["t"], 2),
                                          "error": "worker chết" if dead else f"quá {timeout + grace:.0f}s, đã dừng cưỡng bức"}
                        h.emit({"type": "log", "msg": f"{cur['sid']}: {'worker chết' if dead else 'quá thời gian'}"})
        except Exception as e:
            stop_reason = "error"
            db.update("runs", {"id": run_id}, {"error": f"{e}\n{traceback.format_exc()[-2000:]}"})
            h.emit({"type": "log", "msg": str(e)[:500]})
        finally:
            for wid, (p, tq) in list(procs.items()):
                try:
                    tq.put(None)
                except Exception:
                    pass
            for wid, (p, tq) in list(procs.items()):
                p.join(timeout=3)
                if p.is_alive():
                    p.terminate()
            trace_f.close()
        self.finalize(run_id, stop_reason or "done")
        h.status = stop_reason or "done"
        h.emit({"type": "status", "status": h.status})

    def finalize(self, run_id: str, status: str = "done"):
        rows = db.query("SELECT * FROM run_samples WHERE run_id=? ORDER BY idx", (run_id,))
        m = aggregate(rows)
        rdir = RUNS / run_id
        rdir.mkdir(parents=True, exist_ok=True)
        with open(rdir / "submission.jsonl", "w", encoding="utf-8") as f:
            for r in rows:
                if r.get("sub"):
                    f.write(json.dumps(r["sub"], ensure_ascii=False) + "\n")
        (rdir / "metrics.json").write_text(json.dumps(m, ensure_ascii=False, indent=1))
        db.update("runs", {"id": run_id}, {"status": status, "metrics": m, "score": m.get("score"), "finished": time.time(),
                                           "done": len(rows), "cost": m.get("cost", 0)})


def read_trace(run_id: str, sample_id: str) -> dict | None:
    r = db.query("SELECT trace_offset FROM run_samples WHERE run_id=? AND sample_id=?", (run_id, sample_id))
    if not r:
        return None
    with open(Path(RUNS) / run_id / "traces.jsonl", encoding="utf-8") as f:
        f.seek(r[0]["trace_offset"])
        return json.loads(f.readline())


RUNNER = Runner()
