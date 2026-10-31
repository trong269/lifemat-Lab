"""Entrypoint suy luận cho Docker nộp bài.

    python -m agent_core.infer --data /data --out result/submission.jsonl --config agent_core/submit_config.yaml

- `--data` là thư mục split (vd /data = private_test/) hoặc thư mục chứa nó; tự nhận diện.
- Dùng zaic_tools của chính split được mount; mỗi mẫu đúng một ToolEnv; mọi call đều nằm trong file nộp.
- Không đọc <split>_environment/ (chỉ zaic_tools đọc).
"""
from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
import traceback
from pathlib import Path

import yaml

from .data import load_samples, load_zaic_tools, locate_split
from .pipeline import Pipeline, PipelineConfig


def set_seeds(seed: int = 0):
    random.seed(seed)
    os.environ.setdefault("PYTHONHASHSEED", str(seed))
    try:
        import numpy as np

        np.random.seed(seed)
    except ImportError:
        pass
    try:
        import torch

        torch.manual_seed(seed)
        torch.use_deterministic_algorithms(True, warn_only=True)
    except ImportError:
        pass


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="/data")
    ap.add_argument("--split", default=None)
    ap.add_argument("--out", default="result/submission.jsonl")
    ap.add_argument("--config", default=str(Path(__file__).parent / "submit_config.yaml"))
    ap.add_argument("--limit", type=int, default=0)
    a = ap.parse_args(argv)
    set_seeds(0)
    root, split = locate_split(a.data, a.split)
    zt = load_zaic_tools(root, split)
    cfg = PipelineConfig(**yaml.safe_load(open(a.config, encoding="utf-8")))
    pipe = Pipeline(cfg, root, split)
    samples = load_samples(root, split)
    if a.limit:
        samples = samples[: a.limit]
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    t_all = time.time()
    with open(a.out, "w", encoding="utf-8") as fout:
        for i, s in enumerate(samples):
            env = zt.ToolEnv(split, s.id, root=root)
            t0 = time.time()
            try:
                pipe.run(s, env)
            except Exception:  # never lose a line: submit whatever calls were made
                traceback.print_exc(file=sys.stderr)
            fout.write(json.dumps({"id": s.id, "tool_calls": env.get_tool_calls(), "state_hash": env.get_state_hash()}, ensure_ascii=False) + "\n")
            fout.flush()
            print(f"[{i + 1}/{len(samples)}] {s.id} {time.time() - t0:.1f}s", file=sys.stderr)
    print(f"xong {len(samples)} mẫu trong {time.time() - t_all:.0f}s -> {a.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
