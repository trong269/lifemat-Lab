"""Sinh state cho từng app.

- perturb (miễn phí): lấy state thật của app từ một mẫu train ngẫu nhiên, đổi tên người, số điện thoại, số tiền.
- llm: nhờ teacher viết lại toàn bộ nội dung state theo đúng cấu trúc của state mẫu.
Bẫy (traps): duplicate_name (danh bạ có 2 người trùng tên), low_balance (số dư thấp).
"""
from __future__ import annotations

import copy
import json
import random
import re
from functools import lru_cache

from lab.core.datasets import train_root

from .common import GIVEN_NAMES, llm_json
from .split import approved_apps

MONEY_KEYS = {"balance", "amount", "price", "points", "total"}
INFO_APPS = {"weather", "gold_price", "fuel_price", "exchange_rate", "lottery"}


@lru_cache(maxsize=1)
def train_app_states(max_per_app: int = 60) -> dict[str, list[dict]]:
    env = train_root() / "train" / "train_environment"
    rng = random.Random(0)
    dirs = sorted(env.iterdir())
    rng.shuffle(dirs)
    out: dict[str, list[dict]] = {}
    for d in dirs:
        s = json.loads((d / "state.json").read_text(encoding="utf-8"))
        for app, st in s.items():
            if app == "_meta":
                continue
            lst = out.setdefault(app, [])
            if len(lst) < max_per_app:
                lst.append(st)
    return out


def example_states(app: str) -> list[dict]:
    st = train_app_states().get(app)
    if st:
        return st
    ga = approved_apps().get(app)
    return [ga["example_state"]] if ga else [{}]


def _walk(obj, fn):
    if isinstance(obj, dict):
        return {k: _walk(fn(k, v), fn) if isinstance(v, (dict, list)) else fn(k, v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_walk(x, fn) for x in obj]
    return obj


def _name_map(states: dict, rng: random.Random) -> dict[str, str]:
    text = json.dumps(states, ensure_ascii=False)
    found = [n for n in GIVEN_NAMES if re.search(rf"(?<!\w){re.escape(n)}(?!\w)", text)]
    pool = [n for n in GIVEN_NAMES if n not in found]
    rng.shuffle(pool)
    return {n: pool[i] for i, n in enumerate(found) if i < len(pool) and rng.random() < 0.8}


def perturb(states: dict, rng: random.Random) -> dict:
    nmap = _name_map(states, rng)

    def fn(k, v):
        if isinstance(v, str):
            for a, b in nmap.items():
                v = re.sub(rf"(?<!\w){re.escape(a)}(?!\w)", b, v)
            if k in ("phone", "phone_number") and re.fullmatch(r"0\d{9,10}", v):
                v = "09" + "".join(str(rng.randint(0, 9)) for _ in range(len(v) - 2))
            return v
        if k in MONEY_KEYS and isinstance(v, int) and not isinstance(v, bool) and v >= 1000:
            return max(1000, int(round(v * rng.uniform(0.6, 1.6) / 1000.0)) * 1000)
        return v

    return {app: _walk(st, fn) if app not in INFO_APPS else st for app, st in states.items()}


def add_traps(states: dict, traps: list[str], rng: random.Random) -> list[str]:
    notes = []
    if "duplicate_name" in traps and "contacts" in states:
        cs = states["contacts"].get("contacts", [])
        single = [c for c in cs if c.get("name") in GIVEN_NAMES]
        if not single and cs:
            c0 = cs[0]
            c0["name"] = rng.choice(GIVEN_NAMES)
            single = [c0]
        if single:
            c = rng.choice(single)
            rel = rng.choice([r for r in ["bạn", "đồng nghiệp", "khách hàng", "hàng xóm", "em họ"] if r != c.get("relation")])
            ids = {x["id"] for x in cs}
            k = len(cs) + 1
            while f"c_{k:02d}" in ids:
                k += 1
            cs.append({"id": f"c_{k:02d}", "name": c["name"], "relation": rel, "phone": "09" + "".join(str(rng.randint(0, 9)) for _ in range(9))})
            notes.append(f"Danh bạ có 2 người cùng tên {c['name']} ({c.get('relation')} và {rel})")
    if "low_balance" in traps:
        if "banking" in states:
            for a in states["banking"].get("accounts", [])[:1]:
                a["balance"] = rng.choice([50000, 120000, 300000])
                notes.append(f"Tài khoản {a.get('name')} chỉ còn {a['balance']} đồng")
        if "ewallet" in states and isinstance(states["ewallet"].get("balance"), int):
            states["ewallet"]["balance"] = rng.choice([20000, 80000, 150000])
            notes.append(f"Ví điện tử chỉ còn {states['ewallet']['balance']} đồng")
    return notes


LLM_STATE_SYSTEM = """Bạn tạo dữ liệu app giả lập cho trợ lý giọng nói tiếng Việt. Viết lại nội dung state của app theo ĐÚNG cấu trúc JSON mẫu
(giữ nguyên tên khoá, kiểu dữ liệu, định dạng ID và ngày giờ ISO), nhưng nội dung mới, đa dạng, chân thực với người Việt.
Ngày giờ nằm quanh thời điểm hiện tại được cho. Chỉ trả về một đối tượng JSON là state mới."""


def llm_state(app: str, example: dict, now: str, llm, extra: str = "") -> dict:
    user = f"App: {app}\nThời điểm hiện tại: {now}\nYêu cầu thêm: {extra or 'không'}\nState mẫu:\n{json.dumps(example, ensure_ascii=False)[:6000]}"
    st, _ = llm_json(llm, LLM_STATE_SYSTEM, user)
    if not isinstance(st, dict) or set(st) != set(example):
        raise ValueError(f"state {app} sai cấu trúc (khoá {sorted(st) if isinstance(st, dict) else type(st)})")
    return st


def make_state(apps: list[str], rng: random.Random, traps: list[str], mode: str = "perturb", llm=None, now: str = "") -> tuple[dict, list[str]]:
    states = {}
    for a in apps:
        if a == "sys":
            continue
        ex = copy.deepcopy(rng.choice(example_states(a)))
        if mode == "llm" and llm is not None and a not in INFO_APPS:
            try:
                ex = llm_state(a, ex, now, llm)
            except (ValueError, json.JSONDecodeError):
                pass
        states[a] = ex
    if mode != "llm":
        states = perturb(states, rng)
    notes = add_traps(states, traps, rng)
    return states, notes
