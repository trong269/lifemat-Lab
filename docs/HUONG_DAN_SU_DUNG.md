# LifeMate Lab — Hướng dẫn sử dụng

Platform thử nghiệm, đánh giá và sinh dữ liệu cho bài ZAC 2026 LifeMate (giọng nói tiếng Việt → ASR → agent gọi tool → chấm điểm).
Chạy local, một người dùng, giao diện tiếng Việt.

## 1. Khởi động

```bash
cd lifemate-lab
./start.sh                  # lần đầu: cài thư viện Python + build UI; sau đó mở http://127.0.0.1:8765
```

- Cần: `uv`, Node 18+ (đã có trên máy này).
- Build lại UI sau khi sửa code giao diện: `REBUILD_UI=1 ./start.sh`.
- Dữ liệu platform nằm trong `lab_data/` (SQLite, run, trace, dataset tổng hợp, file xuất, cache). Xoá thư mục này = làm lại từ đầu.

### Dữ liệu nằm ngoài repo
Dữ liệu BTC không nằm trong code. Lần đầu mở platform, vào **Dữ liệu** → nhập đường dẫn tới thư mục giải nén gói dữ liệu
(ví dụ: `~/data/zac2026_data`), hoặc đặt `LAB_DATA_ROOTS=<đường dẫn>` trước `./start.sh`.
Chuyển dữ liệu sang chỗ khác thì chỉ cần thêm đường dẫn mới: platform tự cập nhật, các lần chạy cũ vẫn xem được.
Cũng ở trang **Dữ liệu**: import file dự đoán ASR (thành model nhận dạng giọng nói) và file kết quả LLM dạng submission (được chạy lại và chấm).

## 2. Giao diện: 4 mục chính

| Mục | Làm gì |
|---|---|
| **Bắt đầu** | 3 bước hướng dẫn (bước nên làm tiếp được tô sáng), việc đang chạy, kết quả gần đây, chi phí API |
| **Kết nối model** | Một form duy nhất: model chạy ở đâu (Server của tôi / Claude / OpenAI / Gemini / OpenRouter), dùng để làm gì (LLM / nhận dạng giọng nói / đọc văn bản), địa chỉ server, khoá, tên model → **Lưu & kiểm tra kết nối** |
| **Đánh giá** | Chọn dữ liệu, model LLM, nhận dạng giọng nói (mặc định dùng chữ có sẵn), số mẫu → **Chạy đánh giá**. Kết quả: điểm theo công thức BTC, "Model hay sai ở đâu?" viết bằng lời, danh sách mẫu sai; xem từng mẫu (đáp án đặt cạnh việc model đã làm); so sánh 2 lần chạy; tải và kiểm tra file nộp bài |
| **Tạo dữ liệu** | 1. Tạo (model viết câu + model gán nhãn + số mẫu, có "Tạo thử 5 mẫu") → 2. Duyệt (Duyệt / Loại / sửa câu hoặc đáp án, phím A / R / J / K) → 3. Xuất file train |

Phần tuỳ chỉnh chi tiết của mỗi trang nằm trong mục thu gọn "Tuỳ chỉnh thêm" / "Nâng cao".

### Kết nối model (việc duy nhất phải làm)
Vào **Kết nối model → Thêm kết nối**:
1. Chọn nơi model chạy. Model bạn tự phục vụ (vLLM, llama.cpp, server ASR/TTS kiểu OpenAI) chọn **Server của tôi** và điền địa chỉ, ví dụ `http://10.0.0.5:8000/v1`.
2. Chọn vai trò: LLM, nhận dạng giọng nói (ASR) hoặc đọc văn bản (TTS).
3. Nhập khoá nếu server cần. Khoá lưu ở `lab_data/secrets.json` (quyền 600), không ghi vào cấu hình, trace hay log.
4. Điền tên model đúng như server đang phục vụ, rồi bấm **Lưu & kiểm tra kết nối**. Nếu lỗi, thông báo của server hiện ngay trong form.

Phần "Nâng cao" của form (không bắt buộc): giá để tính chi phí, số tham số, đánh dấu model nằm trong bài nộp, tham số thêm dạng JSON (ví dụ `{"temperature": 0}`; với Claude `{"effort": "low"}`).

### Server ASR Zipformer-30M (đã dựng sẵn trên máy này)
Model `hynt/Zipformer-30M-RNNT-6000h` (sherpa-onnx, chạy CPU), API chuẩn OpenAI `/v1/audio/transcriptions`, output chữ thường.
```bash
./servers/start_zipformer.sh          # bật (chạy nền), http://127.0.0.1:9000/v1, log: servers/zipformer_9000.log
./servers/start_zipformer.sh stop     # tắt
HOST=0.0.0.0 PORT=9000 INT8=1 THREADS=8 ./servers/start_zipformer.sh   # tuỳ chọn: mở cho máy khác, bản int8, số luồng
```
Kết nối trên UI: **Server của tôi** · vai trò **nhận dạng giọng nói** · địa chỉ `http://127.0.0.1:9000/v1` · không cần khoá · tên model `zipformer-30m-rnnt`.
Nâng cao (tuỳ chọn): số tham số `0.03`, đánh dấu nằm trong bài nộp. Đo trên 300 mẫu train: WER 18.8%, P50 1.7 s/mẫu (gồm cả các lượt history).
License CC BY-NC-ND 4.0 (không thương mại, không phát hành bản phái sinh/fine-tune) — nên xác nhận với BTC trước khi dùng trong bài nộp.

### Server ASR Zipformer-150M (mạnh hơn, khuyên dùng)
`hynt/ZipFormer-150M-CR-CTC-RNNT-6000h` (sherpa-onnx, license CC BY-NC-ND 4.0, phát hành 09/09/2026).
```bash
MODEL=150m ./servers/start_zipformer.sh          # bật: http://127.0.0.1:9001/v1      MODEL=150m ./servers/start_zipformer.sh stop
```
Kết nối trên UI: **Server của tôi** · **nhận dạng giọng nói** · `http://127.0.0.1:9001/v1` · tên model `zipformer-150m`.
Đo trên 300 mẫu train (CPU, 8 luồng): WER 14.3% (30M: 18.8%), giữ đúng thực thể 62.6% (30M: 60.4%); 0.25–0.7 s/câu,
P50 4.0 s / P95 8.9 s mỗi mẫu khi chạy 4 mẫu song song. Dùng cổng và tên model riêng, không thay model phía sau cổng cũ
(platform cache transcript theo địa chỉ + tên model). Chạy GPU: cần sherpa-onnx bản CUDA trong `servers/.venv-gpu`, rồi `PROVIDER=cuda`.

### Server TTS Piper tiếng Việt (đã dựng sẵn, chỉ dùng lúc phát triển)
Piper (ONNX, CPU, license MIT), API chuẩn OpenAI `/v1/audio/speech`, 2 giọng: `vi_VN-vais1000-medium` (1 người đọc) và
`vi_VN-vivos-x_low` (65 người đọc, chọn bằng `vi_VN-vivos-x_low:<số>`); `random` hoặc tên lạ như `alloy` → chọn ngẫu nhiên.
```bash
./servers/start_tts.sh          # bật: http://127.0.0.1:9100/v1      ./servers/start_tts.sh stop   # tắt
```
Kết nối trên UI: **Server của tôi** · vai trò **đọc văn bản (TTS)** · địa chỉ `http://127.0.0.1:9100/v1` · không cần khoá · tên model `piper`.
Trong Data Studio → TTS, khai báo giọng theo vùng, ví dụ `{"bac": ["vi_VN-vais1000-medium"], "trung": ["vi_VN-vivos-x_low:3"], "nam": ["vi_VN-vivos-x_low:40"]}`.
Đã kiểm trọn luồng sinh dữ liệu → TTS Piper → ASR Zipformer: WER 31% (giọng Piper chất lượng thấp + nhiễu augmentation).

### Chế độ nâng cao
Công tắc **Chế độ nâng cao** ở cuối thanh bên hiện lại toàn bộ công cụ chi tiết: Datasets, Thử nghiệm (cấu hình YAML đầy đủ), Runs và Trace kỹ thuật, So sánh, ASR Lab, Data Studio đầy đủ (công thức kịch bản, TTS, App Factory, hiệu chỉnh teacher), Playground, Bộ luật, Chi phí, Nộp bài, Jobs, và trang Mô hình & Khoá dạng bảng. Khi bật, trang kết quả và trang mẫu có thêm liên kết "Chi tiết kỹ thuật".

### Điểm số
Đúng công thức BTC: gold rỗng → 1 nếu dự đoán rỗng; `state_hash` khác → 0; ngược lại F1 với P = M/(M+U), R = M/|G|, ghép cặp cực đại, tham số fuzzy so token-F1 > 0.6. Các điểm luật chưa nói rõ (thừa tham số tuỳ chọn, so list theo thứ tự hay tập, cách tách token) là tuỳ chọn trong thử nghiệm (`score`) — hiệu chỉnh bằng cách so điểm local với leaderboard (trang Nộp bài).

### Guard `strip_read_filters` (bật mặc định)
Bỏ bộ lọc tuỳ chọn của tool đọc mà đáp án train hiếm khi dùng (`bill_payment.list_bills.type`, khoảng ngày của `calendar.list_events`,
`weather.*.location`, `smart_home.get_status.room`...), giữ các tham số đáp án hay dùng (`contacts.search.query`, `gold_price.type`...,
danh sách `keep` cấu hình được) và mọi tham số ID (`x-ref`). Tool đọc không đổi state nên `state_hash` không bị ảnh hưởng.
Ước tính lại trên 3 run thật (100 mẫu train): Sonnet 5.5 72.4 → 90.4, Haiku 5.5 63.6 → 81.7, Qwen3.5-9B 34.8 → 43.4.
Trần mất điểm (oracle đi qua guard): 59/1545 mẫu bị đổi so với đáp án. Danh sách `keep` đo trên chính train nên con số trên có phần lạc quan — kiểm lại bằng một run mới.

### Quy trình sinh dữ liệu khuyến nghị
1. **Hiệu chỉnh teacher**: chạy model teacher trên train (Data Studio → Hiệu chỉnh teacher, hoặc một thử nghiệm bình thường); sửa bộ luật tới khi điểm ≈ 90+.
2. **Công thức**: chọn writer + teacher (+ teacher 2 để đối chiếu), tỷ trọng kịch bản, app, vùng miền, độ dài history, hạn mức chi phí. Bấm *Xem trước 5 mẫu*.
3. **Sinh** → **Duyệt**: hàng đợi ưu tiên mẫu có cờ lỗi / teacher bất đồng. Sửa câu, state hay tool call rồi *Lưu & mô phỏng lại* (tool_results, final_state luôn do zaic_tools tính lại). Phím tắt: A duyệt, R loại, J/K chuyển mẫu.
4. **Kiểm tra ngẫu nhiên** 5–10% mẫu sạch; tỉ lệ loại cao → bỏ cả đợt.
5. **TTS** (nếu cần audio) → **Xuất** SFT (trộn train + tổng hợp theo trọng số, tuỳ chọn đổi tên app chống học thuộc) và manifest ASR.

Luật dữ liệu được platform chặn sẵn: không xuất public_test; không dùng 11 app chỉ có ở public_test trong Data Studio / App Factory.

## 3. Train và đánh giá checkpoint (trên máy GPU thuê)

```bash
pip install -r training/requirements-train.txt
python training/sft/train_sft.py --model <model gốc <5B> --data <file sft.jsonl> --out ckpt/sft_v1 [--lora]
vllm serve ckpt/sft_v1 --served-model-name lifemate-llm --max-model-len 16384 --enable-auto-tool-choice --tool-call-parser hermes
python training/asr_ft/train_asr.py --model <model ASR> --data <asr_manifest.jsonl> --out ckpt/asr_v1
pip install -r servers/requirements-asr.txt && python servers/asr_server.py --model ckpt/asr_v1 --port 9000
```
Sau đó sửa `base_url` của nhà cung cấp `vllm` / `asr_server` thành địa chỉ máy GPU, khai báo model (nguồn `checkpoint`, ghi base_model / train_dataset / train_script) và chạy thử nghiệm.

## 4. Docker nộp bài
Chỉ chứa `agent_core` + `servers/asr_server.py` + vLLM + trọng số (`docker/Dockerfile`, `docker/run.sh`, cấu hình `agent_core/submit_config.yaml`).
```bash
cp -r ckpt/sft_v1 models/llm && cp -r ckpt/asr_v1 models/asr
docker build -f docker/Dockerfile -t lifemate:submit .
docker run --rm --gpus all --network none -v "$PWD/public_test":/data -v "$PWD/result":/app/result lifemate:submit
```
`agent_core.infer` tự nhận diện `/data` là thư mục split hay thư mục cha, dùng `zaic_tools` của chính split được mount, mỗi mẫu đúng một ToolEnv, luôn ghi đủ dòng kể cả khi một mẫu lỗi. Ghim `BASE_IMAGE` vào phiên bản cụ thể trước khi nộp.

## 5. CLI
```bash
.venv/bin/python -m lab serve --port 8765
.venv/bin/python -m lab keys set anthropic sk-...
.venv/bin/python -m lab models
.venv/bin/python -m lab datasets
.venv/bin/python -m lab run cau_hinh.yaml --limit 50       # cấu hình giống form Thử nghiệm
.venv/bin/python -m pytest -q tests
```

## 6. Cấu trúc mã
```
agent_core/   solution (vào Docker): data, render, prompts/, llm/, asr/, guards, agent, pipeline, infer
lab/          platform: core/ (db, models, datasets, experiments, cache, jobs), runner/, scoring/, studio.py, playground.py, submission.py, api/
training/     gen_synthetic/ (state_gen, scenarios, generate, labeler, checks, ops, export, audio, app_factory), sft/, asr_ft/
servers/      asr_server.py
ui/           React + Vite
docker/       Dockerfile, run.sh
tests/        unit + tích hợp, mock_llm_server.py (giả lập OpenAI/Anthropic để kiểm thử không cần khoá)
```

## 7. Xử lý sự cố
- *“chưa có khoá API…”*: nhập khoá ở Mô hình & Khoá hoặc đặt biến môi trường rồi khởi động lại.
- Run dừng giữa chừng khi tắt server → trạng thái `interrupted`; mở run và bấm *Tiếp tục* (mẫu đã xong được giữ lại).
- Mẫu quá thời gian bị dừng cưỡng bức sau `timeout_s` + ân hạn, dòng nộp dùng các call đã gọi tới lúc đó.
- Cache LLM/ASR nằm ở `lab_data/cache.sqlite`; tắt bằng `use_cache: false` trong thử nghiệm.
