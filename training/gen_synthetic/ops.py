"""Thao tác trên một mẫu tổng hợp, chạy trong tiến trình con (cần zaic_tools của split):

    echo '{"cmd": "resim", "split": "...", "sid": "...", "edits": {...}}' | python -m training.gen_synthetic.ops

- resim:   áp dụng chỉnh sửa (câu yêu cầu / history / state / tool call) rồi CHẠY LẠI mô phỏng để sinh lại tool_results, final_state
- relabel: teacher gán nhãn lại lượt cuối
Khoá API nhận qua stdin, không qua tham số dòng lệnh.
"""
from __future__ import annotations

import copy
import json
import sys

from agent_core.data import catalog_tools, load_zaic_tools
from lab.core.paths import DATASETS

from .checks import check_record
from .labeler import Teacher, replay
from .split import read_records, read_state, split_lock, write_records, write_state


def _load(split: str):
    d = DATASETS / split
    zt = load_zaic_tools(DATASETS, split)
    catalog = json.loads((d / f"{split}_tools_catalog.json").read_text(encoding="utf-8"))
    return d, zt, catalog


def _allowed(rec):
    out = [t for a in rec["context"]["installed_apps"].values() for t in a.get("tools", [])]
    return sorted(set(out))


def resim(split: str, sid: str, edits: dict) -> dict:
    d, zt, catalog = _load(split)
    tools = catalog_tools(catalog)
    with split_lock(d):
        recs = read_records(d)
        idx = next(i for i, r in enumerate(recs) if r["id"] == sid)
        rec = copy.deepcopy(recs[idx])
        st_file = read_state(d, sid)
        meta_block = st_file.pop("_meta")
        base_p = d / "_gen" / f"{sid}.base.json"
        changed = []
        if "audio_text" in edits:
            rec["audio_text"] = edits["audio_text"]
            changed.append("audio_text")
        if "context" in edits:
            rec["context"].update({k: v for k, v in edits["context"].items() if k != "installed_apps"})
            changed.append("context")
        if "history" in edits or "base_state" in edits:
            if "history" in edits:
                rec["history"] = edits["history"]
            base = edits.get("base_state") or (json.loads(base_p.read_text(encoding="utf-8")) if base_p.is_file() else None)
            if base is None:
                raise ValueError("không có base state (state trước history) để chạy lại history")
            if "base_state" in edits:
                base_p.write_text(json.dumps(base, ensure_ascii=False), encoding="utf-8")
            state = copy.deepcopy(base)
            for t in rec["history"]:
                if t["role"] == "assistant" and t.get("tool_calls"):
                    rp = replay(zt, sid, rec["context"]["current_time"], _allowed(rec), state, t["tool_calls"], catalog)
                    t["tool_results"] = rp["results"]
                    state = {a: rp["state_after"].get(a, s) for a, s in state.items()}
            st_file = state
            changed.append("history")
        if "state" in edits:
            st_file = edits["state"]
            changed.append("state")
        if "tool_calls" in edits:
            rec.setdefault("label", {})["tool_calls"] = edits["tool_calls"]
            changed.append("tool_calls")
        calls = (rec.get("label") or {}).get("tool_calls") or []
        rp = replay(zt, sid, rec["context"]["current_time"], _allowed(rec), st_file, calls, catalog)
        rec["label"] = {"tool_calls": calls, "tool_results": rp["results"], "final_state": rp["final_state"]}
        rec.setdefault("meta", {})["state_hash"] = rp["state_hash"]
        rec["meta"].pop("label2_score", None) if "tool_calls" in changed else None
        rec["meta"].pop("gen_error", None)
        flags = check_record(rec, tools)
        rec["meta"]["flags"] = flags
        write_state(d, sid, {"_meta": meta_block, **st_file})
        recs[idx] = rec
        write_records(d, recs)
    return {"record": rec, "flags": flags, "changed": changed}


def relabel(split: str, sid: str, model: dict) -> dict:
    from agent_core.registry import build
    from lab.core.cache import MeteredLLM

    d, zt, catalog = _load(split)
    tools = catalog_tools(catalog)
    usage = []
    llm = MeteredLLM(build("llm", model["spec"]), model["id"], model["price"], False,
                     lambda mid, kind, u, c, cached: usage.append({"model_id": mid, "usage": u, "cost": c}))
    with split_lock(d):
        recs = read_records(d)
        idx = next(i for i, r in enumerate(recs) if r["id"] == sid)
        rec = copy.deepcopy(recs[idx])
    st = read_state(d, sid)
    st.pop("_meta")
    lab = Teacher(llm, catalog, model.get("rules", "rules_v2")).label(zt, rec, st, rec["audio_text"])
    rec["label"] = {"tool_calls": lab["calls"], "tool_results": lab["results"], "final_state": lab["final_state"]}
    rec.setdefault("meta", {}).update(labeler=model["id"], final_text=lab["text"], state_hash=lab["state_hash"])
    rec["meta"].pop("label2_score", None)
    flags = check_record(rec, tools)
    rec["meta"]["flags"] = flags
    with split_lock(d):
        recs = read_records(d)
        recs[next(i for i, r in enumerate(recs) if r["id"] == sid)] = rec
        write_records(d, recs)
    return {"record": rec, "flags": flags, "usage": usage}


def main():
    req = json.loads(sys.stdin.read())
    try:
        if req["cmd"] == "resim":
            out = resim(req["split"], req["sid"], req.get("edits") or {})
        elif req["cmd"] == "relabel":
            out = relabel(req["split"], req["sid"], req["model"])
        elif req["cmd"] == "app_test":
            from .app_factory import run_app_test

            out = run_app_test(req["app"])
        else:
            raise ValueError(f"lệnh không hợp lệ {req['cmd']}")
        print(json.dumps({"ok": True, **out}, ensure_ascii=False, default=str))
    except Exception as e:
        import traceback

        print(json.dumps({"ok": False, "error": str(e), "tb": traceback.format_exc()[-2000:]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
