"""App Factory: teacher thiết kế app mới (catalog + code Python trên base.App + state mẫu + call kiểm thử), sau đó chạy kiểm thử tự động.

App chỉ có ở public_test và app đã có trong train đều bị chặn. App đã duyệt nằm ở lab_data/apps/<app_id>/ và được chép vào
zaic_tools của các split tổng hợp chọn dùng nó.
"""
from __future__ import annotations

import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

from lab.core.datasets import train_root
from lab.core.paths import APPS, PUBLIC_ONLY_APPS

from .common import llm_json
from .split import base_catalog

EXAMPLE_APPS = ["door_lock", "shopping_list", "library"]

IDEAS = ["đặt phòng khách sạn", "đặt lịch khám bệnh", "tra cứu phạt nguội giao thông", "lưu trữ và chia sẻ file đám mây",
         "kết quả và lịch thi đấu thể thao", "danh sách phim muốn xem", "chuyển tiền quốc tế", "camera an ninh nhận diện khách",
         "chăm sóc thú cưng (lịch tiêm, cho ăn)", "bảo dưỡng xe máy/ô tô", "quản lý chi tiêu cá nhân", "đặt bàn nhà hàng",
         "thuê xe tự lái", "vé xem phim", "đặt lịch cắt tóc/spa", "bảo hiểm", "nộp thuế/phí", "điểm danh và học bạ của con"]

SYSTEM = """Bạn là kỹ sư thiết kế app giả lập cho bộ dữ liệu trợ lý giọng nói tiếng Việt (ZAC LifeMate).
Thiết kế MỘT app mới theo ý tưởng được giao, đúng chuẩn của các app mẫu:
- spec: {"id", "name_vi", "group", "description", "tools": [{"name": "<id>.<tool>", "kind": "read"|"write", "description", "parameters": JSON Schema
  (type object, properties, required; tham số là ID lấy từ dữ liệu thì thêm "x-ref": "<id>.<collection>"; văn bản tự do thêm "x-match": "fuzzy"),
  "returns": "", "app": "<id>"}]}. 2-5 tool, có ít nhất 1 read và 1 write.
- code: module Python định nghĩa class kế thừa App (from .base import App, read, write), name = "<id>", mỗi tool một method
  nhận đúng tên tham số làm keyword (mặc định None) và **_; dùng self.read / self.create / self.patch / self.delete / self.find / self.noop
  như app mẫu; không import thư viện ngoài; trả dict JSON.
- example_state: state mẫu tiếng Việt (3-8 phần tử mỗi collection, ID dạng tiền_tố_01).
- test_calls: 4-8 call kiểm thử [{"name", "arguments"}] dùng ID có trong example_state, gồm cả read và write.
Trả về đúng một JSON {"app_id", "spec", "code", "example_state", "test_calls"}."""


def _examples() -> str:
    cat = {a["id"]: a for a in base_catalog()["apps"]}
    from .state_gen import train_app_states

    out = []
    for a in EXAMPLE_APPS:
        code = (train_root() / "train" / "zaic_tools" / "apps" / f"{a}.py").read_text(encoding="utf-8")
        st = (train_app_states().get(a) or [{}])[0]
        out.append(f"### App mẫu {a}\nspec: {json.dumps(cat.get(a), ensure_ascii=False)}\ncode:\n{code}\nstate: {json.dumps(st, ensure_ascii=False)[:1500]}")
    base = (train_root() / "train" / "zaic_tools" / "apps" / "base.py").read_text(encoding="utf-8")
    return "### base.py\n" + base[:6000] + "\n\n" + "\n\n".join(out)


def validate_app(app: dict) -> list[str]:
    errs = []
    aid = app.get("app_id") or ""
    if not re.fullmatch(r"[a-z][a-z0-9_]{2,30}", aid):
        errs.append("app_id phải dạng snake_case")
    if aid in PUBLIC_ONLY_APPS:
        errs.append(f"{aid} là app chỉ có ở public_test — không được dùng")
    if aid in {a["id"] for a in base_catalog()["apps"]}:
        errs.append(f"{aid} đã có trong train")
    spec = app.get("spec") or {}
    if spec.get("id") != aid:
        errs.append("spec.id phải trùng app_id")
    for t in spec.get("tools", []):
        if not t.get("name", "").startswith(aid + "."):
            errs.append(f"tool {t.get('name')} phải bắt đầu bằng {aid}.")
        t.setdefault("app", aid)
        t.setdefault("returns", "")
    if f'name = "{aid}"' not in (app.get("code") or "") and f"name = '{aid}'" not in (app.get("code") or ""):
        errs.append(f'code phải có name = "{aid}"')
    return errs


def generate_app(idea: str, llm) -> dict:
    user = f"Ý tưởng app: {idea}\n\n{_examples()}"
    app, resp = llm_json(llm, SYSTEM, user)
    return app


def run_app_test(app: dict) -> dict:
    """Chạy trong tiến trình riêng: nạp bản sao zaic_tools của train + module app mới, chạy test_calls trên example_state."""
    aid = app["app_id"]
    tmp = Path(tempfile.mkdtemp(prefix="appt_"))
    try:
        shutil.copytree(train_root() / "train" / "zaic_tools", tmp / "zaic_tools", ignore=shutil.ignore_patterns("__pycache__"))
        (tmp / "zaic_tools" / "apps" / f"{aid}.py").write_text(app["code"], encoding="utf-8")
        sys.path.insert(0, str(tmp))
        import zaic_tools  # noqa: F401  (bản tạm)
        from zaic_tools.apps import APPS as ZAPPS, TOOLS as ZTOOLS

        report = {"passed": True, "errors": [], "calls": []}
        if aid not in ZAPPS:
            report["errors"].append(f"không tìm thấy class App có name = '{aid}'")
        spec_tools = {t["name"]: t for t in app["spec"].get("tools", [])}
        for n, t in spec_tools.items():
            if n not in ZTOOLS:
                report["errors"].append(f"tool {n} chưa có method")
            elif ZTOOLS[n] != t.get("kind"):
                report["errors"].append(f"tool {n}: kind trong code ({ZTOOLS[n]}) khác spec ({t.get('kind')})")
        cat = base_catalog()
        cat["apps"].append(app["spec"])
        entry = {"_meta": {"question_id": "t", "current_time": "2026-11-20T09:00:00+07:00", "tools": list(spec_tools)},
                 aid: json.loads(json.dumps(app["example_state"]))}
        sess = zaic_tools.Session("t", entry, cat)
        for c in app.get("test_calls") or []:
            r = sess.call(c["name"], c.get("arguments") or {})
            bad = r.get("ok") is False or (isinstance(r.get("message"), str) and re.match(r"^[A-Z]\w*(Error|Exception):", r["message"]))
            report["calls"].append({"call": c, "result": r, "ok": not bad})
            if bad:
                report["errors"].append(f"{c['name']}: {r.get('error') or r.get('message')}")
        if not report["calls"]:
            report["errors"].append("không có test_calls")
        report["passed"] = not report["errors"]
        return report
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def approve(app: dict):
    d = APPS / app["app_id"]
    d.mkdir(parents=True, exist_ok=True)
    (d / "spec.json").write_text(json.dumps(app["spec"], ensure_ascii=False, indent=1), encoding="utf-8")
    (d / "module.py").write_text(app["code"], encoding="utf-8")
    (d / "example_state.json").write_text(json.dumps(app["example_state"], ensure_ascii=False, indent=1), encoding="utf-8")
    (d / "APPROVED").write_text("ok")


def unapprove(app_id: str):
    p = APPS / app_id / "APPROVED"
    if p.exists():
        p.unlink()
