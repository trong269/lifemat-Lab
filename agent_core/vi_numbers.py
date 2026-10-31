"""Chuyển số đọc bằng chữ tiếng Việt sang chữ số (thận trọng: chỉ đổi khi chắc là số).

    "ba trăm rưỡi" -> "350", "hai mươi lăm" -> "25", "sáu giờ rưỡi" -> "6 giờ rưỡi", "hai triệu" -> "2000000"
"""
from __future__ import annotations

import re

DIGITS = {"không": 0, "một": 1, "mốt": 1, "hai": 2, "ba": 3, "bốn": 4, "tư": 4, "năm": 5, "lăm": 5, "nhăm": 5,
          "sáu": 6, "bảy": 7, "bẩy": 7, "tám": 8, "chín": 9}
SCALES = {"nghìn": 1000, "ngàn": 1000, "triệu": 10**6, "tỷ": 10**9, "tỉ": 10**9}
NUM_WORDS = set(DIGITS) | set(SCALES) | {"mười", "mươi", "trăm", "linh", "lẻ", "rưỡi"}
# a lone word that is more often not a number
AMBIGUOUS_ALONE = {"năm", "một", "tư", "ba", "bảy", "mốt", "lăm", "không", "linh", "lẻ", "rưỡi", "mươi", "trăm", "nghìn", "ngàn", "triệu", "tỷ", "tỉ"}


def parse_number(words: list[str]) -> int | str | None:
    """Đổi một chuỗi từ chỉ số thành số. Chuỗi toàn chữ số đơn ("không chín ba năm") -> chuỗi chữ số "0935"
    (số điện thoại, mã); hai chữ số liền nhau trước hàng ("hai sáu ngàn") là cách nói tắt -> 26 nghìn."""
    if len(words) >= 2 and all(w in DIGITS for w in words):
        return "".join(str(DIGITS[w]) for w in words)
    # "một triệu hai" = 1,2 triệu; "hai nghìn tư" = 2 400: một chữ số đứng cuối ngay sau hàng nghìn/triệu/tỷ
    if len(words) >= 3 and words[-2] in SCALES and (words[-1] in DIGITS or words[-1].isdigit()) and len(words[-1]) <= 4:
        head = parse_number(words[:-1])
        tail = DIGITS[words[-1]] if words[-1] in DIGITS else int(words[-1])
        if isinstance(head, int) and tail < 10:
            return head + tail * SCALES[words[-2]] // 10
    total, group, last, last_unit = 0, 0, None, 1
    for w in words:
        if w.isdigit():                                   # chữ số viết sẵn lẫn trong chữ: "1 triệu 2", "26 nghìn"
            last = int(w) if last is None else int(str(last) + w)
        elif w in DIGITS:
            last = DIGITS[w] if last is None else last * 10 + DIGITS[w]
        elif w == "mười":
            group += 10
            last_unit = 10
        elif w == "mươi":
            group += (last or 0) * 10
            last, last_unit = None, 10
        elif w == "trăm":
            group += (last if last is not None else 1) * 100
            last, last_unit = None, 100
        elif w in ("linh", "lẻ"):
            continue
        elif w in SCALES:
            group += last or 0
            last = None
            total += (group or 1) * SCALES[w]
            group, last_unit = 0, SCALES[w]
        elif w == "rưỡi":
            group += last or 0
            last = None
            total += (group if last_unit >= 1000 and group == 0 else 0)
            total += last_unit // 2 if last_unit >= 10 else 0
            last_unit = 1
        else:
            return None
    return total + group + (last or 0)


def convert(text: str, aggressive: bool = False) -> str:
    """aggressive=True (dùng khi tính WER): đổi cả số đứng một mình ("bảy giờ" -> "7 giờ") để hai cách viết
    số được so như nhau; aggressive=False (đưa cho LLM): giữ các từ đứng một mình dễ nhầm nghĩa ("năm nay")."""
    toks = re.split(r"(\s+)", text)
    out, i = [], 0
    while i < len(toks):
        w = toks[i].lower()
        nxt = next((t.lower() for t in toks[i + 1:] if t.strip()), "")
        starts_digit = w.isdigit() and len(w) <= 4 and nxt in NUM_WORDS      # "1 triệu 2", "26 nghìn"
        if (w in NUM_WORDS and w not in ("rưỡi", "linh", "lẻ", "mươi")) or starts_digit:
            j, run = i, []
            while j < len(toks):
                lw = toks[j].lower()
                if lw.strip() == "":
                    j += 1
                    continue
                if lw in NUM_WORDS or (lw.isdigit() and len(lw) <= 4):
                    run.append((j, lw))
                    j += 1
                else:
                    break
            words = [w for _, w in run]
            # "sáu giờ rưỡi": keep rưỡi out of a run that has no scale
            while words and words[-1] == "rưỡi" and not any(x in ("trăm", "mươi", "mười") or x in SCALES for x in words[:-1]):
                words.pop()
                run.pop()
            if (len(words) == 1 and words[0] in AMBIGUOUS_ALONE and not (aggressive and words[0] in DIGITS)) \
                    or not any(x in DIGITS or x == "mười" or x in SCALES or x in ("trăm", "mươi") for x in words) \
                    or all(x.isdigit() for x in words):
                out.append(toks[i])
                i += 1
                continue
            val = parse_number(words) if words else None
            if val is None:
                out.append(toks[i])
                i += 1
                continue
            out.append(str(val))
            end = run[-1][0] + 1
            i = end
            continue
        out.append(toks[i])
        i += 1
    return "".join(out)
