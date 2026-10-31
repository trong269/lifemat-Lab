"""Pipeline một mẫu: ASR (mọi lượt user) -> hậu xử lý -> prompt -> agent trên ToolEnv -> trace."""
from __future__ import annotations

import time
from pathlib import Path

from pydantic import BaseModel, Field

from .agent import Deadline
from .data import catalog_tools, load_catalog
from .guards import DEFAULT_GUARDS
from .registry import build
from .types import Sample


class PipelineConfig(BaseModel):
    asr: dict | str = Field(default_factory=lambda: {"plugin": "gold"})
    postprocess: list[dict | str] = Field(default_factory=list)
    llm: dict | str = Field(default_factory=lambda: {"plugin": "oracle"})
    renderer: dict | str = "compact"
    prompt: dict | str = Field(default_factory=lambda: {"plugin": "rules"})
    agent: dict | str = "react"
    guards: list[dict | str] = Field(default_factory=lambda: list(DEFAULT_GUARDS))
    timeout_s: float = Field(30.0, description="Ngân sách thời gian mỗi mẫu (ASR + agent)")


class Pipeline:
    def __init__(self, cfg: PipelineConfig, root: str | Path, split: str, llm=None, asr=None):
        self.cfg = cfg
        self.root, self.split = Path(root), split
        self.split_dir = self.root / split
        self.catalog = load_catalog(root, split)
        self.tools = catalog_tools(self.catalog)
        self.app_names = {a["id"]: a.get("name_vi", a["id"]) for a in self.catalog.get("apps", [])}
        self.asr = asr or build("asr", cfg.asr)
        self.post = [build("postprocess", p) for p in cfg.postprocess]
        self.llm = llm or build("llm", cfg.llm)
        self.renderer = build("renderer", cfg.renderer)
        self.prompt = build("prompt", cfg.prompt)
        self.agent = build("agent", cfg.agent)
        self.guards = [build("guard", g) for g in cfg.guards]

    def transcripts(self, sample: Sample) -> tuple[dict, dict]:
        raw = self.asr.transcribe_sample(sample, self.split_dir)
        texts = {}
        for rel, r in raw.items():
            t = r.get("text") or ""
            for p in self.post:
                t = p.apply(t)
            texts[rel] = t
        return raw, texts

    def build_prompt(self, sample: Sample, texts: dict) -> tuple[str, list[dict], list]:
        final = texts.get(sample.audio) if sample.audio in texts else (sample.audio_text or "")
        specs = self.renderer.render(self.tools, sample.allowed_tools())
        system = self.prompt.system(sample, self.app_names)
        msgs = self.prompt.messages(sample, texts, final)
        return system, msgs, specs

    def run(self, sample: Sample, env, on_call=None) -> dict:
        t0 = time.time()
        deadline = Deadline(self.cfg.timeout_s)
        raw, texts = self.transcripts(sample)
        t_asr = time.time() - t0
        system, msgs, specs = self.build_prompt(sample, texts)
        trace = self.agent.run(sample, env, self.llm, system, msgs, specs, self.tools, self.guards, deadline, on_call=on_call)
        return {"asr": raw, "transcripts": texts, "trace": trace, "time_asr_s": round(t_asr, 3), "time_total_s": round(time.time() - t0, 3)}
