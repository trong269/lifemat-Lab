# Kế hoạch triển khai — LifeMate Dev Platform

Phiên bản 1 · 29/10/2026 · Hạn nộp solution: 23:59 16/11/2026

## 0. Quyết định đã chốt

| Mục | Quyết định |
|---|---|
| Người dùng | Một người, chạy local, không đăng nhập. UI tiếng Việt |
| Phạm vi | Toàn bộ bài toán: ASR → LLM agent → zaic_tools → chấm điểm, cộng sinh dữ liệu (text + TTS) |
| Model | Không có model mặc định; mọi model khai báo trong Model registry. Có tính chi phí API ngoài |
| Training | Chạy bằng script trên GPU thuê; platform chỉ theo dõi checkpoint và đánh giá |
| Dữ liệu cấm dùng | Không dùng state/history/audio của public_test để train; không dùng schema/code của 11 app chỉ có ở public_test để sinh dữ liệu |
| Stack | Python 3.11+ · FastAPI · SQLite (SQLModel) · React + Vite + TypeScript · shadcn/ui · TanStack Query/Table · Monaco · Recharts · wavesurfer.js |
| Docker nộp bài | Chỉ chứa `agent_core` + trọng số model. Platform không vào Docker |

## 1. Cấu trúc thư mục

```
train+public_test/                 ← thư mục hiện tại (gói dữ liệu BTC)
├── train/  public_test/           ← dữ liệu BTC, KHÔNG sửa
├── agent_core/                    ← solution; không import gì từ platform/
│   ├── types.py                   Sample, Turn, ToolCall, Message, Trace
│   ├── data.py                    đọc split, tìm root linh hoạt (cho /data trong Docker)
│   ├── asr/                       base.py, gold.py, transcript_file.py, http.py, api.py, postprocess.py
│   ├── llm/                       base.py, anthropic_backend.py, openai_compat.py, oracle.py
│   ├── render/                    schema renderers (full_json, compact, signature) + tên tool an toàn
│   ├── prompts/                   rules_v1.md, builders (system prompt, history → messages)
│   ├── guards/                    validate_repair, iso_time, ask_last, ...
│   ├── agent/                     react.py (vòng lặp), budget.py (deadline)
│   ├── pipeline.py                ASR → agent → (tool_calls, state_hash, trace)
│   └── infer.py                   entrypoint Docker: /data → result/submission.jsonl
├── lab/                           ← platform (chỉ dùng lúc phát triển)
│   ├── core/                      registry plugin, config, storage, cost, cache
│   ├── scoring/                   official.py, diagnostics.py, asr_metrics.py
│   ├── runner/                    job manager, worker theo split, watchdog timeout
│   ├── api/                       FastAPI routers
│   └── cli.py                     `python -m lab ...`
├── training/
│   ├── gen_synthetic/             app_factory, state_gen, recipe, request_gen, labeler, checks, tts, export
│   └── sft/ asr_ft/               script train (chạy trên GPU thuê)
├── ui/                            React app
├── servers/asr_server.py          server ASR chạy trên GPU thuê
├── docker/                        Dockerfile, run.sh
├── docs/
└── lab_data/                      (gitignore) db.sqlite, runs/, cache/, datasets/synth_*/, audio TTS
```

## 2. Thiết kế lõi

### 2.1 Kiểu dữ liệu (agent_core/types.py)
- `Sample`: id, split, audio path, context, history (list `Turn`), `audio_text?`, `label?`.
- `Turn`: role, audio?, text? (transcript), assistant text, tool_calls, tool_results.
- `ToolCall`: name (dạng gốc `app.tool`), arguments.
- `Message` (trung lập nhà cung cấp): role ∈ {system, user, assistant, tool}, text, tool_calls[{id, name, args}], tool_call_id.
- `Trace`: các bước {request đã render, output thô, tool_calls đã parse, kết quả guard, kết quả env, latency, usage}.

### 2.2 Interface plugin
```python
class ASR:        def transcribe(self, paths: list[Path]) -> list[ASRResult]        # text, latency, usage
class LLMBackend: def step(self, system, messages, tools, params) -> LLMResponse    # text, tool_calls, usage, raw
class Renderer:   def tools(self, catalog, installed) -> list[ToolSpec]; def name_map
class Prompt:     def system(self, sample) -> str; def history(self, sample) -> list[Message]
class Guard:      def check(self, call, env, ctx) -> GuardResult                    # ok | repair | feedback cho model
class Agent:      def run(self, sample, env, llm, ...) -> AgentResult
class TTS:        def synthesize(self, text, voice, opts) -> Path
```
Mọi plugin khai báo cấu hình bằng pydantic → UI tự sinh form. Đăng ký qua decorator `@register("llm", "anthropic")`.

### 2.3 Backend LLM
- Hai adapter phủ hết: `anthropic` (SDK chính thức) và `openai_compat` (OpenAI, Gemini qua endpoint OpenAI-compatible, OpenRouter, vLLM, llama.cpp). Thêm `oracle` phát lại đáp án train để kiểm thử pipeline không tốn tiền.
- Tên tool có dấu chấm không hợp lệ với API → đổi `app.tool` ↔ `app__tool` ở renderer.
- Bỏ các khoá `x-*` khỏi JSON Schema gửi API, chuyển nghĩa vào description (“ID lấy từ contacts.search”, “văn bản tự do”, “bắt buộc một trong: …”).
- Tham số theo model do bạn cấu hình (Anthropic hiện không nhận `temperature` trên các model mới; dùng `thinking`/`effort`). Model nộp bài (vLLM) dùng greedy.

### 2.4 Vòng lặp agent (ReAct)
1. Dựng system prompt: bộ luật hành vi + context (giờ, múi giờ, vị trí, user_profile) + danh sách app đã cài.
2. Chuyển history thành message gốc: lượt user (transcript ASR), lượt assistant có tool_calls + tool_results + text.
3. Lặp tối đa `max_steps`: gọi LLM → nếu có tool call: qua chuỗi guard (`env.validate` trước; sai schema thì trả lỗi cho model **mà không gọi env**, tối đa 2 lần sửa) → `env.call` → thêm kết quả. Không có tool call thì dừng.
4. Deadline mềm: trước mỗi bước kiểm tra thời gian còn lại so với ngân sách 30 giây (tính cả ASR).

### 2.5 Scorer chính thức (lab/scoring/official.py)
- Gold hash: replay `label.tool_calls` trên ToolEnv mới (đã kiểm chứng 1545/1545 khớp nhãn).
- Gold rỗng → 1 nếu dự đoán rỗng, ngược lại 0.
- Hash khác → 0. Ngược lại: ghép cặp cực đại (bipartite) giữa call dự đoán và call gold; khớp khi cùng tên, tham số không fuzzy giống hệt, tham số fuzzy có token-F1 > 0.6 (lowercase + NFC). U = số call dự đoán không ghép được (kể cả call bị từ chối). P = M/(M+U), R = M/|G|, điểm = F1.
- Các điểm mơ hồ là cờ cấu hình: thừa/thiếu tham số tuỳ chọn có tính là không khớp; list so theo thứ tự hay tập hợp; cách tách token. Hiệu chỉnh bằng cách so điểm local với leaderboard public.
- Báo thêm F1 không tính hash (tiêu chí phá hoà).

### 2.6 Chẩn đoán lỗi (lab/scoring/diagnostics.py)
Gắn nhãn tự động mỗi mẫu: `wrong_id`, `extra_read`, `missing_read`, `rejected_call`, `wrong_time`, `wrong_amount`, `missing_ask`, `wrong_ask_params`, `acted_on_oos`, `empty_but_should_act`, `fuzzy_below_threshold`, `timeout`, `crash`.

### 2.7 Runner
- Worker là tiến trình riêng theo split (vì mỗi split có `zaic_tools` riêng cùng tên). Worker nhận mẫu từ hàng đợi, mỗi mẫu đúng một ToolEnv.
- Watchdog giết worker nếu mẫu vượt deadline + 5 giây → ghi `timeout`, dòng nộp dùng các call đã gọi tới lúc đó.
- Cache: LLM (khoá = hash request đã chuẩn hoá) và ASR (khoá = sha audio + cấu hình) trong SQLite.
- Kết quả: `lab_data/runs/<run_id>/{config.yaml, traces.jsonl, submission.jsonl, metrics.json}` + bảng tóm tắt từng mẫu trong DB.
- Pipeline run = ASR run + agent run liên kết; agent run dùng lại transcript đã cache.

### 2.8 Chi phí
Bảng giá do bạn nhập cho từng model (token vào/ra, cache, giây audio, ký tự TTS). Mỗi lần gọi ghi usage + chi phí. Mỗi job có ước tính trước và hạn mức; vượt hạn mức thì tự dừng.

### 2.9 Bảng SQLite
`datasets`, `models` (nguồn, số tham số, ngày phát hành, license, cờ dùng-được-khi-nộp, giá), `checkpoints` (model gốc, dataset train, script, config), `experiments`, `runs`, `run_samples`, `asr_runs`, `transcripts`, `llm_calls`, `jobs`, `synth_batches`, `synth_samples` (trạng thái review, cờ lỗi, lý lịch), `sample_edits`, `apps_generated`, `lb_scores`.

### 2.10 API backend (FastAPI)
`/datasets` · `/datasets/{id}/samples` · `/models` · `/prices` · `/experiments` · `/runs` (+ `WS /runs/{id}/events`) · `/runs/{id}/samples/{sid}` (trace) · `/compare` · `/asr/runs` · `/synth/recipes` · `/synth/batches` · `/synth/review` · `/synth/export` · `/playground/step` · `/costs` · `/submission/checks`.

### 2.11 Trang UI (tiếng Việt)
Tổng quan · Datasets · Mô hình & giá · Thử nghiệm · Kết quả run · Trace · So sánh · ASR Lab · Data Studio (Công thức / Đợt sinh / Duyệt / Xuất) · Playground · Chi phí · Nộp bài.

## 3. Các giai đoạn

### P0 — Lõi + CLI (29/10 → 31/10)
| # | Việc | Tiêu chí hoàn thành |
|---|---|---|
| 0.1 | Khung repo, `pyproject` (uv), gitignore `lab_data/`, git init local | `uv run python -m lab --help` chạy |
| 0.2 | `agent_core/types.py`, `data.py` (đọc split, tìm root linh hoạt) | Nạp đủ 1545 train + 634 public |
| 0.3 | Scorer chính thức + unit test | Chấm đáp án train bằng chính nó → 100.0; test các ca biên (gold rỗng, call bị từ chối, fuzzy) |
| 0.4 | Renderer (full/compact) + đổi tên tool + bỏ `x-*` | Snapshot test; schema hợp lệ với cả hai adapter |
| 0.5 | Backend `oracle`, `anthropic`, `openai_compat`; ghi usage + chi phí | Oracle chạy hết train đạt 100.0 qua đúng vòng lặp agent |
| 0.6 | Agent ReAct + guard `validate_repair` + deadline | Không có call bị từ chối do sai schema lọt vào env khi guard bật |
| 0.7 | ASR plugin `gold`, `transcript_file`; interface `http`/`api` | Pipeline chạy với transcript gold |
| 0.8 | Runner nhiều worker theo split, watchdog, cache, lưu run | Chạy 50 mẫu song song; chạy lại dùng cache gần như tức thì |
| 0.9 | Bộ luật hành vi `rules_v1` (từ phân tích dữ liệu) | Có file prompt có phiên bản |
| 0.10 | CLI: `run`, `score`, `diagnose`, `submission` | Một lệnh chạy cấu hình → in điểm + bảng chia nhỏ |
| 0.11 | Model registry + bảng giá (CLI/YAML) | Thêm model qua file cấu hình |

Cần từ bạn: ít nhất một API key; giá các model bạn định dùng.

### P1 — Backend API + UI nền tảng (01/11 → 03/11)
| # | Việc | Tiêu chí hoàn thành |
|---|---|---|
| 1.1 | FastAPI + SQLModel + job manager + WebSocket tiến độ | Khởi chạy run từ API, nhận tiến độ trực tiếp |
| 1.2 | Khung React (layout, menu tiếng Việt, theme sáng/tối) | `npm run dev` + backend chạy chung bằng một lệnh |
| 1.3 | Trang Datasets: danh sách, thống kê, bộ lọc, tập con, xem mẫu (audio, history, state, đáp án) | Tạo tập “giấu app” từ UI |
| 1.4 | Trang Mô hình & giá: registry, form cấu hình sinh từ pydantic | Thêm/sửa model không cần sửa code |
| 1.5 | Trang Thử nghiệm: tạo từ form hoặc YAML (Monaco), Clone & sửa, ước tính chi phí | Bấm chạy từ UI |
| 1.6 | Trang Kết quả run: điểm, P/R/F1, bảng chia nhỏ, phân loại lỗi, lọc mẫu | Bấm loại lỗi → danh sách mẫu |
| 1.7 | Trace viewer 3 cột: ngữ cảnh / trajectory từng bước / diff với đáp án | Xem được prompt thực tế, output thô, diff call và diff state |

### P2 — Data Studio phần text (04/11 → 06/11) — đường găng của SFT
| # | Việc | Tiêu chí hoàn thành |
|---|---|---|
| 2.1 | Màn hiệu chỉnh teacher (chạy trên train, chấm chuẩn) + khoá theo ngưỡng | Biết điểm teacher theo từng phiên bản luật |
| 2.2 | Sinh state có bẫy cho 46 app train | State hợp lệ, chạy được trên zaic_tools |
| 2.3 | Recipe: tỷ lệ kịch bản, tổ hợp app, vùng miền, độ dài history, số mẫu, hạn mức chi phí | Xem trước 5–10 mẫu trước khi chạy cả đợt |
| 2.4 | Sinh yêu cầu + history (chạy thật từng lượt) | Lượt cuối tham chiếu được history |
| 2.5 | Teacher gán nhãn trên zaic_tools + auto-check bằng luật + đối chiếu 2 teacher (tuỳ chọn) | Mỗi mẫu có cờ lỗi |
| 2.6 | Split tổng hợp đúng cấu trúc BTC (`zaic_tools` riêng + catalog) | Chạy thử nghiệm được trên dataset tổng hợp như train |
| 2.7 | Màn Duyệt: hàng đợi ưu tiên, sửa yêu cầu/state/call → chạy lại mô phỏng, duyệt/loại, phím tắt, thao tác hàng loạt, kiểm tra ngẫu nhiên | Sửa call → kết quả và state được tính lại |
| 2.8 | Xuất: dataset có phiên bản, trộn trọng số, JSONL trajectory SFT đúng định dạng suy luận | File SFT đầu tiên sẵn sàng ngày 06/11 |

### P3 — ASR Lab (07/11 → 09/11)
| # | Việc | Tiêu chí hoàn thành |
|---|---|---|
| 3.1 | `servers/asr_server.py` (chạy trên GPU thuê, model chọn bằng tham số) + plugin `asr_http` | Transcribe cả train qua HTTP |
| 3.2 | Plugin `asr_api` (API ngoài, gắn nhãn “chỉ lúc phát triển”) | So được với model local |
| 3.3 | Hậu xử lý: chuẩn hoá số/giờ/tiền, gợi ý từ khoá từ ngữ cảnh được phép | Bật/tắt như guard |
| 3.4 | Chỉ số: WER/CER đã chuẩn hoá, lỗi thực thể (tên, số tiền, giờ, địa điểm), chia nhỏ | Bảng so sánh nhiều model ASR |
| 3.5 | Viewer ASR: nghe audio + diff căn chỉnh | Xem từng lỗi |
| 3.6 | End-to-end: pipeline run, “điểm mất do ASR”, mẫu bị lật do ASR, ngân sách 30 giây | Biết ASR làm mất bao nhiêu điểm |

Cần từ bạn: endpoint GPU thuê (hoặc chạy server ASR ở đó), API ASR ngoài muốn so sánh.

### P4 — Mở rộng (10/11 → 13/11)
| # | Việc |
|---|---|
| 4.1 | Plugin TTS (API ngoài / mã nguồn mở), giọng theo vùng miền, augmentation nhiễu/vang; audio lưu theo cấu trúc split |
| 4.2 | Xuất manifest fine-tune ASR (audio thật train + audio TTS, tỷ lệ trộn) |
| 4.3 | App Factory: sinh app mới + test tự động + biến thể chống học thuộc (chặn tên trùng 11 app public) |
| 4.4 | So sánh run (mẫu lật kết quả), Playground từng bước, dashboard độ phủ, phát hiện gần trùng |
| 4.5 | Trang Nộp bài: sinh + validate submission, ghi điểm leaderboard, checklist (P95 < 30 giây, tất định, tham số, context, không đọc `*_environment`, chỉ model dùng-được-khi-nộp) |
| 4.6 | Checkpoint: đăng ký checkpoint tự train + “Đánh giá checkpoint này” |

### Đóng gói (14/11 → 16/11)
Dockerfile chỉ gồm `agent_core` + trọng số; chạy `--network none` với public_test; kiểm tra tất định; checksum + upload Drive. Khung Docker dựng thử từ tuần đầu (sau P0) và chạy lại mỗi tuần.

## 4. Kiểm thử
- Unit test: scorer (gold tự chấm = 100, ca biên), renderer, chuyển đổi message cho từng adapter, guard.
- Kiểm thử tích hợp: backend `oracle` chạy hết train qua đúng vòng lặp → 100.0; worker timeout; cache.
- Kiểm thử hồi quy: một tập 100 mẫu cố định chạy sau mỗi thay đổi lõi.
- UI: kiểm tra thủ công từng trang theo tiêu chí hoàn thành.

## 5. Rủi ro và cách giảm
| Rủi ro | Giảm thiểu |
|---|---|
| Lịch dày, công việc model (SFT, train) chạy song song | P0 ưu tiên CLI để bạn hiệu chỉnh teacher ngay; Data Studio xếp trước ASR Lab vì SFT là đường găng |
| Scorer local lệch scorer BTC | Cờ cấu hình cho các điểm mơ hồ; so với leaderboard public qua mỗi lần nộp |
| Định dạng huấn luyện khác định dạng suy luận | Xuất SFT dùng cùng renderer/prompt builder với `agent_core` |
| Chi phí API vượt dự kiến | Ước tính trước, hạn mức mỗi job, cache, batch API |
| Docker không chạy offline | Dựng khung từ tuần đầu, test `--network none` hằng tuần |
| Vi phạm luật dữ liệu | Lý lịch dữ liệu; chặn dataset public_test khỏi xuất SFT; chặn tên 11 app public trong App Factory |

## 6. Trạng thái triển khai (cập nhật 29/10/2026)

| Giai đoạn | Trạng thái | Kiểm chứng |
|---|---|---|
| P0 Lõi + CLI | Xong | Oracle qua pipeline khớp 1545/1545 nhãn train; scorer có unit test; runner 200 mẫu = 100.0; adapter OpenAI-compatible và Anthropic chạy end-to-end qua server giả lập (`tests/mock_llm_server.py`) |
| P1 API + UI | API xong; UI React | Mọi endpoint chạy qua TestClient |
| P2 Data Studio | Xong | Sinh 8 mẫu (history, teacher 2), cờ kiểm tra, sửa → mô phỏng lại (câu, call, history), duyệt, gán nhãn lại, xuất SFT có đổi tên app |
| P3 ASR Lab | Xong | Run chỉ-ASR (WER/CER/thực thể), run end-to-end, so sánh "điểm mất do ASR", bảng câu sai; `servers/asr_server.py` |
| P4 Mở rộng | Xong | TTS + augmentation, manifest ASR, App Factory (kiểm thử sandbox, chặn app public), so sánh run, Playground, độ phủ, gần trùng, hiệu chỉnh teacher, checklist nộp bài + validate zaic_tools, checkpoint trong registry |
| Đóng gói | Khung xong | `agent_core.infer` chạy và qua validate của zaic_tools; `docker/Dockerfile` + `run.sh` (cần trọng số + GPU để build/chạy thật) |

Mọi model (LLM, ASR, TTS) được phục vụ ở server khác; platform chỉ gọi qua API (OpenAI-compatible hoặc Anthropic), cấu hình bằng nhà cung cấp (`base_url` + khoá) và model trong registry.

- Đã kiểm chứng với server ASR thật: `servers/asr_server.py` + PhoWhisper-tiny trên GPU, nối vào platform chỉ bằng cấu hình → run chỉ-ASR và run end-to-end chạy đúng.
- Đã gửi tới API thật (khoá giả) của Anthropic, OpenAI, Gemini, OpenRouter: platform tới được endpoint và báo lỗi xác thực rõ ràng (mã 502).
  Gemini kiểm tra cấu trúc request trước khi kiểm tra khoá: request thật của platform (41–53 tool, history có tool call/kết quả, cả 3 renderer)
  được chấp nhận; phép thử này phát hiện và đã sửa lỗi gửi `seed` mặc định (Gemini không nhận).
- TTS: kiểm qua endpoint /audio/speech giả lập — preview, sinh audio cả dataset (chuẩn hoá 16 kHz mono 16-bit + augmentation), tính tiền theo ký tự, xuất manifest ASR.
- Cần khoá/endpoint thật của người dùng để có một lần gọi THÀNH CÔNG tới từng nhà cung cấp. Docker/vLLM ngoài phạm vi (model phục vụ ở server riêng).
- `training/sft`, `training/asr_ft` là script mẫu, không thuộc phạm vi platform, chưa chạy trọn vẹn.

### Cập nhật 29/10/2026 (tối) — kiểm chứng với model thật
- LLM thật: 3 run của người dùng (Claude Haiku 5.5, Claude Sonnet 5.5 qua Anthropic; Qwen3.5-9B qua OpenRouter) đều 100/100 mẫu, ~270 lần gọi mỗi run.
- Sửa lỗi tính tiền token cache (Anthropic đọc 0.1x / ghi 1.25x; OpenAI-compatible không đếm token cache hai lần); đã tính lại chi phí các run cũ.
- Guard `strip_read_filters` (bật mặc định): run Haiku thật 63.6 → 81.85.
- Lọc theo loại lỗi: 42/42 cặp (run, loại lỗi) đúng trên 4 run thật.
- ASR thật: Zipformer-30M (sherpa-onnx, `servers/start_zipformer.sh`), WER 18.8% trên 300 mẫu train.
- TTS thật: Piper tiếng Việt (`servers/start_tts.sh`); luồng sinh dữ liệu → TTS → ASR chạy trọn qua platform.
- Docker/vLLM: ngoài phạm vi theo quyết định của người dùng (model phục vụ ở server riêng).
