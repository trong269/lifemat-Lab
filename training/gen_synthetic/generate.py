"""Sinh một đợt dữ liệu tổng hợp (chạy trong tiến trình con vì cần zaic_tools của split tổng hợp).

Mỗi mẫu: chọn kịch bản + app -> sinh state (có bẫy) -> sinh từng lượt history (writer viết câu, teacher chạy thật trên mô phỏng)
-> writer viết câu cuối theo kịch bản -> teacher gán nhãn -> (teacher 2 đối chiếu) -> kiểm tra tự động -> ghi split.
"""
from __future__ import annotations

import copy
import json
import random
import threading
import traceback
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel, Field

from .scenarios import DEFAULT_WEIGHTS, HISTORY_SCENARIOS, SCENARIOS


class Recipe(BaseModel):
    n_samples: int = Field(50, ge=1, le=20000)
    weights: dict[str, float] = Field(default_factory=lambda: dict(DEFAULT_WEIGHTS), description="Tỷ trọng các kịch bản")
    apps_pool: list[str] = Field(default_factory=list, description="App được dùng làm trọng tâm (trống = mọi app train + app tự tạo đã duyệt)")
    extra_apps: list[str] = Field(default_factory=list, description="App tự tạo (đã duyệt) đưa vào split")
    installed_min: int = 4
    installed_max: int = 12
    history_dist: dict[str, float] = Field(default_factory=lambda: {"0": 0.35, "1": 0.25, "2": 0.2, "3": 0.1, "4": 0.06, "6": 0.04})
    region_weights: dict[str, float] = Field(default_factory=lambda: {"bac": 0.5, "trung": 0.25, "nam": 0.25})
    state_mode: str = Field("perturb", description="perturb (miễn phí) hoặc llm (teacher viết lại state)")
    writer_model: str = Field("", description="Model viết câu yêu cầu")
    labeler_model: str = Field("", description="Model teacher gán nhãn")
    labeler2_model: str | None = Field(None, description="Teacher thứ hai để đối chiếu (tuỳ chọn)")
    rules: str = "rules_v2"
    parallel: int = Field(4, ge=1, le=32)
    seed: int = 0
    budget_usd: float | None = None
    spot_check_rate: float = 0.1


WRITER_SYSTEM = """Bạn tạo dữ liệu huấn luyện cho trợ lý giọng nói tiếng Việt điều khiển app trên điện thoại.
Nhiệm vụ: viết MỘT câu nói của người dùng (lời nói tự nhiên, như đang nói với loa thông minh) đúng kịch bản được giao,
khớp với dữ liệu app hiện có. Không bao giờ đọc ID (c_01, evt_02...) — người dùng chỉ nói tên, mô tả, thời gian.
Câu dài khoảng 6-35 từ, không giải thích thêm. Trả về đúng một JSON:
{"utterance": "...", "expected": "mô tả ngắn hành vi đúng của trợ lý", "target_apps": ["app_id", ...]}"""


def _compact_state(states: dict, apps: list[str], limit: int = 1800) -> str:
    out = []
    for a in apps:
        if a in states:
            out.append(f"[{a}] {json.dumps(states[a], ensure_ascii=False)[:limit]}")
    return "\n".join(out)


def _pick(rng: random.Random, weights: dict[str, float]) -> str:
    keys = [k for k, w in weights.items() if w > 0]
    return rng.choices(keys, [weights[k] for k in keys])[0]


class Generator:
    def __init__(self, spec: dict, q, stop_event):
        from agent_core.data import catalog_tools, load_zaic_tools
        from agent_core.registry import build
        from lab.core.cache import MeteredLLM
        from lab.core.paths import DATASETS

        from .labeler import Teacher
        from .split import approved_apps

        self.spec, self.q, self.stop = spec, q, stop_event
        self.recipe = Recipe(**spec["recipe"])
        self.split = spec["split"]
        self.split_dir = DATASETS / self.split
        self.zt = load_zaic_tools(DATASETS, self.split)
        self.catalog = json.loads((self.split_dir / f"{self.split}_tools_catalog.json").read_text(encoding="utf-8"))
        self.tools = catalog_tools(self.catalog)
        self.app_tools = {a["id"]: [t["name"] for t in a["tools"]] for a in self.catalog["apps"] if a["id"] != "sys"}
        self.app_desc = {a["id"]: f"{a.get('name_vi', a['id'])}: {a.get('description', '')}" for a in self.catalog["apps"]}
        pool = self.recipe.apps_pool or [a for a in self.app_tools]
        self.pool = [a for a in pool if a in self.app_tools]
        self.lock = threading.Lock()

        def sink(mid, kind, usage, cost, cached):
            self.q.put({"type": "usage", "model_id": mid, "kind": kind, "usage": usage, "cost": cost, "cached": cached})

        def mk(role):
            m = spec["models"].get(role)
            if not m:
                return None
            return MeteredLLM(build("llm", m["spec"]), m["id"], m["price"], True, sink)

        self.writer = mk("writer")
        self.teacher = Teacher(mk("labeler"), self.catalog, self.recipe.rules)
        lab2 = mk("labeler2")
        self.teacher2 = Teacher(lab2, self.catalog, self.recipe.rules) if lab2 else None
        self.state_llm = self.writer if self.recipe.state_mode == "llm" else None
        self.gen_apps = set(approved_apps())

    # ------------------------------------------------------------------
    def write(self, scen_id: str, rec: dict, states: dict, focus: list[str], hist_text: list[str], region: str, style: str,
              notes: list[str], missing: str | None) -> dict:
        from .common import REGIONS, llm_json

        sc = SCENARIOS[scen_id]
        ctx = rec["context"]
        parts = [f"Kịch bản: {sc['name']} — {sc['desc']}",
                 f"Thời điểm hiện tại: {ctx['current_time']}",
                 f"Người dùng: {json.dumps(ctx['user_profile'], ensure_ascii=False)}",
                 "App đã cài: " + "; ".join(self.app_desc.get(a, a) for a in ctx["installed_apps"]),
                 "App trọng tâm: " + ", ".join(focus)]
        if missing:
            parts.append(f"Chức năng không có (app chưa cài): {self.app_desc.get(missing, missing)}")
        if notes:
            parts.append("Ghi chú bẫy: " + "; ".join(notes))
        parts.append("Dữ liệu app (trích):\n" + _compact_state(states, list(dict.fromkeys(focus + list(ctx["installed_apps"])))[:5]))
        if hist_text:
            parts.append("Hội thoại trước:\n" + "\n".join(hist_text[-8:]))
        parts.append(f"Phong cách: {REGIONS[region]}; {style}. Xưng hô hợp với người dùng {ctx['user_profile'].get('name', '')}.")
        out, _ = llm_json(self.writer, WRITER_SYSTEM, "\n\n".join(parts))
        if not isinstance(out, dict) or not out.get("utterance"):
            raise ValueError("writer không trả utterance")
        return out

    def gen_one(self, i: int) -> dict:
        from .common import GIVEN_NAMES, STYLES, random_time, train_contexts  # noqa: F401
        from .state_gen import make_state

        r = self.recipe
        rng = random.Random(r.seed * 100003 + i)
        sid = f"{self.split}_{i + 1:05d}"
        scen = _pick(rng, r.weights)
        n_hist = int(_pick(rng, r.history_dist))
        if SCENARIOS[scen].get("needs_history") and n_hist == 0:
            n_hist = rng.choice([1, 2])
        region = _pick(rng, r.region_weights)
        style = rng.choice(STYLES)
        n_focus = 2 if scen in ("multi_intent", "partial_then_ask", "conditional") else 1
        focus = rng.sample(self.pool, k=min(n_focus, len(self.pool)))
        if scen in ("ask_ambiguous", "partial_then_ask") and "contacts" in self.app_tools:
            focus = list(dict.fromkeys(["contacts"] + focus + [rng.choice([a for a in ("sms", "phone", "ewallet", "chat_ott") if a in self.app_tools])]))
        if scen == "conditional":
            info = [a for a in ("weather", "gold_price", "banking", "calendar") if a in self.app_tools]
            focus = list(dict.fromkeys([rng.choice(info)] + focus))
        n_inst = rng.randint(r.installed_min, max(r.installed_min, r.installed_max))
        others = [a for a in self.app_tools if a not in focus]
        missing = None
        if scen == "oos_not_installed":
            missing = rng.choice(others)
            others = [a for a in others if a != missing]
            focus = [a for a in focus if a != missing]
        installed = list(dict.fromkeys(focus + rng.sample(others, k=max(0, min(len(others), n_inst - len(focus))))))
        rng.shuffle(installed)
        base_ctx = rng.choice(train_contexts())
        now = random_time(rng)
        ctx = {"current_time": now, "timezone": base_ctx["timezone"], "location": base_ctx["location"],
               "user_profile": base_ctx["user_profile"],
               "installed_apps": {a: {"tools": list(self.app_tools[a])} for a in installed}}
        rec = {"id": sid, "audio": f"audio/{sid}/{sid}.wav", "context": ctx, "history": []}
        states, notes = make_state(installed, rng, SCENARIOS[scen]["traps"], r.state_mode, self.state_llm, now)
        base_state = copy.deepcopy(states)
        hist_text = []
        for k in range(n_hist):
            hs = rng.choice(HISTORY_SCENARIOS)
            hfocus = rng.sample(installed, k=1)
            w = self.write(hs, rec, states, hfocus, hist_text, region, style, [], None)
            lab = self.teacher.label(self.zt, rec, states, w["utterance"])
            rec["history"].append({"role": "user", "audio": f"audio/{sid}/{sid}_u{k + 1}.wav", "audio_text": w["utterance"]})
            rec["history"].append({"role": "assistant", "text": lab["text"], "tool_calls": lab["calls"], "tool_results": lab["results"]})
            hist_text += [f"Người dùng: {w['utterance']}", f"Trợ lý: {lab['text']}"]
            states = {a: lab["state_after"].get(a, st) for a, st in states.items()}
        w = self.write(scen, rec, states, focus, hist_text, region, style, notes, missing)
        rec["audio_text"] = w["utterance"]
        lab = self.teacher.label(self.zt, rec, states, w["utterance"])
        rec["label"] = {"tool_calls": lab["calls"], "tool_results": lab["results"], "final_state": lab["final_state"]}
        meta = {"scenario": scen, "region": region, "style": style, "expected": w.get("expected"), "target_apps": w.get("target_apps"),
                "focus": focus, "missing_app": missing, "trap_notes": notes, "batch": self.spec.get("batch_id"),
                "writer": self.spec["models"]["writer"]["id"], "labeler": self.spec["models"]["labeler"]["id"],
                "rules": r.rules, "label_status": lab["status"], "final_text": lab["text"], "state_hash": lab["state_hash"]}
        if lab.get("error"):
            meta["gen_error"] = f"teacher: {lab['error']}"
        if self.teacher2:
            from lab.scoring.official import fuzzy_params_from_catalog, score_sample

            l2 = self.teacher2.label(self.zt, rec, states, w["utterance"])
            sc = score_sample(l2["calls"], l2["state_hash"], lab["calls"], lab["state_hash"], fuzzy_params_from_catalog(self.catalog))
            meta["label2_score"] = sc.score
            meta["label2_calls"] = l2["calls"]
        rec["meta"] = meta
        state_file = {"_meta": {"question_id": sid, "current_time": now,
                                "tools": sorted({t for a in installed for t in self.app_tools[a]})}, **states}
        return {"rec": rec, "state": state_file, "base_state": base_state}

    def run(self):
        from .checks import check_record
        from .split import append_record, write_state

        r = self.recipe
        (self.split_dir / "_gen").mkdir(exist_ok=True)
        start = self.spec.get("start_index", 0)
        rng = random.Random(r.seed + 7)

        def task(i):
            if self.stop.is_set():
                return
            try:
                out = self.gen_one(i)
            except Exception as e:
                self.q.put({"type": "fail", "i": i, "error": f"{e}", "tb": traceback.format_exc()[-1500:]})
                return
            rec = out["rec"]
            flags = check_record(rec, self.tools)
            rec["meta"]["flags"] = flags
            with self.lock:
                write_state(self.split_dir, rec["id"], out["state"])
                (self.split_dir / "_gen" / f"{rec['id']}.base.json").write_text(json.dumps(out["base_state"], ensure_ascii=False), encoding="utf-8")
                append_record(self.split_dir, rec)
            self.q.put({"type": "sample", "sid": rec["id"], "scenario": rec["meta"]["scenario"], "flags": flags,
                        "spot_check": int(rng.random() < r.spot_check_rate),
                        "disagreement": int((rec["meta"].get("label2_score") or 1.0) < 1.0),
                        "provenance": {k: rec["meta"].get(k) for k in ("writer", "labeler", "rules", "batch", "region", "style")}})

        with ThreadPoolExecutor(max_workers=r.parallel) as ex:
            list(ex.map(task, range(start, start + r.n_samples)))
        self.q.put({"type": "end"})


def generation_main(spec: dict, q, stop_event):
    try:
        Generator(spec, q, stop_event).run()
    except Exception:
        q.put({"type": "fatal", "error": traceback.format_exc()[-3000:]})
