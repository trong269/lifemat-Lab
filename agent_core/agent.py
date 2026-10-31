"""Vòng lặp agent ReAct: LLM đề xuất tool call -> guard -> env -> trả kết quả -> lặp tới khi LLM dừng."""
from __future__ import annotations

import json
import time

from pydantic import BaseModel, Field

from .guards import AgentState, Guard, GuardDecision
from .llm.base import LLMBackend, LLMError
from .registry import register
from .render import SEP
from .types import Sample, ToolCall, ToolSpec


class Deadline:
    def __init__(self, seconds: float | None):
        self.t_end = time.time() + seconds if seconds else None

    def left(self) -> float:
        return float("inf") if self.t_end is None else self.t_end - time.time()


class ReactConfig(BaseModel):
    max_steps: int = Field(10, description="Số lần gọi LLM tối đa cho một mẫu")
    max_calls: int = Field(16, description="Số tool call tối đa được gửi tới env")
    min_time_left_s: float = Field(2.0, description="Không gọi LLM nữa nếu thời gian còn lại ít hơn")
    single_tool_call: bool = Field(True, description="Mỗi bước chỉ thực thi 1 tool call (call đầu tiên); các call song song còn lại bị bỏ, "
                                                     "model tự gọi lại ở bước sau khi đã thấy kết quả")


def _orig_name(name: str, nmap: dict[str, str]) -> str:
    if name in nmap:
        return nmap[name]
    return name.replace(SEP, ".", 1) if SEP in name else name


@register("agent", "react", ReactConfig, "ReAct từng bước: LLM gọi tool, đọc kết quả, quyết định bước tiếp")
class ReactAgent:
    def __init__(self, cfg: ReactConfig):
        self.cfg = cfg

    def run(self, sample: Sample, env, llm: LLMBackend, system: str, messages: list[dict], tools: list[ToolSpec],
            catalog_tools: dict[str, dict], guards: list[Guard], deadline: Deadline, on_call=None) -> dict:
        nmap = {t.api_name: t.name for t in tools}
        st = AgentState(sample=sample, env=env, tools=catalog_tools)
        msgs = list(messages)
        trace = {"system": system, "tools": [t.api_name for t in tools], "messages_init": messages, "steps": [], "status": "done", "error": None}
        n_env = 0
        for i in range(self.cfg.max_steps):
            if deadline.left() < self.cfg.min_time_left_s:
                trace["status"] = "deadline"
                break
            try:
                resp = llm.step(system, msgs, tools, {"sample": sample, "single_tool_call": self.cfg.single_tool_call})
            except LLMError as e:
                trace["status"], trace["error"] = "llm_error", str(e)
                break
            step = {"i": i, "latency_s": round(resp.latency_s, 3), "usage": resp.usage, "cached": resp.cached, "text": resp.text,
                    "stop_reason": resp.stop_reason, "tool_calls": [], "actions": [], "cost": getattr(resp, "cost", 0.0)}
            trace["steps"].append(step)
            if resp.error == "refusal":
                trace["status"], trace["error"] = "refusal", "model từ chối"
                break
            if not resp.tool_calls:
                break
            calls = [ToolCall(name=_orig_name(c.name, nmap), arguments=c.arguments, id=c.id or f"s{i}_{j}") for j, c in enumerate(resp.tool_calls)]
            step["tool_calls"] = [{"id": c.id, "name": c.name, "arguments": c.arguments} for c in calls]
            if self.cfg.single_tool_call and len(calls) > 1:
                # bỏ các call song song: không đưa vào hội thoại, không gọi env
                step["dropped_calls"] = step["tool_calls"][1:]
                calls = calls[:1]
                if resp.raw:      # khối gốc (thinking) chứa cả các call bị bỏ -> không gửi lại khối gốc
                    resp.raw = None
            amsg = {"role": "assistant", "content": resp.text, "tool_calls": [{"id": c.id, "name": c.name, "arguments": c.arguments} for c in calls]}
            if resp.raw:
                amsg["_raw"] = resp.raw
            msgs.append(amsg)
            for c in calls:
                act = {"call": {"name": c.name, "arguments": c.arguments}, "guard": "allow", "note": "", "executed": False, "result": None}
                if st.stop:
                    out = {"ok": False, "executed": False, "error": "đã kết thúc lượt"}
                    act["guard"] = "reject"
                else:
                    dec = GuardDecision()
                    for g in guards:
                        dec = g.before(c, st)
                        if dec.action == "rewrite":
                            c = ToolCall(name=c.name, arguments=dec.arguments, id=c.id)
                            act["note"] = (act["note"] + "; " + dec.note).strip("; ")
                            act["guard"] = "rewrite"
                            continue
                        if dec.action != "allow":
                            break
                    if dec.action == "reject":
                        out = dec.feedback or {"ok": False, "executed": False}
                        act["guard"], act["note"] = "reject", dec.note or json.dumps(out, ensure_ascii=False)[:200]
                    elif dec.action == "skip":
                        out = dec.result
                        act["guard"], act["note"] = "skip", dec.note
                    elif n_env >= self.cfg.max_calls:
                        out = {"ok": False, "executed": False, "error": "vượt số call tối đa"}
                        act["guard"] = "reject"
                        st.stop = True
                    else:
                        out = env.call(c.name, c.arguments)
                        n_env += 1
                        act["executed"] = True
                        act["call"] = {"name": c.name, "arguments": c.arguments}
                        st.executed.append((c, out))
                        if on_call:
                            on_call(c, out)
                        for g in guards:
                            if g.after(c, out, st) == "stop":
                                st.stop = True
                act["result"] = out
                step["actions"].append(act)
                msgs.append({"role": "tool", "tool_call_id": c.id, "name": c.name, "content": json.dumps(out, ensure_ascii=False)})
            if st.stop:
                break
        else:
            trace["status"] = "max_steps"
        trace["messages_final"] = msgs[len(messages):]
        return trace
