"""Job nền (sinh dữ liệu, xuất, TTS, App Factory...). Mỗi job chạy trong một thread; việc cần zaic_tools thì job tự mở tiến trình con."""
from __future__ import annotations

import threading
import time
import traceback

from . import db


class JobCtx:
    def __init__(self, job_id: str, budget: float | None):
        self.id = job_id
        self.budget = budget
        self.cancelled = False
        self.cost = 0.0
        self._log: list[str] = []
        self._last = 0.0

    def progress(self, done: int, total: int | None = None):
        vals = {"progress": done, "updated": time.time(), "cost": self.cost}
        if total is not None:
            vals["total"] = total
        db.update("jobs", {"id": self.id}, vals)

    def log(self, msg: str):
        self._log.append(f"{time.strftime('%H:%M:%S')} {msg}")
        self._log = self._log[-300:]
        if time.time() - self._last > 1:
            self.flush()

    def flush(self):
        self._last = time.time()
        db.update("jobs", {"id": self.id}, {"log": self._log, "cost": self.cost, "updated": time.time()})

    def add_cost(self, c: float):
        self.cost += c or 0.0

    def over_budget(self) -> bool:
        return bool(self.budget) and self.cost >= self.budget

    def should_stop(self) -> bool:
        if not self.cancelled:
            j = db.get("jobs", id=self.id)
            self.cancelled = bool(j and j["status"] == "cancelling")
        return self.cancelled or self.over_budget()


class JobManager:
    def __init__(self):
        self.ctx: dict[str, JobCtx] = {}

    def start(self, kind: str, fn, payload: dict, budget: float | None = None) -> str:
        job_id = db.new_id("job_")
        db.insert("jobs", {"id": job_id, "kind": kind, "status": "running", "progress": 0, "total": 0, "payload": payload,
                           "budget": budget, "created": time.time(), "updated": time.time(), "log": []})
        ctx = JobCtx(job_id, budget)
        self.ctx[job_id] = ctx

        def run():
            try:
                result = fn(ctx, payload)
                status = "cancelled" if ctx.cancelled else "stopped_budget" if ctx.over_budget() else "done"
                ctx.flush()
                db.update("jobs", {"id": job_id}, {"status": status, "result": result, "updated": time.time(), "cost": ctx.cost})
            except Exception as e:
                ctx.log(f"LỖI: {e}")
                ctx.flush()
                db.update("jobs", {"id": job_id}, {"status": "error", "error": traceback.format_exc()[-4000:], "updated": time.time(),
                                                   "cost": ctx.cost})

        threading.Thread(target=run, daemon=True).start()
        return job_id

    def cancel(self, job_id: str):
        db.update("jobs", {"id": job_id}, {"status": "cancelling"})
        if job_id in self.ctx:
            self.ctx[job_id].cancelled = True


JOBS = JobManager()
