"""Kiểm tra tự động một mẫu tổng hợp theo các luật hành vi rút ra từ nhãn train.

Mỗi cờ: {"code", "level": "error" | "warn", "msg"}. Mẫu có cờ error được đưa lên đầu hàng đợi duyệt.
"""
from __future__ import annotations

import json

from .scenarios import SCENARIOS

ASK = "sys.ask_missing_info"


def _scalars(x):
    if isinstance(x, dict):
        for v in x.values():
            yield from _scalars(v)
    elif isinstance(x, list):
        for v in x:
            yield from _scalars(v)
    elif isinstance(x, (str, int)) and not isinstance(x, bool):
        yield str(x)


def check_record(rec: dict, tools: dict[str, dict]) -> list[dict]:
    flags = []
    lab = rec.get("label") or {}
    calls, results = lab.get("tool_calls") or [], lab.get("tool_results") or []
    meta = rec.get("meta") or {}
    scen = SCENARIOS.get(meta.get("scenario"), {})
    expect = scen.get("expect", "any")

    def f(code, level, msg):
        flags.append({"code": code, "level": level, "msg": msg})

    utt = rec.get("audio_text") or ""
    if len(utt.split()) < 2:
        f("short_utterance", "error", "Câu yêu cầu quá ngắn hoặc rỗng")
    if any(isinstance(r, dict) and r.get("ok") is False for r in results):
        f("rejected_call", "error", "Có call bị env từ chối (sai schema)")
    for c, r in zip(calls, results):
        if (tools.get(c["name"]) or {}).get("kind") == "write" and isinstance(r, dict) and r.get("done") is False:
            f("write_not_done", "warn", f"{c['name']} chạy nhưng không làm gì: {r.get('message', '')}")
    # ID phải có nguồn
    seen = set()
    for h in rec.get("history") or []:
        for r in h.get("tool_results") or []:
            seen |= set(_scalars(r))
    for i, c in enumerate(calls):
        spec = (tools.get(c["name"]) or {}).get("parameters", {}).get("properties", {})
        for k, v in (c.get("arguments") or {}).items():
            if "x-ref" in spec.get(k, {}) and isinstance(v, str) and v not in seen:
                f("id_without_source", "error", f"{c['name']}.{k}={v} không xuất hiện trong kết quả đọc trước đó")
        seen |= set(_scalars(results[i] if i < len(results) else {}))
    # ask
    asks = [i for i, c in enumerate(calls) if c["name"] == ASK]
    if len(asks) > 1:
        f("multi_ask", "error", "Gọi ask_missing_info nhiều lần")
    if asks and asks[-1] != len(calls) - 1:
        f("ask_not_last", "error", "ask_missing_info không phải call cuối")
    for i in asks:
        a = calls[i].get("arguments") or {}
        t = tools.get(a.get("tool_name"))
        if not t:
            f("ask_bad_tool", "error", f"ask_missing_info trỏ tới tool không tồn tại: {a.get('tool_name')}")
        else:
            props = t.get("parameters", {}).get("properties", {})
            bad = [p for p in a.get("params") or [] if p not in props]
            if bad:
                f("ask_bad_params", "error", f"Tham số không có trong schema: {bad}")
    # tham số
    for c in calls:
        t = tools.get(c["name"]) or {}
        req = set(t.get("parameters", {}).get("required", []))
        args = c.get("arguments") or {}
        if t.get("kind") == "read" and any(k not in req for k in args):
            f("read_with_args", "warn", f"{c['name']} có tham số lọc {list(args)} (nhãn train thường gọi đọc với {{}})")
        if t.get("kind") == "write":
            opt = [k for k in args if k not in req and not any(k in g for g in t.get("parameters", {}).get("x-one-of", []))]
            if opt:
                f("optional_args", "warn", f"{c['name']} có tham số tuỳ chọn {opt} — kiểm tra người dùng có nói không")
    keys = [json.dumps(c, sort_keys=True, ensure_ascii=False) for c in calls]
    if len(keys) != len(set(keys)):
        f("duplicate_call", "warn", "Có call lặp lại y hệt")
    # khớp kịch bản
    if expect == "oos" and calls:
        f("scenario_mismatch", "error", "Kịch bản ngoài phạm vi nhưng nhãn có tool call")
    if expect in ("act", "read", "ask") and not calls:
        f("scenario_mismatch", "error", "Kịch bản cần hành động nhưng nhãn rỗng")
    if expect == "ask" and not asks:
        f("scenario_mismatch", "warn", "Kịch bản hỏi lại nhưng nhãn không có ask_missing_info")
    if expect == "act" and calls and not any((tools.get(c["name"]) or {}).get("kind") == "write" for c in calls):
        f("scenario_mismatch", "warn", "Kịch bản hành động nhưng nhãn không có call ghi")
    if meta.get("label2_score") is not None and meta["label2_score"] < 1.0:
        f("teacher_disagree", "error", f"Teacher thứ hai cho kết quả khác (điểm {meta['label2_score']:.2f})")
    if meta.get("gen_error"):
        f("gen_error", "error", meta["gen_error"][:300])
    return flags


def has_error(flags: list[dict]) -> bool:
    return any(x["level"] == "error" for x in flags)
