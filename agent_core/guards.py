"""Guard: chạy trước/sau mỗi tool call của agent.

before() trả GuardDecision:
  allow   — gọi env như bình thường
  rewrite — gọi env với arguments đã sửa
  reject  — KHÔNG gọi env, trả `feedback` cho model (không bị ghi vào bài nộp)
  skip    — KHÔNG gọi env, trả `result` có sẵn cho model
after() trả "stop" để kết thúc vòng lặp.
"""
from __future__ import annotations

import copy
import json
import re
from dataclasses import dataclass, field

from typing import Literal

from pydantic import BaseModel, Field

from .registry import register
from .types import Sample, ToolCall


@dataclass
class GuardDecision:
    action: str = "allow"
    arguments: dict | None = None
    feedback: dict | None = None
    result: dict | None = None
    note: str = ""


@dataclass
class AgentState:
    sample: Sample
    env: object
    tools: dict[str, dict]                     # catalog: name -> tool spec
    executed: list[tuple[ToolCall, dict]] = field(default_factory=list)
    repairs: int = 0
    stop: bool = False

    def kind(self, name: str) -> str:
        return (self.tools.get(name) or {}).get("kind", "write")


class Guard:
    def before(self, call: ToolCall, st: AgentState) -> GuardDecision:
        return GuardDecision()

    def after(self, call: ToolCall, result: dict, st: AgentState) -> str | None:
        return None


class ValidateRepairConfig(BaseModel):
    max_repairs: int = Field(3, description="Số lần tối đa trả lỗi schema cho model tự sửa")


@register("guard", "validate_repair", ValidateRepairConfig, "Kiểm tra schema bằng env.validate trước khi gọi; sai thì trả lỗi cho model sửa, không gọi env")
class ValidateRepair(Guard):
    def __init__(self, cfg: ValidateRepairConfig):
        self.cfg = cfg

    def before(self, call, st):
        if "__parse_error__" in call.arguments:
            st.repairs += 1
            return GuardDecision("reject", feedback={"ok": False, "error": "arguments không phải JSON hợp lệ", "executed": False})
        v = st.env.validate(call.name, call.arguments)
        if v.get("ok"):
            return GuardDecision()
        st.repairs += 1
        fb = {"ok": False, "error": v.get("error"), "executed": False,
              "note": "Call chưa được thực thi. Sửa tham số rồi gọi lại, hoặc bỏ qua nếu không cần."}
        if st.repairs > self.cfg.max_repairs:
            fb["note"] = "Call chưa được thực thi và đã hết lượt sửa."
        return GuardDecision("reject", feedback=fb, note=v.get("error") or "")


_ISO_NO_SEC = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$")
_ISO_NO_TZ = re.compile(r"^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})$")
_TIME_KEYS = {"time", "start", "end", "due", "schedule_time", "from_time", "valid_until", "delivery_time", "since"}


class IsoTimeConfig(BaseModel):
    keys: list[str] = Field(default_factory=lambda: sorted(_TIME_KEYS), description="Tên tham số thời gian cần chuẩn hoá")


@register("guard", "iso_time", IsoTimeConfig, "Chuẩn hoá thời gian ISO: thêm giây và múi giờ theo current_time")
class IsoTime(Guard):
    def __init__(self, cfg: IsoTimeConfig):
        self.cfg = cfg

    def before(self, call, st):
        now = st.sample.context.get("current_time") or ""
        tz = now[19:] if len(now) > 19 and now[19] in "+-" else "+07:00"
        spec = (st.tools.get(call.name) or {}).get("parameters", {}).get("properties", {})
        args, changed = copy.deepcopy(call.arguments), False
        for k, v in list(args.items()):
            if not isinstance(v, str):
                continue
            if k not in self.cfg.keys and "ISO" not in (spec.get(k, {}).get("description") or "") and spec.get(k, {}).get("format") != "date-time":
                continue
            if spec.get(k, {}).get("format") == "date" or spec.get(k, {}).get("format") == "time":
                continue
            nv = v.strip()
            if _ISO_NO_SEC.match(nv):
                nv += ":00"
            if _ISO_NO_TZ.match(nv):
                nv += tz
            if nv.endswith("Z") and len(nv) == 20:
                nv = nv[:-1] + tz if tz == "+00:00" else nv
            if nv != v:
                args[k], changed = nv, True
        return GuardDecision("rewrite", arguments=args, note="chuẩn hoá thời gian") if changed else GuardDecision()


class EmptyConfig(BaseModel):
    pass


@register("guard", "dedupe_reads", EmptyConfig, "Không gọi lại tool đọc cùng tham số trong lượt; trả kết quả cũ cho model")
class DedupeReads(Guard):
    def __init__(self, cfg):
        self.cfg = cfg

    def before(self, call, st):
        if st.kind(call.name) != "read":
            return GuardDecision()
        key = json.dumps(call.arguments, sort_keys=True, ensure_ascii=False)
        for c, r in st.executed:
            if c.name == call.name and json.dumps(c.arguments, sort_keys=True, ensure_ascii=False) == key:
                return GuardDecision("skip", result=r, note="đọc trùng, dùng lại kết quả")
        return GuardDecision()


@register("guard", "history_reads", EmptyConfig, "Tool đọc đã gọi y hệt trong history thì trả lại kết quả trong history, không gọi env")
class HistoryReads(Guard):
    def __init__(self, cfg):
        self.cfg = cfg

    def before(self, call, st):
        if st.kind(call.name) != "read":
            return GuardDecision()
        key = json.dumps(call.arguments, sort_keys=True, ensure_ascii=False)
        for t in st.sample.history:
            for i, c in enumerate(t.tool_calls):
                if c.get("name") == call.name and json.dumps(c.get("arguments") or {}, sort_keys=True, ensure_ascii=False) == key:
                    if i < len(t.tool_results):
                        return GuardDecision("skip", result=t.tool_results[i], note="đã có trong history")
        return GuardDecision()


@register("guard", "ask_last", EmptyConfig, "sys.ask_missing_info tối đa một lần và là call cuối: gọi xong thì dừng")
class AskLast(Guard):
    def __init__(self, cfg):
        self.cfg = cfg

    def before(self, call, st):
        if any(c.name == "sys.ask_missing_info" for c, _ in st.executed):
            return GuardDecision("reject", feedback={"ok": False, "executed": False, "error": "đã hỏi lại người dùng, không gọi thêm tool"})
        return GuardDecision()

    def after(self, call, result, st):
        return "stop" if call.name == "sys.ask_missing_info" else None


# Tham số tuỳ chọn của tool đọc mà đáp án train dùng >= ~40% số lần (đo trên 1545 nhãn) -> giữ lại.
KEEP_READ_ARGS = [
    "gold_price.get_price.type", "fuel_price.get_price.type", "home_security.get_camera.location", "news.headlines.topic",
    "library.search.query", "contacts.search.query", "bike_rental.find_bikes.near", "fitness.get_activity.date",
    "sms.read_recent.contact_id", "loyalty.get_points.program", "tv.guide.channel", "maps.search_place.near",
    "*.query", "*.q", "*.keyword", "*.symbol",
]


class StripReadFiltersConfig(BaseModel):
    keep: list[str] = Field(default_factory=lambda: list(KEEP_READ_ARGS),
                            description="Tham số giữ lại, dạng app.tool.arg hoặc *.arg (mặc định: đo từ nhãn train)")
    keep_x_ref: bool = Field(True, description="Giữ tham số là ID tham chiếu (x-ref)")


@register("guard", "strip_read_filters", StripReadFiltersConfig,
          "Bỏ bộ lọc tuỳ chọn của tool đọc mà đáp án hiếm khi dùng (list_bills.type, khoảng ngày list_events, weather.location...); không đổi state")
class StripReadFilters(Guard):
    def __init__(self, cfg: StripReadFiltersConfig):
        self.cfg = cfg
        self.keep = set(cfg.keep)

    def _keep(self, tool: str, arg: str, spec: dict) -> bool:
        if f"{tool}.{arg}" in self.keep or f"*.{arg}" in self.keep:
            return True
        return self.cfg.keep_x_ref and "x-ref" in (spec.get("properties", {}).get(arg) or {})

    def before(self, call, st):
        if st.kind(call.name) != "read" or not call.arguments:
            return GuardDecision()
        spec = (st.tools.get(call.name) or {}).get("parameters", {})
        req = set(spec.get("required", []))
        args = {k: v for k, v in call.arguments.items() if k in req or self._keep(call.name, k, spec)}
        if args == call.arguments:
            return GuardDecision()
        return GuardDecision("rewrite", arguments=args, note=f"bỏ bộ lọc {sorted(set(call.arguments) - set(args))}")


# Quy luật viết hoa trong nhãn train (đo trên 1545 mẫu): tên người viết hoa từng từ (contacts.search.query 204/204,
# household_chores.assign.assignee 29/30), tỉnh thành viết hoa từng từ, mã tiền tệ / mã sân bay viết hoa toàn bộ.
CASE_RULES = {
    "title": ["contacts.search.query", "*.assignee", "*.province"],
    "upper": ["*.from_currency", "*.to_currency", "flights.search.origin", "flights.search.destination"],
    "sentence": ["library.search.query"],
}
TITLE_KEEP_LOWER = ["giáo", "sĩ", "thủ", "quỹ"]   # "Cô giáo Mai", "Bác sĩ An", "Anh Hải thủ quỹ"


class RestoreCaseConfig(BaseModel):
    rules: dict[str, list[str]] = Field(default_factory=lambda: {k: list(v) for k, v in CASE_RULES.items()},
                                        description="title / upper / sentence -> danh sách app.tool.arg hoặc *.arg")
    keep_lower: list[str] = Field(default_factory=lambda: list(TITLE_KEEP_LOWER), description="Từ giữ chữ thường khi viết hoa từng từ")


@register("guard", "restore_case", RestoreCaseConfig,
          "Khôi phục chữ hoa cho tên người, tỉnh thành, mã tiền tệ khi giá trị toàn chữ thường (transcript ASR không có hoa/thường)")
class RestoreCase(Guard):
    def __init__(self, cfg: RestoreCaseConfig):
        self.cfg = cfg
        self.lower = set(cfg.keep_lower)

    def _mode(self, tool: str, arg: str) -> str | None:
        for mode, pats in self.cfg.rules.items():
            if f"{tool}.{arg}" in pats or f"*.{arg}" in pats:
                return mode
        return None

    def _apply(self, mode: str, v: str) -> str:
        if mode == "upper":
            return v.upper() if re.fullmatch(r"[a-z]{3}", v) else v
        if mode == "sentence":
            return v[:1].upper() + v[1:]
        words = v.split()
        return " ".join(w if (i > 0 and w in self.lower) else w[:1].upper() + w[1:] for i, w in enumerate(words))

    def before(self, call, st):
        args, changed = dict(call.arguments), []
        for k, v in call.arguments.items():
            mode = self._mode(call.name, k)
            if mode and isinstance(v, str) and v and v == v.lower():      # chỉ sửa giá trị toàn chữ thường
                nv = self._apply(mode, v)
                if nv != v:
                    args[k] = nv
                    changed.append(f"{k}: {v} -> {nv}")
        return GuardDecision("rewrite", arguments=args, note="; ".join(changed)) if changed else GuardDecision()


class AskParamsOrderConfig(BaseModel):
    order: Literal["alpha", "schema"] = Field("alpha", description="alpha: theo bảng chữ cái (khớp ví dụ của BTC "
                                              "['playlist_id','track_id']); schema: theo thứ tự khai báo trong schema")


@register("guard", "ask_params_order", AskParamsOrderConfig, "Sắp xếp và bỏ trùng params của sys.ask_missing_info")
class AskParamsOrder(Guard):
    def __init__(self, cfg: AskParamsOrderConfig):
        self.cfg = cfg

    def before(self, call, st):
        if call.name != "sys.ask_missing_info" or not isinstance(call.arguments.get("params"), list):
            return GuardDecision()
        ps = list(dict.fromkeys(call.arguments["params"]))
        if self.cfg.order == "schema":
            props = list(((st.tools.get(call.arguments.get("tool_name")) or {}).get("parameters", {}).get("properties", {})))
            ps.sort(key=lambda p: props.index(p) if p in props else len(props))
        else:
            ps.sort()
        if ps == call.arguments["params"]:
            return GuardDecision()
        return GuardDecision("rewrite", arguments={**call.arguments, "params": ps}, note="sắp xếp params")


# restore_case / strip_read_filters: không giúp theo cách BTC chấm (leaderboard 30/10) -> tắt mặc định, vẫn bật tay được
DEFAULT_GUARDS = ["validate_repair", "iso_time", "ask_params_order", "dedupe_reads", "ask_last"]
