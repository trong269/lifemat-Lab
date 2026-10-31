"""SFT LLM (<5B) trên file xuất từ Data Studio (sft.jsonl: {"messages", "tools"}) — chạy trên máy GPU thuê.

    pip install -r training/requirements-train.txt
    python training/sft/train_sft.py --model <model gốc> --data lab_data/exports/<ver>/sft.jsonl --out ckpt/sft_v1 [--lora]

- Render bằng chat template của chính model (kèm danh sách tool), loss CHỈ tính trên các lượt assistant: mask được tính bằng cách
  render tiền tố hội thoại, nên dùng được với mọi chat template (không cần thẻ {% generation %}).
- Mẫu dài hơn --max-len bị bỏ (có thống kê).
Sau khi train: phục vụ bằng vLLM (`vllm serve ckpt/sft_v1 --served-model-name lifemate-llm --max-model-len 16384
--enable-auto-tool-choice --tool-call-parser hermes`) rồi đăng ký trong platform (Mô hình, nguồn checkpoint) để đánh giá.
"""
from __future__ import annotations

import argparse
import json
import random


def load_rows(path: str) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            r = json.loads(line)
            for m in r["messages"]:
                for tc in m.get("tool_calls") or []:
                    a = tc["function"]["arguments"]
                    if isinstance(a, str):           # chat template HF cần dict
                        tc["function"]["arguments"] = json.loads(a or "{}")
                if m.get("content") is None:
                    m["content"] = ""
            rows.append({"messages": r["messages"], "tools": r["tools"]})
    return rows


def encode(tok, row: dict, max_len: int) -> dict | None:
    """input_ids + labels (-100 ngoài các lượt assistant)."""
    msgs, tools = row["messages"], row["tools"]
    full = tok.apply_chat_template(msgs, tools=tools, tokenize=False)
    ids = tok(full, add_special_tokens=False)["input_ids"]
    if len(ids) > max_len:
        return None
    labels = [-100] * len(ids)
    for i, m in enumerate(msgs):
        if m["role"] != "assistant":
            continue
        pre = tok.apply_chat_template(msgs[:i], tools=tools, tokenize=False, add_generation_prompt=True)
        upto = tok.apply_chat_template(msgs[: i + 1], tools=tools, tokenize=False)
        if not full.startswith(upto) or not upto.startswith(pre):
            continue  # template không ổn định tiền tố ở lượt này: bỏ qua (an toàn hơn là mask sai)
        a = len(tok(pre, add_special_tokens=False)["input_ids"])
        b = len(tok(upto, add_special_tokens=False)["input_ids"])
        for k in range(a, min(b, len(ids))):
            labels[k] = ids[k]
    if all(x == -100 for x in labels):
        return None
    return {"input_ids": ids, "labels": labels}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--eval", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=float, default=2)
    ap.add_argument("--max-steps", type=int, default=-1)
    ap.add_argument("--lr", type=float, default=1e-5)
    ap.add_argument("--batch", type=int, default=1)
    ap.add_argument("--grad-accum", type=int, default=16)
    ap.add_argument("--max-len", type=int, default=16384)
    ap.add_argument("--lora", action="store_true")
    ap.add_argument("--lora-r", type=int, default=64)
    ap.add_argument("--precision", choices=["auto", "bf16", "fp16", "fp32"], default="auto")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments

    random.seed(a.seed)
    torch.manual_seed(a.seed)
    prec = a.precision
    if prec == "auto":
        prec = "bf16" if torch.cuda.is_available() and torch.cuda.is_bf16_supported() else "fp16" if torch.cuda.is_available() else "fp32"
    tok = AutoTokenizer.from_pretrained(a.model)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    def build(path):
        rows, skipped = [], 0
        for r in load_rows(path):
            e = encode(tok, r, a.max_len)
            if e is None:
                skipped += 1
            else:
                rows.append(e)
        print(f"{path}: {len(rows)} mẫu, bỏ {skipped} (quá dài / không có lượt assistant)")
        return rows

    train = build(a.data)
    ev = build(a.eval) if a.eval else None
    # fp16: giữ trọng số fp32 và dùng autocast (AMP); bf16: nạp thẳng bf16
    dtype = torch.bfloat16 if prec == "bf16" else torch.float32
    try:
        model = AutoModelForCausalLM.from_pretrained(a.model, dtype=dtype)
    except TypeError:                                    # transformers < 4.56
        model = AutoModelForCausalLM.from_pretrained(a.model, torch_dtype=dtype)
    model.config.use_cache = False
    if a.lora:
        from peft import LoraConfig, get_peft_model

        model = get_peft_model(model, LoraConfig(r=a.lora_r, lora_alpha=2 * a.lora_r, lora_dropout=0.05, target_modules="all-linear",
                                                 task_type="CAUSAL_LM"))
        model.enable_input_require_grads()
        model.print_trainable_parameters()

    def collate(batch):
        n = max(len(x["input_ids"]) for x in batch)
        ids = [x["input_ids"] + [tok.pad_token_id] * (n - len(x["input_ids"])) for x in batch]
        lab = [x["labels"] + [-100] * (n - len(x["labels"])) for x in batch]
        att = [[1] * len(x["input_ids"]) + [0] * (n - len(x["input_ids"])) for x in batch]
        return {"input_ids": torch.tensor(ids), "labels": torch.tensor(lab), "attention_mask": torch.tensor(att)}

    import math

    total = a.max_steps if a.max_steps > 0 else math.ceil(len(train) / (a.batch * a.grad_accum)) * a.epochs
    args = TrainingArguments(output_dir=a.out, num_train_epochs=a.epochs, max_steps=a.max_steps, learning_rate=a.lr,
                             per_device_train_batch_size=a.batch, gradient_accumulation_steps=a.grad_accum,
                             bf16=prec == "bf16", fp16=prec == "fp16", logging_steps=1 if a.max_steps > 0 else 10,
                             save_strategy="no" if a.max_steps > 0 else "epoch", eval_strategy="epoch" if ev else "no",
                             gradient_checkpointing=True, lr_scheduler_type="cosine", warmup_steps=max(1, int(0.03 * total)), seed=a.seed,
                             report_to="none", remove_unused_columns=False)
    tr = Trainer(model=model, args=args, train_dataset=train, eval_dataset=ev, data_collator=collate)
    tr.train()
    if a.lora:
        model = model.merge_and_unload()     # lưu model đầy đủ để vLLM phục vụ trực tiếp
    model.save_pretrained(a.out)
    tok.save_pretrained(a.out)
    json.dump({**vars(a), "precision_used": prec}, open(f"{a.out}/lifemate_train_args.json", "w"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
