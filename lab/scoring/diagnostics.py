"""Phân loại lỗi tự động cho một mẫu (so dự đoán với đáp án)."""
from __future__ import annotations

import re

from .official import ScoreOptions, arg_diff

ERROR_TAGS = {
    "hash_mismatch": "State cuối khác đáp án",
    "rejected_call": "Có call bị env từ chối (sai schema)",
    "wrong_id": "Sai ID",
    "wrong_time": "Sai thời gian",
    "wrong_amount": "Sai số tiền / số lượng",
    "wrong_args": "Sai tham số khác",
    "extra_args": "Thừa tham số",
    "missing_args": "Thiếu tham số",
    "fuzzy_below_threshold": "Văn bản tự do dưới ngưỡng",
    "extra_read": "Đọc thừa",
    "missing_read": "Thiếu bước đọc",
    "extra_write": "Ghi thừa",
    "missing_write": "Thiếu bước ghi",
    "missing_ask": "Thiếu hỏi lại (ask_missing_info)",
    "wrong_ask_params": "Hỏi lại sai tool/tham số",
    "unneeded_ask": "Hỏi lại không cần thiết",
    "acted_on_oos": "Gọi tool khi lẽ ra trả []",
    "empty_but_should_act": "Trả [] khi lẽ ra phải làm",
    "timeout": "Quá thời gian",
    "llm_error": "Lỗi gọi model",
    "crash": "Lỗi chương trình",
    "asr_error": "Lỗi ASR",
}

_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}")
ASK = "sys.ask_missing_info"


def _key_kind(k: str, v, tool_spec: dict) -> str:
    prop = (tool_spec.get("parameters", {}).get("properties", {}) or {}).get(k, {})
    if "x-ref" in prop or k.endswith("_id"):
        return "wrong_id"
    if isinstance(v, str) and _ISO.match(v):
        return "wrong_time"
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return "wrong_amount"
    return "wrong_args"


def diagnose(pred_calls: list[dict], pred_results: list[dict], gold_calls: list[dict], score, tools: dict[str, dict],
             fuzzy_map: dict[str, set[str]], status: str = "done", opts: ScoreOptions = ScoreOptions()) -> dict:
    """Trả {"tags": [...], "details": [...]} — details mô tả từng call lệch."""
    tags, details = set(), []
    if status in ("timeout", "llm_error", "crash"):
        tags.add(status)
    if any(isinstance(r, dict) and r.get("ok") is False for r in pred_results or []):
        tags.add("rejected_call")
    if not gold_calls:
        if pred_calls:
            tags.add("acted_on_oos")
        return {"tags": sorted(tags), "details": details}
    if not pred_calls:
        tags.add("empty_but_should_act")
    if not score.hash_ok:
        tags.add("hash_mismatch")
    matched_p = {i for i, _ in score.matches}
    matched_g = {j for _, j in score.matches}
    up = [(i, c) for i, c in enumerate(pred_calls) if i not in matched_p]
    ug = [(j, c) for j, c in enumerate(gold_calls) if j not in matched_g]
    used_p = set()
    for j, g in ug:
        cand = [(i, p) for i, p in up if p.get("name") == g.get("name") and i not in used_p]
        if cand:
            i, p = cand[0]
            used_p.add(i)
            d = arg_diff(p, g, fuzzy_map.get(g["name"], set()), opts)
            if g["name"] == ASK:
                tags.add("wrong_ask_params")
            for k, why in d.items():
                if why == "thừa":
                    tags.add("extra_args")
                elif why == "thiếu":
                    tags.add("missing_args")
                elif why.startswith("fuzzy"):
                    tags.add("fuzzy_below_threshold")
                else:
                    tags.add(_key_kind(k, (g.get("arguments") or {}).get(k), tools.get(g["name"], {})))
            details.append({"gold": g, "pred": p, "diff": d})
        else:
            kind = (tools.get(g["name"]) or {}).get("kind", "write")
            tags.add("missing_ask" if g["name"] == ASK else "missing_read" if kind == "read" else "missing_write")
            details.append({"gold": g, "pred": None, "diff": {"_": "không có call tương ứng"}})
    for i, p in up:
        if i in used_p:
            continue
        kind = (tools.get(p.get("name")) or {}).get("kind", "write")
        tags.add("unneeded_ask" if p.get("name") == ASK else "extra_read" if kind == "read" else "extra_write")
        details.append({"gold": None, "pred": p, "diff": {"_": "call thừa"}})
    return {"tags": sorted(tags), "details": details}


def scenario_of(gold_calls: list[dict] | None, tools: dict[str, dict]) -> str:
    if gold_calls is None:
        return "unlabeled"
    if not gold_calls:
        return "out_of_scope"
    if any(c["name"] == ASK for c in gold_calls):
        return "ask_missing"
    kinds = [(tools.get(c["name"]) or {}).get("kind") for c in gold_calls]
    if "write" not in kinds:
        return "read_only"
    if "read" in kinds:
        return "read_then_write"
    return "write_only"
