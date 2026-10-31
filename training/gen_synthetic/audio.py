"""Chuẩn hoá audio TTS về WAV 16 kHz mono 16-bit (như dữ liệu BTC) + augmentation: tốc độ, nhiễu nền, vang phòng, âm lượng."""
from __future__ import annotations

import io
import random
import wave
from pathlib import Path

import numpy as np
from pydantic import BaseModel, Field
from scipy.signal import fftconvolve, resample_poly

SR = 16000


class AugmentOptions(BaseModel):
    prob: float = Field(0.5, description="Xác suất áp dụng augmentation cho mỗi file")
    noise_snr_db: tuple[float, float] = (12.0, 30.0)
    speed: tuple[float, float] = (0.9, 1.1)
    reverb_prob: float = 0.3
    gain_db: tuple[float, float] = (-6.0, 3.0)


def decode_wav(data: bytes) -> np.ndarray:
    with wave.open(io.BytesIO(data)) as w:
        sr, ch, sw, n = w.getframerate(), w.getnchannels(), w.getsampwidth(), w.getnframes()
        raw = w.readframes(n)
    if sw == 2:
        x = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    elif sw == 4:
        x = np.frombuffer(raw, dtype=np.int32).astype(np.float32) / 2147483648.0
    elif sw == 1:
        x = (np.frombuffer(raw, dtype=np.uint8).astype(np.float32) - 128) / 128.0
    else:
        raise ValueError(f"sample width {sw} không hỗ trợ")
    if ch > 1:
        x = x.reshape(-1, ch).mean(axis=1)
    if sr != SR:
        g = np.gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g).astype(np.float32)
    return x


def augment(x: np.ndarray, opts: AugmentOptions, rng: random.Random) -> np.ndarray:
    if rng.random() >= opts.prob:
        return x
    sp = rng.uniform(*opts.speed)
    if abs(sp - 1) > 0.01:
        up, down = 100, int(round(100 * sp))
        x = resample_poly(x, up, down).astype(np.float32)
    if rng.random() < opts.reverb_prob:
        t = np.arange(int(SR * rng.uniform(0.15, 0.4))) / SR
        ir = np.exp(-t * rng.uniform(8, 20)) * np.random.default_rng(rng.randint(0, 1 << 30)).standard_normal(len(t))
        ir[0] = 1.0
        x = fftconvolve(x, ir / np.abs(ir).sum() * 2)[: len(x)].astype(np.float32)
    snr = rng.uniform(*opts.noise_snr_db)
    p = float(np.mean(x ** 2)) + 1e-9
    noise = np.random.default_rng(rng.randint(0, 1 << 30)).standard_normal(len(x)).astype(np.float32)
    x = x + noise * np.sqrt(p / (10 ** (snr / 10)))
    x = x * (10 ** (rng.uniform(*opts.gain_db) / 20))
    return x


def write_wav(path: Path, x: np.ndarray):
    path.parent.mkdir(parents=True, exist_ok=True)
    y = np.clip(x, -1, 1)
    peak = np.abs(y).max() if len(y) else 0
    if peak > 0.99:
        y = y / peak * 0.99
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((y * 32767).astype(np.int16).tobytes())
