"""Cấu hình thử nghiệm (YAML/JSON) -> spec cho worker."""
from __future__ import annotations

from pathlib import Path

from pydantic import BaseModel, Field

from agent_core.asr import audio_seconds
from agent_core.data import catalog_tools, load_catalog
from agent_core.guards import DEFAULT_GUARDS
from agent_core.pipeline import PipelineConfig
from agent_core.registry import build

from . import datasets, models


class ExperimentConfig(BaseModel):
    name: str = "Thử nghiệm"
    mode: str = Field("full", description="full = ASR + agent; asr_only = chỉ chạy ASR để đo WER")
    dataset: str = Field("train", description="ID dataset")
    sample_ids: list[str] | None = Field(None, description="Chỉ chạy các mẫu này (tuỳ chọn)")
    limit: int = Field(0, description="Chỉ chạy N mẫu đầu (0 = tất cả)")
    asr_model: str = Field("gold-asr", description="ID model ASR trong registry")
    asr_overrides: dict = Field(default_factory=dict)
    postprocess: list[dict | str] = Field(default_factory=list)
    llm_model: str = Field("oracle", description="ID model LLM trong registry")
    llm_overrides: dict = Field(default_factory=dict, description="Ghi đè tham số model cho riêng thử nghiệm này")
    renderer: dict | str = "compact"
    prompt: dict | str = Field(default_factory=lambda: {"plugin": "rules", "rules": "rules_v2"})
    agent: dict | str = Field(default_factory=lambda: {"plugin": "react", "max_steps": 10})
    guards: list[dict | str] = Field(default_factory=lambda: list(DEFAULT_GUARDS))
    timeout_s: float = Field(30.0, description="Ngân sách thời gian mỗi mẫu (luật thi: 30s)")
    workers: int = Field(4, ge=1, le=64)
    budget_usd: float | None = Field(None, description="Hạn mức chi phí; vượt thì dừng")
    use_cache: bool = True
    score: dict = Field(default_factory=dict, description="Tuỳ chọn scorer: strict_keys, list_as_set, token_regex, fuzzy_threshold")


def resolve(cfg: ExperimentConfig) -> dict:
    ds = datasets.get(cfg.dataset)
    base = datasets.base_of(ds)
    ids = [s.id for s in datasets.samples(cfg.dataset)]
    if cfg.sample_ids:
        keep = set(cfg.sample_ids)
        ids = [i for i in ids if i in keep]
    if cfg.limit:
        ids = ids[: cfg.limit]
    for mid in ((cfg.asr_model,) if cfg.mode == "asr_only" else (cfg.llm_model, cfg.asr_model)):
        err = models.check_model_ready(mid)
        if err:
            raise ValueError(err)
    _, llm_spec, llm_price = models.model_spec(cfg.llm_model, cfg.llm_overrides)
    _, asr_spec, asr_price = models.model_spec(cfg.asr_model, cfg.asr_overrides)
    pipe = PipelineConfig(asr=asr_spec, postprocess=cfg.postprocess, llm=llm_spec, renderer=cfg.renderer, prompt=cfg.prompt,
                          agent=cfg.agent, guards=cfg.guards, timeout_s=cfg.timeout_s)
    return {"root": base["root"], "split": base["split"], "dataset_id": cfg.dataset, "sample_ids": ids,
            "pipeline": pipe.model_dump(), "llm_model": cfg.llm_model, "asr_model": cfg.asr_model,
            "prices": {"llm": llm_price, "asr": asr_price}, "use_cache": cfg.use_cache, "score": cfg.score,
            "timeout_s": cfg.timeout_s, "workers": cfg.workers, "budget_usd": cfg.budget_usd, "mode": cfg.mode}


def redact(cfg: dict) -> dict:
    """Bỏ khoá API trước khi lưu cấu hình."""
    if isinstance(cfg, dict):
        return {k: ("***" if k == "api_key" and v else redact(v)) for k, v in cfg.items()}
    if isinstance(cfg, list):
        return [redact(x) for x in cfg]
    return cfg


def estimate(cfg: ExperimentConfig, probe: int = 20) -> dict:
    """Ước tính chi phí: dựng prompt thật trên vài mẫu, ước lượng số bước từ nhãn (nếu có)."""
    ds = datasets.get(cfg.dataset)
    base = datasets.base_of(ds)
    ss = datasets.samples(cfg.dataset)
    if cfg.sample_ids:
        keep = set(cfg.sample_ids)
        ss = [s for s in ss if s.id in keep]
    if cfg.limit:
        ss = ss[: cfg.limit]
    n = len(ss)
    if not n:
        return {"n": 0, "usd": 0.0}
    tools = catalog_tools(load_catalog(base["root"], base["split"]))
    renderer = build("renderer", cfg.renderer)
    prompt = build("prompt", cfg.prompt)
    _, _, llm_price = models.model_spec(cfg.llm_model)
    _, asr_spec, asr_price = models.model_spec(cfg.asr_model)
    tot_in = tot_out = secs = 0.0
    import json

    probes = ss[:probe]
    for s in probes:
        specs = renderer.render(tools, s.allowed_tools())
        system = prompt.system(s)
        msgs = prompt.messages(s, None, s.audio_text or "")
        base_chars = len(system) + len(json.dumps([t.__dict__ for t in specs], ensure_ascii=False)) + len(json.dumps(msgs, ensure_ascii=False))
        steps = (len((s.label or {}).get("tool_calls", [])) + 1) if s.label else 3
        tot_in += sum(base_chars / 3.0 + k * 250 for k in range(steps))
        tot_out += steps * 120
        if asr_spec.get("plugin") not in ("gold", "transcript_file"):
            secs += sum(audio_seconds(Path(base["root"]) / base["split"] / a) for a in s.user_audios())
    f = n / len(probes)
    usage = {"input_tokens": tot_in * f, "output_tokens": tot_out * f}
    llm_usd = models.cost_of(usage, llm_price)
    asr_usd = models.cost_of({"audio_seconds": secs * f}, asr_price)
    return {"n": n, "input_tokens": int(usage["input_tokens"]), "output_tokens": int(usage["output_tokens"]),
            "audio_minutes": round(secs * f / 60, 1), "llm_usd": round(llm_usd, 4), "asr_usd": round(asr_usd, 4),
            "usd": round(llm_usd + asr_usd, 4), "note": "Ước tính thô (không tính cache); số bước dựa theo nhãn nếu có"}
