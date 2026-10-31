"""Dữ liệu nền cho sinh dữ liệu: tên người, giọng vùng miền, ngữ cảnh người dùng (lấy từ train), tiện ích JSON."""
from __future__ import annotations

import json
import random
import re
from datetime import datetime, timedelta
from functools import lru_cache

from agent_core.data import load_samples
from lab.core.datasets import train_root

GIVEN_NAMES = ["Lan", "Minh", "Hương", "Tuấn", "Hùng", "Mai", "Long", "Nam", "Hoa", "Trang", "Linh", "Dũng", "Hà", "Thảo", "Phương",
               "Quân", "Hải", "Yến", "Nhi", "Khoa", "Bình", "An", "Vy", "Đức", "Thắng", "Ngọc", "Trâm", "Duy", "Phúc", "Hạnh",
               "Sơn", "Tâm", "Huy", "Loan", "Cường", "Kiên", "Thư", "Oanh", "Vinh", "Tú", "Hiền", "Quỳnh", "Lộc", "Giang", "Thủy",
               "Hưng", "Tiến", "My", "Châu", "Đạt", "Uyên", "Bảo", "Nga", "Toàn", "Khánh", "Chi", "Phong", "Tùng", "Diệp", "Hậu"]
FAMILY_NAMES = ["Nguyễn", "Trần", "Lê", "Phạm", "Hoàng", "Huỳnh", "Phan", "Vũ", "Võ", "Đặng", "Bùi", "Đỗ", "Hồ", "Ngô", "Dương", "Lý"]
FOREIGN_NAMES = ["David", "Liam Porter", "Grace Nakamura", "Jonas Berg", "Priya Sharma", "Michael Chen", "Sophie Martin", "Nathan Reed"]

REGIONS = {
    "bac": "giọng miền Bắc (dùng từ: nhé, ạ, thế, đấy, nhỉ, bây giờ, cái này)",
    "trung": "giọng miền Trung (dùng từ địa phương: ni, nớ, răng, rứa, hỉ, mô, tê, chừ, nghe)",
    "nam": "giọng miền Nam (dùng từ: nha, nghen, hen, dùm, giùm, bữa nay, tui, ổng, bả, nè, hông)",
}
STYLES = [
    "nói tự nhiên, ngắn gọn",
    "có từ đệm (ờ, à, ừm) và hơi dài dòng",
    "lịch sự, xưng hô với trợ lý là em",
    "vội vàng, cụt lủn",
    "đọc số bằng chữ (ví dụ 'ba trăm rưỡi', 'sáu giờ rưỡi')",
    "chêm vài từ tiếng Anh thông dụng (book, check, cancel, AC, voucher, meeting)",
    "người lớn tuổi xưng cô/chú, gọi trợ lý là con",
]


@lru_cache(maxsize=1)
def train_contexts() -> list[dict]:
    """Ngữ cảnh người dùng (profile, vị trí, múi giờ) lấy từ train — tái sử dụng hợp lệ."""
    seen, out = set(), []
    for s in load_samples(train_root(), "train"):
        c = s.context
        key = json.dumps(c.get("user_profile"), ensure_ascii=False, sort_keys=True)
        if key not in seen:
            seen.add(key)
            out.append({"timezone": c.get("timezone", "Asia/Ho_Chi_Minh"), "location": c.get("location"), "user_profile": c.get("user_profile")})
    return out


def random_time(rng: random.Random) -> str:
    start = datetime(2026, 9, 15, 6, 0)
    d = start + timedelta(days=rng.randint(0, 100), minutes=5 * rng.randint(0, 12 * 16))
    return d.strftime("%Y-%m-%dT%H:%M:00+07:00")


def extract_json(text: str):
    """Lấy JSON đầu tiên trong text (chấp nhận khối ```json ...```)."""
    if not text:
        raise ValueError("phản hồi rỗng")
    m = re.search(r"```(?:json)?\s*(.*?)```", text, re.S)
    if m:
        text = m.group(1)
    text = text.strip()
    for opener, closer in (("{", "}"), ("[", "]")):
        i = text.find(opener)
        j = text.rfind(closer)
        if i != -1 and j > i:
            try:
                return json.loads(text[i:j + 1])
            except json.JSONDecodeError:
                continue
    return json.loads(text)


def llm_json(llm, system: str, user: str, retries: int = 2):
    """Gọi LLM (không tool) và parse JSON; thử lại khi lỗi parse."""
    msgs = [{"role": "user", "content": user}]
    last = None
    for _ in range(retries + 1):
        r = llm.complete(system, msgs)
        try:
            return extract_json(r.text), r
        except (ValueError, json.JSONDecodeError) as e:
            last = e
            msgs = msgs + [{"role": "assistant", "content": r.text or "(rỗng)"},
                           {"role": "user", "content": "Phản hồi chưa phải JSON hợp lệ. Chỉ trả về đúng một đối tượng JSON."}]
    raise ValueError(f"LLM không trả JSON hợp lệ: {last}")
