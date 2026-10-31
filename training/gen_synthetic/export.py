"""Xuất dữ liệu huấn luyện.

- SFT: JSONL dạng OpenAI {"messages": [...], "tools": [...]} dựng bằng CHÍNH renderer + prompt builder của agent_core,
  mỗi tool call một lượt assistant (giống vòng lặp ReAct lúc suy luận), kết thúc bằng một câu trả lời ngắn.
- ASR manifest: {"audio_filepath", "text", "duration"} cho mọi lượt user có file audio.
Dataset public_test không bao giờ được xuất (luật thi).
"""
from __future__ import annotations

import json
import random
import re
from pathlib import Path

from pydantic import BaseModel, Field

from agent_core.asr import audio_seconds
from agent_core.data import catalog_tools, load_catalog, sample_from_dict
from agent_core.llm.openai_compat import to_openai
from agent_core.registry import build
from agent_core.render import api_name

APP_ALIASES = {"smart_home": ["home_iot", "nha_thong_minh", "smarthome"], "contacts": ["phonebook", "danh_ba"], "sms": ["text_message", "tin_nhan"],
               "calendar": ["lich", "schedule"], "reminders": ["nhac_viec", "reminder_app"], "banking": ["bank", "ngan_hang"],
               "ewallet": ["vi_dien_tu", "wallet"], "alarm": ["bao_thuc", "clock"], "chat_ott": ["messenger", "zalo_chat"],
               "bill_payment": ["hoa_don", "bills"], "food_delivery": ["giao_do_an", "food"], "ride_hailing": ["dat_xe", "ride"]}


class ExportOptions(BaseModel):
    kind: str = Field("sft", description="sft | asr_manifest")
    renderer: dict | str = "compact"
    prompt: dict | str = Field(default_factory=lambda: {"plugin": "rules", "rules": "rules_v2"})
    final_text: str = "Đã xong."
    mutate_ratio: float = Field(0.0, ge=0, le=1, description="Tỉ lệ mẫu đổi tên app/tool (chống học thuộc)")
    shuffle: bool = True
    seed: int = 0


def _mutate(example: dict, rng: random.Random, apps: list[str]) -> dict:
    s = json.dumps(example, ensure_ascii=False)
    for a in apps:
        if a == "sys":
            continue
        alias = rng.choice(APP_ALIASES.get(a, [a + "_app", a + "_v2", "my_" + a]))
        s = re.sub(rf"\b{re.escape(a)}__", alias + "__", s)
        s = re.sub(rf"\b{re.escape(a)}\.", alias + ".", s)
        s = re.sub(rf"\b{re.escape(a)} \(", alias + " (", s)
    return json.loads(s)


def sft_example(rec: dict, split: str, tools: dict, app_names: dict, renderer, prompt, final_text: str) -> dict | None:
    lab = rec.get("label")
    if lab is None:
        return None
    s = sample_from_dict(rec, split)
    specs = renderer.render(tools, s.allowed_tools())
    system = prompt.system(s, app_names)
    msgs = prompt.messages(s, None, s.audio_text or "")
    for i, (c, r) in enumerate(zip(lab.get("tool_calls") or [], lab.get("tool_results") or [])):
        cid = f"call_{i}"
        msgs.append({"role": "assistant", "content": "", "tool_calls": [{"id": cid, "name": c["name"], "arguments": c.get("arguments") or {}}]})
        msgs.append({"role": "tool", "tool_call_id": cid, "content": json.dumps(r, ensure_ascii=False)})
    msgs.append({"role": "assistant", "content": (rec.get("meta") or {}).get("final_text") or final_text})
    return {"id": rec["id"], "messages": to_openai(system, msgs),
            "tools": [{"type": "function", "function": {"name": t.api_name, "description": t.description, "parameters": t.parameters}} for t in specs]}


def export(components: list[dict], out_dir: Path, opts: ExportOptions, record_source) -> dict:
    """components: [{"dataset_id", "root", "split", "records": [...], "weight": float}] — record_source đã lọc theo trạng thái duyệt."""
    out_dir.mkdir(parents=True, exist_ok=True)
    rng = random.Random(opts.seed)
    renderer, prompt = build("renderer", opts.renderer), build("prompt", opts.prompt)
    rows, stats = [], {"by_dataset": {}, "mutated": 0}
    for comp in components:
        if comp["split"] == "public_test" or "public" in comp["split"]:
            raise ValueError("không được xuất dữ liệu public_test")
        root, split = comp["root"], comp["split"]
        cat = load_catalog(root, split)
        tools = catalog_tools(cat)
        app_names = {a["id"]: a.get("name_vi", a["id"]) for a in cat["apps"]}
        recs = record_source(comp)
        w = comp.get("weight", 1.0)
        reps = int(w) + (1 if rng.random() < (w - int(w)) else 0) if w >= 1 else None
        if reps is None:
            recs = [r for r in recs if rng.random() < w]
            reps = 1
        n = 0
        for rec in recs:
            if opts.kind == "asr_manifest":
                split_dir = Path(root) / split
                turns = [(t.get("audio"), t.get("audio_text")) for t in rec.get("history", []) if t.get("role") == "user"]
                turns.append((rec.get("audio"), rec.get("audio_text")))
                for a, txt in turns:
                    if a and txt and (split_dir / a).is_file():
                        for _ in range(reps):
                            rows.append({"audio_filepath": str((split_dir / a).resolve()), "text": txt,
                                         "duration": round(audio_seconds(split_dir / a), 3), "dataset": comp["dataset_id"]})
                            n += 1
                continue
            ex = sft_example(rec, split, tools, app_names, renderer, prompt, opts.final_text)
            if ex is None:
                continue
            for _ in range(reps):
                e = ex
                if opts.mutate_ratio and rng.random() < opts.mutate_ratio:
                    e = _mutate(ex, rng, list(rec["context"]["installed_apps"]))
                    stats["mutated"] += 1
                rows.append({**e, "dataset": comp["dataset_id"]})
                n += 1
        stats["by_dataset"][comp["dataset_id"]] = n
    if opts.shuffle:
        rng.shuffle(rows)
    fname = "sft.jsonl" if opts.kind == "sft" else "asr_manifest.jsonl"
    with open(out_dir / fname, "w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    stats["n"] = len(rows)
    stats["file"] = str(out_dir / fname)
    (out_dir / "stats.json").write_text(json.dumps({"options": opts.model_dump(), **stats}, ensure_ascii=False, indent=1))
    return stats


_ = api_name  # re-exported for scripts
