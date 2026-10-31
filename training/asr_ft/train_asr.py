"""Fine-tune ASR họ Whisper trên manifest xuất từ Data Studio (asr_manifest.jsonl: {"audio_filepath", "text", "duration"}).

    python training/asr_ft/train_asr.py --model vinai/PhoWhisper-small --data lab_data/exports/<ver>/asr_manifest.jsonl --out ckpt/asr_v1

Sau khi train: `python servers/asr_server.py --model ckpt/asr_v1` rồi đăng ký model ASR trong platform để đo WER / điểm end-to-end.
"""
from __future__ import annotations

import argparse
import json


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", required=True)
    ap.add_argument("--data", required=True)
    ap.add_argument("--eval", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--epochs", type=float, default=3)
    ap.add_argument("--lr", type=float, default=1e-5)
    ap.add_argument("--batch", type=int, default=16)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--max-steps", type=int, default=-1)
    a = ap.parse_args()

    import numpy as np
    import soundfile as sf
    import torch
    from datasets import Dataset
    from transformers import (Seq2SeqTrainer, Seq2SeqTrainingArguments, WhisperForConditionalGeneration, WhisperProcessor)

    bf16 = torch.cuda.is_available() and torch.cuda.is_bf16_supported()
    fp16 = torch.cuda.is_available() and not bf16
    proc = WhisperProcessor.from_pretrained(a.model, language="vi", task="transcribe")
    model = WhisperForConditionalGeneration.from_pretrained(a.model)
    model.generation_config.language, model.generation_config.task = "vi", "transcribe"

    def rows(p):
        return [json.loads(x) for x in open(p, encoding="utf-8") if x.strip()]

    def prep(r):
        x, sr = sf.read(r["audio_filepath"], dtype="float32")
        if x.ndim > 1:
            x = x.mean(axis=1)
        feats = proc.feature_extractor(x, sampling_rate=sr).input_features[0]
        return {"input_features": feats, "labels": proc.tokenizer(r["text"]).input_ids}

    train = Dataset.from_list(rows(a.data)).map(prep, remove_columns=["audio_filepath", "text", "duration", "dataset"])
    ev = Dataset.from_list(rows(a.eval)).map(prep, remove_columns=["audio_filepath", "text", "duration", "dataset"]) if a.eval else None

    def collate(batch):
        f = proc.feature_extractor.pad([{"input_features": b["input_features"]} for b in batch], return_tensors="pt")
        lab = proc.tokenizer.pad([{"input_ids": b["labels"]} for b in batch], return_tensors="pt")
        labels = lab["input_ids"].masked_fill(lab.attention_mask.ne(1), -100)
        if (labels[:, 0] == model.config.decoder_start_token_id).all():
            labels = labels[:, 1:]
        return {"input_features": f["input_features"], "labels": labels}

    args = Seq2SeqTrainingArguments(output_dir=a.out, per_device_train_batch_size=a.batch, learning_rate=a.lr, num_train_epochs=a.epochs, max_steps=a.max_steps,
                                    warmup_steps=10, bf16=bf16, fp16=fp16, logging_steps=20, save_strategy="epoch",
                                    eval_strategy="epoch" if ev is not None else "no", predict_with_generate=False, seed=a.seed,
                                    report_to="none", remove_unused_columns=False)
    Seq2SeqTrainer(model=model, args=args, train_dataset=train, eval_dataset=ev, data_collator=collate).train()
    model.save_pretrained(a.out)
    proc.save_pretrained(a.out)
    _ = np  # noqa


if __name__ == "__main__":
    main()
