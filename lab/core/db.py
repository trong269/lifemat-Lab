"""SQLite (WAL) với vài helper. Cột kiểu JSON lưu dạng text, tự giải mã khi đọc."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid

from .paths import DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS providers (id TEXT PRIMARY KEY, kind TEXT, base_url TEXT, api_key_env TEXT, notes TEXT, created REAL);
CREATE TABLE IF NOT EXISTS models (id TEXT PRIMARY KEY, name TEXT, role TEXT, provider_id TEXT, plugin TEXT, config TEXT,
  price TEXT, n_params_b REAL, context_len INTEGER, release_date TEXT, license TEXT, submit_ok INTEGER DEFAULT 0,
  source TEXT, base_model TEXT, train_dataset TEXT, train_script TEXT, notes TEXT, created REAL);
CREATE TABLE IF NOT EXISTS datasets (id TEXT PRIMARY KEY, name TEXT, root TEXT, split TEXT, kind TEXT, parent_id TEXT,
  sample_ids TEXT, filter TEXT, notes TEXT, created REAL);
CREATE TABLE IF NOT EXISTS experiments (id TEXT PRIMARY KEY, name TEXT, config TEXT, created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, experiment_id TEXT, name TEXT, dataset_id TEXT, config TEXT, status TEXT,
  total INTEGER, done INTEGER DEFAULT 0, score REAL, metrics TEXT, cost REAL DEFAULT 0, created REAL, started REAL, finished REAL,
  error TEXT, kind TEXT DEFAULT 'agent');
CREATE TABLE IF NOT EXISTS run_samples (run_id TEXT, sample_id TEXT, idx INTEGER, status TEXT, score REAL, hash_ok INTEGER, M INTEGER,
  U INTEGER, G INTEGER, P REAL, R REAL, f1_nohash REAL, tags TEXT, scenario TEXT, apps TEXT, hist_turns INTEGER, new_app INTEGER,
  n_calls INTEGER, latency_s REAL, time_asr_s REAL, cost REAL, tokens_in INTEGER, tokens_out INTEGER, steps INTEGER,
  asr TEXT, sub TEXT, trace_offset INTEGER, PRIMARY KEY (run_id, sample_id));
CREATE TABLE IF NOT EXISTS usage_log (id INTEGER PRIMARY KEY AUTOINCREMENT, ts REAL, owner TEXT, model_id TEXT, kind TEXT,
  input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, audio_seconds REAL, chars INTEGER, cost REAL, cached INTEGER);
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, kind TEXT, status TEXT, progress INTEGER DEFAULT 0, total INTEGER DEFAULT 0,
  payload TEXT, result TEXT, error TEXT, cost REAL DEFAULT 0, budget REAL, created REAL, updated REAL, log TEXT);
CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, name TEXT, config TEXT, created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS synth_batches (id TEXT PRIMARY KEY, name TEXT, recipe TEXT, dataset_id TEXT, status TEXT,
  n_target INTEGER, n_done INTEGER DEFAULT 0, cost REAL DEFAULT 0, job_id TEXT, created REAL);
CREATE TABLE IF NOT EXISTS synth_samples (dataset_id TEXT, sample_id TEXT, batch_id TEXT, scenario TEXT, status TEXT,
  flags TEXT, disagreement INTEGER DEFAULT 0, spot_check INTEGER DEFAULT 0, provenance TEXT, reviewer TEXT, updated REAL,
  PRIMARY KEY (dataset_id, sample_id));
CREATE TABLE IF NOT EXISTS sample_edits (id INTEGER PRIMARY KEY AUTOINCREMENT, dataset_id TEXT, sample_id TEXT, ts REAL,
  field TEXT, before TEXT, after TEXT);
CREATE TABLE IF NOT EXISTS gen_apps (id TEXT PRIMARY KEY, app_id TEXT, status TEXT, spec TEXT, code TEXT, example_state TEXT,
  test_report TEXT, notes TEXT, created REAL, updated REAL);
CREATE TABLE IF NOT EXISTS dataset_versions (id TEXT PRIMARY KEY, name TEXT, components TEXT, options TEXT, export_path TEXT,
  stats TEXT, created REAL);
CREATE TABLE IF NOT EXISTS data_sources (id TEXT PRIMARY KEY, path TEXT, notes TEXT, created REAL);
CREATE TABLE IF NOT EXISTS lb_scores (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, score REAL, note TEXT, ts REAL);
CREATE INDEX IF NOT EXISTS ix_rs_run ON run_samples(run_id);
CREATE INDEX IF NOT EXISTS ix_ss_status ON synth_samples(dataset_id, status);
CREATE INDEX IF NOT EXISTS ix_usage_owner ON usage_log(owner);
"""

JSON_COLS = {"config", "price", "sample_ids", "filter", "metrics", "tags", "apps", "asr", "sub", "payload", "result",
             "recipe", "flags", "provenance", "before", "after", "spec", "example_state", "test_report", "components",
             "options", "stats", "log", "alt"}

_local = threading.local()
_init_lock = threading.Lock()
_initialized = False


def conn() -> sqlite3.Connection:
    global _initialized
    c = getattr(_local, "c", None)
    if c is None:
        c = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
        c.row_factory = sqlite3.Row
        c.execute("PRAGMA journal_mode=WAL")
        c.execute("PRAGMA synchronous=NORMAL")
        _local.c = c
        with _init_lock:
            if not _initialized:
                c.executescript(SCHEMA)
                for col in ("alt TEXT",):          # nâng cấp DB cũ
                    try:
                        c.execute(f"ALTER TABLE run_samples ADD COLUMN {col}")
                    except sqlite3.OperationalError:
                        pass
                c.commit()
                _initialized = True
    return c


def new_id(prefix: str = "") -> str:
    return f"{prefix}{time.strftime('%m%d%H%M%S')}_{uuid.uuid4().hex[:6]}"


def _enc(k, v):
    if k in JSON_COLS and v is not None and not isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, bool):
        return int(v)
    return v


def _dec(row: sqlite3.Row | None) -> dict | None:
    if row is None:
        return None
    d = dict(row)
    for k in d:
        if k in JSON_COLS and isinstance(d[k], str):
            try:
                d[k] = json.loads(d[k])
            except json.JSONDecodeError:
                pass
    return d


def insert(table: str, row: dict, replace: bool = False):
    keys = list(row)
    sql = f"INSERT {'OR REPLACE ' if replace else ''}INTO {table} ({','.join(keys)}) VALUES ({','.join('?' * len(keys))})"
    c = conn()
    c.execute(sql, [_enc(k, row[k]) for k in keys])
    c.commit()


def update(table: str, where: dict, values: dict):
    sets = ",".join(f"{k}=?" for k in values)
    w = " AND ".join(f"{k}=?" for k in where)
    c = conn()
    c.execute(f"UPDATE {table} SET {sets} WHERE {w}", [_enc(k, v) for k, v in values.items()] + list(where.values()))
    c.commit()


def delete(table: str, where: dict):
    w = " AND ".join(f"{k}=?" for k in where)
    c = conn()
    c.execute(f"DELETE FROM {table} WHERE {w}", list(where.values()))
    c.commit()


def get(table: str, **where) -> dict | None:
    w = " AND ".join(f"{k}=?" for k in where)
    return _dec(conn().execute(f"SELECT * FROM {table} WHERE {w}", list(where.values())).fetchone())


def query(sql: str, params: list | tuple = ()) -> list[dict]:
    return [_dec(r) for r in conn().execute(sql, params).fetchall()]


def all_rows(table: str, order: str = "created DESC", **where) -> list[dict]:
    if where:
        w = " WHERE " + " AND ".join(f"{k}=?" for k in where)
    else:
        w = ""
    return query(f"SELECT * FROM {table}{w} ORDER BY {order}", list(where.values()))
