"""Chỉ số ASR: WER/CER sau chuẩn hoá, và tỉ lệ giữ đúng thực thể (số, giờ, tên riêng)."""
from __future__ import annotations

import re
import unicodedata

from agent_core.vi_numbers import convert


def normalize(s: str, numbers: bool = True) -> str:
    s = unicodedata.normalize("NFC", s or "").lower()
    if numbers:
        s = convert(s, aggressive=True)
    s = re.sub(r"(\d)[.,](\d{3})", r"\1\2", s)          # 1.000.000 -> 1000000
    s = re.sub(r"[^\w\s:]", " ", s)
    return " ".join(s.split())


def edit_distance(a: list, b: list) -> int:
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i] + [0] * len(b)
        for j, y in enumerate(b, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y))
        prev = cur
    return prev[-1]


def wer(ref: str, hyp: str) -> tuple[int, int]:
    r, h = normalize(ref).split(), normalize(hyp).split()
    return edit_distance(r, h), len(r)


def cer(ref: str, hyp: str) -> tuple[int, int]:
    r, h = normalize(ref).replace(" ", ""), normalize(hyp).replace(" ", "")
    return edit_distance(list(r), list(h)), len(r)


def entities(text: str) -> list[str]:
    """Số (sau chuẩn hoá), giờ dạng 7:30, và cụm tên riêng viết hoa (không tính từ đầu câu)."""
    out = re.findall(r"\d+(?::\d+)?", normalize(text))
    words = re.findall(r"\w+", unicodedata.normalize("NFC", text or ""))
    run = []
    for i, w in enumerate(words):
        if w[:1].isupper() and i > 0:
            run.append(w.lower())
        else:
            if run:
                out.append(" ".join(run))
            run = []
    if run:
        out.append(" ".join(run))
    return out


def entity_recall(ref: str, hyp: str) -> tuple[int, int]:
    ents = entities(ref)
    h = normalize(hyp)
    return sum(1 for e in ents if e in h), len(ents)


def utterance_metrics(ref: str, hyp: str) -> dict:
    we, wn = wer(ref, hyp)
    ce, cn = cer(ref, hyp)
    eh, en = entity_recall(ref, hyp)
    return {"w_err": we, "w_n": wn, "c_err": ce, "c_n": cn, "e_hit": eh, "e_n": en, "exact": normalize(ref) == normalize(hyp)}
