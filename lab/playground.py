"""Playground: một phiên tương tác trên một mẫu. Phiên chạy trong tiến trình riêng (nạp zaic_tools của split),
nhận lệnh qua Pipe: llm_step (model đề xuất call), execute (chạy call), manual (tự gọi tool), state."""
from __future__ import annotations

import json
import multiprocessing as mp
import threading
import time
import traceback

from lab.core import datasets, db, models


def _session_main(conn, root: str, split: str, sid: str, cfg: dict):
    from agent_core.data import catalog_tools, load_catalog, load_samples, load_zaic_tools
    from agent_core.guards import AgentState, GuardDecision
    from agent_core.registry import build
    from agent_core.render import SEP
    from agent_core.types import ToolCall
    from lab.core.cache import MeteredLLM

    try:
        zt = load_zaic_tools(root, split)
        s = next(x for x in load_samples(root, split) if x.id == sid)
        if cfg.get("text") is not None:
            s.audio_text = cfg["text"]
        catalog = load_catalog(root, split)
        tools = catalog_tools(catalog)
        app_names = {a["id"]: a.get("name_vi", a["id"]) for a in catalog["apps"]}
        env = zt.ToolEnv(split, sid, root=root)
        usage = []
        llm = None
        if cfg.get("llm"):
            llm = MeteredLLM(build("llm", cfg["llm"]["spec"]), cfg["llm"]["id"], cfg["llm"]["price"], False,
                             lambda mid, kind, u, c, cached: usage.append((mid, kind, u, c, cached)))
        renderer = build("renderer", cfg.get("renderer", "compact"))
        prompt = build("prompt", cfg.get("prompt") or {"plugin": "rules"})
        guards = [build("guard", g) for g in cfg.get("guards") or []]
        specs = renderer.render(tools, s.allowed_tools())
        nmap = {t.api_name: t.name for t in specs}
        system = prompt.system(s, app_names)
        msgs = prompt.messages(s, None, s.audio_text or "")
        st = AgentState(sample=s, env=env, tools=tools)
        pending: list[dict] = []
        conn.send({"ok": True, "system": system, "messages": msgs, "tools": [t.__dict__ for t in specs], "label": s.label,
                   "text": s.audio_text})
    except Exception:
        conn.send({"ok": False, "error": traceback.format_exc()[-2000:]})
        return

    def run_call(c: ToolCall, use_guards: bool):
        act = {"call": {"name": c.name, "arguments": c.arguments}, "guard": "allow", "note": "", "executed": False}
        dec = GuardDecision()
        if use_guards:
            for g in guards:
                dec = g.before(c, st)
                if dec.action == "rewrite":
                    c = ToolCall(c.name, dec.arguments, c.id)
                    act["guard"], act["note"] = "rewrite", dec.note
                    continue
                if dec.action != "allow":
                    break
        if dec.action == "reject":
            out = dec.feedback
            act["guard"], act["note"] = "reject", dec.note
        elif dec.action == "skip":
            out = dec.result
            act["guard"], act["note"] = "skip", dec.note
        else:
            out = env.call(c.name, c.arguments)
            act["executed"] = True
            st.executed.append((c, out))
        act["result"] = out
        msgs.append({"role": "tool", "tool_call_id": c.id, "name": c.name, "content": json.dumps(out, ensure_ascii=False)})
        return act

    while True:
        try:
            cmd = conn.recv()
        except EOFError:
            break
        try:
            op = cmd["op"]
            if op == "close":
                break
            if op == "llm_step":
                if llm is None:
                    raise ValueError("phiên này chưa chọn model")
                r = llm.step(system, msgs, specs, {"sample": s})
                calls = [{"id": c.id or f"p{len(msgs)}_{j}", "name": nmap.get(c.name, c.name.replace(SEP, ".", 1)), "arguments": c.arguments}
                         for j, c in enumerate(r.tool_calls)]
                amsg = {"role": "assistant", "content": r.text, "tool_calls": calls}
                if r.raw:
                    amsg["_raw"] = r.raw
                msgs.append(amsg)
                pending = list(calls)
                cost = sum(u[3] for u in usage)
                out = {"text": r.text, "tool_calls": calls, "usage": r.usage, "cost": r.cost, "total_cost": cost, "usage_events": usage[:]}
                usage.clear()
                if cmd.get("auto_execute"):
                    out["actions"] = [run_call(ToolCall(c["name"], c["arguments"], c["id"]), True) for c in calls]
                    pending = []
            elif op == "execute":
                idx = cmd.get("index", 0)
                c = pending.pop(idx)
                if "arguments" in cmd:
                    c["arguments"] = cmd["arguments"]
                out = {"action": run_call(ToolCall(c["name"], c["arguments"], c["id"]), cmd.get("guards", True))}
            elif op == "manual":
                cid = f"m{len(msgs)}"
                msgs.append({"role": "assistant", "content": "", "tool_calls": [{"id": cid, "name": cmd["name"], "arguments": cmd.get("arguments") or {}}]})
                out = {"action": run_call(ToolCall(cmd["name"], cmd.get("arguments") or {}, cid), cmd.get("guards", False))}
            elif op == "user":
                msgs.append({"role": "user", "content": cmd["text"]})
                out = {}
            elif op == "state":
                out = {}
            else:
                raise ValueError(op)
            out.update(ok=True, calls=env.get_tool_calls(), state_hash=env.get_state_hash(), state=env.get_state(),
                       messages=msgs, pending=pending)
            conn.send(json.loads(json.dumps(out, ensure_ascii=False, default=str)))
        except Exception as e:
            conn.send({"ok": False, "error": f"{e}", "tb": traceback.format_exc()[-1500:]})


class Playground:
    def __init__(self):
        self.sessions: dict[str, dict] = {}
        self.lock = threading.Lock()

    def open(self, dataset_id: str, sample_id: str, llm_model: str | None, renderer="compact", prompt=None, guards=None,
             text: str | None = None) -> dict:
        b = datasets.base_of(datasets.get(dataset_id))
        cfg = {"renderer": renderer, "prompt": prompt or {"plugin": "rules", "rules": "rules_v2"},
               "guards": guards if guards is not None else ["validate_repair", "iso_time", "ask_params_order", "dedupe_reads", "ask_last"], "text": text}
        if llm_model:
            err = models.check_model_ready(llm_model)
            if err:
                raise ValueError(err)
            kind, spec, price = models.model_spec(llm_model)
            cfg["llm"] = {"id": llm_model, "spec": spec, "price": price}
        ctx = mp.get_context("spawn")
        a, bconn = ctx.Pipe()
        p = ctx.Process(target=_session_main, args=(bconn, b["root"], b["split"], sample_id, cfg), daemon=True)
        p.start()
        if not a.poll(60):
            p.terminate()
            raise RuntimeError("phiên playground không khởi động được")
        first = a.recv()
        if not first.get("ok"):
            p.terminate()
            raise RuntimeError(first.get("error"))
        sid = db.new_id("pg_")
        with self.lock:
            self.sessions[sid] = {"proc": p, "conn": a, "t": time.time(), "lock": threading.Lock(), "llm_model": llm_model}
            self._gc()
        return {"session": sid, **first}

    def _gc(self):
        now = time.time()
        for k, v in list(self.sessions.items()):
            if now - v["t"] > 3600 or not v["proc"].is_alive():
                self.close(k)

    def cmd(self, sid: str, cmd: dict, timeout: float = 180) -> dict:
        s = self.sessions.get(sid)
        if not s:
            raise KeyError("phiên không tồn tại hoặc đã hết hạn")
        with s["lock"]:
            s["t"] = time.time()
            s["conn"].send(cmd)
            if not s["conn"].poll(timeout):
                raise TimeoutError("phiên không phản hồi")
            out = s["conn"].recv()
        for mid, kind, u, c, cached in out.pop("usage_events", []) or []:
            models.log_usage("playground", mid, kind, u, c, cached)
        if not out.get("ok"):
            raise RuntimeError(out.get("error"))
        return out

    def close(self, sid: str):
        s = self.sessions.pop(sid, None)
        if s:
            try:
                s["conn"].send({"op": "close"})
            except Exception:
                pass
            s["proc"].join(timeout=2)
            if s["proc"].is_alive():
                s["proc"].terminate()


PLAYGROUND = Playground()
