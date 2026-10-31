"""agent_core — LifeMate solution: ASR -> LLM agent -> zaic_tools.

Package này độc lập với platform (`lab/`): Docker nộp bài chỉ cần agent_core + trọng số model.
"""
from .registry import REGISTRY, register, build  # noqa: F401
