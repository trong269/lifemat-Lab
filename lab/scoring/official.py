"""Scorer theo công thức BTC.

    gold rỗng       -> 1 nếu dự đoán rỗng, ngược lại 0
    hash khác gold  -> 0
    ngược lại       -> F1 với P = M/(M+U), R = M/|G|; M = số cặp khớp (ghép cực đại), U = call dự đoán không ghép được
    (call bị từ chối vẫn nằm trong danh sách dự đoán nên tính vào U)

Một call khớp call gold khi: cùng tên; mọi tham số không fuzzy giống hệt; mọi tham số fuzzy có token-F1 > 0.6
(lowercase + Unicode NFC). Các điểm luật chưa nói rõ được hiệu chỉnh theo leaderboard public (30/10/2026):
- tham số thừa (bài nộp có, gold không) KHÔNG làm call trượt: bật/tắt strip_read_filters lẽ ra chênh ~+18 điểm nếu tính
  là sai, thực tế leaderboard -0.48;
- tham số không fuzzy so KHÔNG phân biệt hoa/thường: bật/tắt restore_case lẽ ra chênh ~+0.5 điểm, thực tế 0.00.
Cách chấm chặt theo đúng chữ của luật được tính kèm thành điểm tham khảo (ALT_VARIANTS).
"""
from __future__ import annotations

import json
import re
import unicodedata
from collections import Counter
from dataclasses import dataclass, field


@dataclass
class ScoreOptions:
    fuzzy_threshold: float = 0.6
    strict_keys: bool = False         # False: chỉ xét tham số có trong gold (thừa không sao, thiếu vẫn sai) — khớp leaderboard
    list_as_set: bool = False         # so list không theo thứ tự
    token_regex: bool = False         # tách token theo chữ/số (bỏ dấu câu) thay vì theo khoảng trắng
    case_insensitive: bool = True     # chuỗi không fuzzy: bỏ qua hoa/thường, gộp khoảng trắng (như zaic_tools khi tính hash) — khớp leaderboard


# Các cách hiểu khác của những điểm luật chưa nói rõ: luôn được tính kèm để thấy khoảng không chắc chắn.
ALT_VARIANTS = {
    "strict_keys": {"strict_keys": True},                                   # tham số thừa cũng tính là sai
    "case_sensitive": {"case_insensitive": False},                          # phân biệt hoa/thường
    "literal": {"strict_keys": True, "case_insensitive": False},            # đúng từng chữ của luật (cả hai)
}


def fuzzy_params_from_catalog(catalog: dict) -> dict[str, set[str]]:
    out = {}
    for a in catalog.get("apps", []):
        for t in a.get("tools", []):
            props = t.get("parameters", {}).get("properties", {})
            out[t["name"]] = {k for k, v in props.items() if v.get("x-match") == "fuzzy"}
    return out


def _tokens(s, opts: ScoreOptions) -> list[str]:
    s = unicodedata.normalize("NFC", str(s)).lower()
    return re.findall(r"\w+", s) if opts.token_regex else s.split()


def token_f1(a, b, opts: ScoreOptions = ScoreOptions()) -> float:
    ta, tb = _tokens(a, opts), _tokens(b, opts)
    if not ta and not tb:
        return 1.0
    if not ta or not tb:
        return 0.0
    common = sum((Counter(ta) & Counter(tb)).values())
    if common == 0:
        return 0.0
    p, r = common / len(ta), common / len(tb)
    return 2 * p * r / (p + r)


_NUM_UNIT = re.compile(r"(\d)\s+(?=[^\W\d_])")


def _canon(v):
    """Chuẩn hoá chuỗi (kể cả lồng trong list/dict): NFC, chữ thường, gộp khoảng trắng, bỏ khoảng trắng giữa số và đơn vị."""
    if isinstance(v, str):
        return _NUM_UNIT.sub(r"\1", " ".join(unicodedata.normalize("NFC", v).lower().split()))
    if isinstance(v, list):
        return [_canon(x) for x in v]
    if isinstance(v, dict):
        return {k: _canon(x) for k, x in v.items()}
    return v


def _norm_val(v, opts: ScoreOptions):
    if opts.case_insensitive:
        v = _canon(v)
    if isinstance(v, list) and opts.list_as_set:
        return sorted(json.dumps(x, sort_keys=True, ensure_ascii=False) for x in v)
    return v


def _same(a, b) -> bool:
    """So theo giá trị như phép == của Python (1 == 1.0, dict không xét thứ tự khoá, list xét thứ tự),
    nhưng bool khác số (True != 1) và số khác chuỗi ("1" != 1)."""
    if isinstance(a, bool) or isinstance(b, bool):
        return type(a) is type(b) and a == b
    if isinstance(a, dict) and isinstance(b, dict):
        return a.keys() == b.keys() and all(_same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(_same(x, y) for x, y in zip(a, b))
    return a == b


def arg_diff(pred: dict, gold: dict, fuzzy: set[str], opts: ScoreOptions) -> dict:
    """{key: reason} cho các tham số không khớp. Rỗng = khớp."""
    pa, ga = pred.get("arguments") or {}, gold.get("arguments") or {}
    diff = {}
    keys = set(pa) | set(ga) if opts.strict_keys else set(ga)
    for k in keys:
        if k not in pa:
            diff[k] = "thiếu"
        elif k not in ga:
            diff[k] = "thừa"
        elif k in fuzzy:
            f = token_f1(pa[k], ga[k], opts)
            if not f > opts.fuzzy_threshold:
                diff[k] = f"fuzzy {f:.2f}"
        elif not _same(_norm_val(pa[k], opts), _norm_val(ga[k], opts)):
            diff[k] = "khác"
    return diff


def calls_match(pred: dict, gold: dict, fuzzy_map: dict[str, set[str]], opts: ScoreOptions) -> bool:
    return pred.get("name") == gold.get("name") and not arg_diff(pred, gold, fuzzy_map.get(gold.get("name"), set()), opts)


def max_matching(pred: list[dict], gold: list[dict], fuzzy_map, opts) -> list[tuple[int, int]]:
    adj = [[j for j, g in enumerate(gold) if calls_match(p, g, fuzzy_map, opts)] for p in pred]
    match_g = [-1] * len(gold)

    def try_assign(i, seen):
        for j in adj[i]:
            if j in seen:
                continue
            seen.add(j)
            if match_g[j] == -1 or try_assign(match_g[j], seen):
                match_g[j] = i
                return True
        return False

    for i in range(len(pred)):
        try_assign(i, set())
    return [(i, j) for j, i in enumerate(match_g) if i != -1]


@dataclass
class SampleScore:
    score: float
    hash_ok: bool
    M: int
    U: int
    G: int
    P: float
    R: float
    f1_nohash: float
    matches: list = field(default_factory=list)

    def as_dict(self):
        return dict(self.__dict__)


def score_sample(pred_calls: list[dict], pred_hash: str | None, gold_calls: list[dict], gold_hash: str | None,
                 fuzzy_map: dict[str, set[str]], opts: ScoreOptions = ScoreOptions()) -> SampleScore:
    pred_calls = [{"name": c.get("name"), "arguments": c.get("arguments") or {}} for c in pred_calls]
    if not gold_calls:
        ok = len(pred_calls) == 0
        return SampleScore(float(ok), pred_hash == gold_hash, 0, len(pred_calls), 0, float(ok), float(ok), float(ok))
    m = max_matching(pred_calls, gold_calls, fuzzy_map, opts)
    M, U, G = len(m), len(pred_calls) - len(m), len(gold_calls)
    P = M / (M + U) if M + U else 0.0
    R = M / G if G else 0.0
    f1 = 2 * P * R / (P + R) if M else 0.0
    hash_ok = pred_hash == gold_hash
    return SampleScore(f1 if hash_ok else 0.0, hash_ok, M, U, G, P, R, f1, m)


def alt_scores(pred_calls, pred_hash, gold_calls, gold_hash, fuzzy_map, opts: ScoreOptions) -> dict:
    """Điểm của mẫu theo từng cách hiểu khác (giữ các tuỳ chọn còn lại của opts)."""
    return {k: score_sample(pred_calls, pred_hash, gold_calls, gold_hash, fuzzy_map, ScoreOptions(**{**opts.__dict__, **ov})).score
            for k, ov in ALT_VARIANTS.items()}
