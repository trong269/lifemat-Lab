"""Teacher gán nhãn: chạy chính vòng lặp agent của agent_core trên bộ mô phỏng (Session của zaic_tools)."""
from __future__ import annotations

import copy

from agent_core.agent import Deadline
from agent_core.data import sample_from_dict
from agent_core.registry import build

DEFAULT_GUARDS = ["validate_repair", "iso_time", "ask_params_order", "dedupe_reads", "ask_last"]


class Teacher:
    def __init__(self, llm, catalog: dict, rules: str = "rules_v2", renderer: str = "full", max_steps: int = 12,
                 guards: list | None = None, timeout_s: float = 300):
        from agent_core.data import catalog_tools

        self.llm = llm
        self.catalog = catalog
        self.tools = catalog_tools(catalog)
        self.app_names = {a["id"]: a.get("name_vi", a["id"]) for a in catalog.get("apps", [])}
        self.renderer = build("renderer", renderer)
        self.prompt = build("prompt", {"plugin": "rules", "rules": rules})
        self.agent = build("agent", {"plugin": "react", "max_steps": max_steps, "max_calls": 20})
        self.guards = [build("guard", g) for g in (guards or DEFAULT_GUARDS)]
        self.timeout_s = timeout_s

    def label(self, zt, rec: dict, state: dict, utterance: str) -> dict:
        """rec: bản ghi (context + history). state: state các app TRƯỚC lượt này (không có _meta).
        -> {calls, results, text, state_after, final_state, trace}"""
        sample = sample_from_dict({**rec, "audio_text": utterance, "label": None}, "synth")
        entry = {"_meta": {"question_id": rec["id"], "current_time": rec["context"]["current_time"], "tools": sample.allowed_tools()},
                 **copy.deepcopy(state)}
        env = zt.Session(rec["id"], entry, self.catalog)
        before = copy.deepcopy(env.get_state())
        specs = self.renderer.render(self.tools, sample.allowed_tools())
        system = self.prompt.system(sample, self.app_names)
        msgs = self.prompt.messages(sample, None, utterance)
        trace = self.agent.run(sample, env, self.llm, system, msgs, specs, self.tools, self.guards, Deadline(self.timeout_s))
        after = env.get_state()
        text = next((s["text"] for s in reversed(trace["steps"]) if s.get("text")), "")
        return {"calls": env.get_tool_calls(), "results": [x["result"] for x in env.log], "text": text or "Đã xong.",
                "state_after": after, "final_state": {a: st for a, st in after.items() if st != before.get(a)},
                "status": trace["status"], "error": trace.get("error"), "state_hash": env.get_state_hash()}


def replay(zt, rec_id: str, current_time: str, allowed: list[str], state: dict, calls: list[dict], catalog: dict) -> dict:
    entry = {"_meta": {"question_id": rec_id, "current_time": current_time, "tools": allowed}, **copy.deepcopy(state)}
    env = zt.Session(rec_id, entry, catalog)
    before = copy.deepcopy(env.get_state())
    results = [env.call(c["name"], c.get("arguments") or {}) for c in calls]
    after = env.get_state()
    return {"results": results, "state_after": after, "final_state": {a: st for a, st in after.items() if st != before.get(a)},
            "state_hash": env.get_state_hash()}
