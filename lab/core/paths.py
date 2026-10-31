from __future__ import annotations

import os
from pathlib import Path

HOME = Path(os.environ.get("LAB_HOME", Path(__file__).resolve().parents[2]))
DATA = Path(os.environ.get("LAB_DATA", HOME / "lab_data"))
RUNS = DATA / "runs"
DATASETS = DATA / "datasets"
EXPORTS = DATA / "exports"
APPS = DATA / "apps"
UPLOADS = DATA / "uploads"
DB_PATH = DATA / "lab.sqlite"
CACHE_PATH = DATA / "cache.sqlite"
SECRETS_PATH = DATA / "secrets.json"
PREDICTIONS = DATA / "predictions"   # file dự đoán ASR / LLM do thành viên khác gửi
# Dữ liệu BTC (train/, public_test/...) KHÔNG nằm trong repo: khai báo đường dẫn ở trang Dữ liệu
# (bảng data_sources) hoặc biến môi trường LAB_DATA_ROOTS (nhiều đường dẫn cách nhau bằng ':').

for _d in (DATA, RUNS, DATASETS, EXPORTS, APPS, UPLOADS, PREDICTIONS):
    _d.mkdir(parents=True, exist_ok=True)

# 11 app chỉ có ở public_test: không dùng để sinh dữ liệu (quyết định của người dùng)
PUBLIC_ONLY_APPS = {"ecommerce", "event_tickets", "grocery", "habit_tracker", "pantry", "parking", "public_transit",
                    "recipes", "stocks", "train_bus_tickets", "translator"}
