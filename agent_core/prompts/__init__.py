"""Prompt builder: system prompt (bộ luật + ngữ cảnh) và chuyển history thành message trung lập.

Dùng chung cho suy luận và cho xuất dữ liệu SFT, để định dạng lúc train trùng lúc chạy.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path

from pydantic import BaseModel, Field

from ..registry import register
from ..render import api_name
from ..types import Sample

PROMPT_DIR = Path(__file__).parent
WEEKDAYS = ["thứ Hai", "thứ Ba", "thứ Tư", "thứ Năm", "thứ Sáu", "thứ Bảy", "Chủ nhật"]


def available_rules() -> list[str]:
    return sorted(p.stem for p in PROMPT_DIR.glob("*.md"))


def load_rules(name: str) -> str:
    p = Path(name)
    if not p.is_file():
        p = PROMPT_DIR / f"{name}.md"
    return p.read_text(encoding="utf-8").strip()


def context_block(sample: Sample, app_names: dict[str, str] | None = None) -> str:
    c = sample.context
    lines = ["# Ngữ cảnh"]
    t = c.get("current_time")
    if t:
        try:
            wd = WEEKDAYS[datetime.fromisoformat(t).weekday()]
            lines.append(f"- Thời điểm hiện tại: {t} ({wd}), múi giờ {c.get('timezone', '')}")
        except ValueError:
            lines.append(f"- Thời điểm hiện tại: {t}, múi giờ {c.get('timezone', '')}")
    loc = c.get("location")
    if loc:
        lines.append(f"- Vị trí hiện tại: lat {loc.get('lat')}, lng {loc.get('lng')}")
    up = c.get("user_profile") or {}
    labels = {"name": "Tên người dùng", "home_address": "Địa chỉ nhà", "work_address": "Nơi làm việc", "city": "Thành phố"}
    for k, v in up.items():
        lines.append(f"- {labels.get(k, k)}: {v}")
    apps = sample.installed_apps
    if apps:
        names = [f"{a} ({app_names[a]})" if app_names and a in app_names else a for a in apps]
        lines.append("- App đã cài: " + ", ".join(names))
    return "\n".join(lines)


def history_messages(sample: Sample, transcripts: dict[str, str] | None = None) -> list[dict]:
    """History -> message trung lập. Lượt user lấy transcript ASR theo đường dẫn audio (nếu có), không thì text gốc."""
    transcripts = transcripts or {}
    msgs: list[dict] = []
    for i, t in enumerate(sample.history):
        if t.role == "user":
            text = transcripts.get(t.audio) if t.audio in transcripts else t.text
            msgs.append({"role": "user", "content": text or ""})
            continue
        if t.tool_calls:
            calls = [{"id": f"h{i}_{j}", "name": c["name"], "arguments": c.get("arguments") or {}} for j, c in enumerate(t.tool_calls)]
            msgs.append({"role": "assistant", "content": "", "tool_calls": calls})
            for j, c in enumerate(calls):
                res = t.tool_results[j] if j < len(t.tool_results) else {}
                msgs.append({"role": "tool", "tool_call_id": c["id"], "name": c["name"], "content": json.dumps(res, ensure_ascii=False)})
        msgs.append({"role": "assistant", "content": t.text or ""})
    return msgs


class RulesPromptConfig(BaseModel):
    rules: str = Field("rules_v2", description="Tên bộ luật trong agent_core/prompts/ hoặc đường dẫn file .md")
    few_shot_file: str | None = Field(None, description="File JSONL ví dụ mẫu {utterance, tool_calls} (tuỳ chọn)")
    few_shot_n: int = 0
    include_app_names: bool = True


@register("prompt", "rules", RulesPromptConfig, "Bộ luật hành vi + ngữ cảnh người dùng")
class RulesPrompt:
    def __init__(self, cfg: RulesPromptConfig):
        self.cfg = cfg
        self.rules = load_rules(cfg.rules)
        self.shots = []
        if cfg.few_shot_file and cfg.few_shot_n:
            with open(cfg.few_shot_file, encoding="utf-8") as f:
                self.shots = [json.loads(line) for line in f if line.strip()][: cfg.few_shot_n]

    def system(self, sample: Sample, app_names: dict[str, str] | None = None) -> str:
        parts = [self.rules]
        if self.shots:
            ex = ["# Ví dụ"]
            for s in self.shots:
                calls = " > ".join(f"{api_name(c['name'])}({json.dumps(c.get('arguments', {}), ensure_ascii=False)})" for c in s["tool_calls"]) or "(không gọi tool)"
                ex.append(f"- \"{s['utterance']}\" → {calls}")
            parts.append("\n".join(ex))
        parts.append(context_block(sample, app_names if self.cfg.include_app_names else None))
        return "\n\n".join(parts)

    def messages(self, sample: Sample, transcripts: dict[str, str] | None, final_text: str) -> list[dict]:
        return history_messages(sample, transcripts) + [{"role": "user", "content": final_text}]
