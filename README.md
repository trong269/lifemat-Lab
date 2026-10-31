# LifeMate Lab

Platform thử nghiệm, đánh giá và sinh dữ liệu cho bài **Zalo AI Challenge 2026 — LifeMate**
(giọng nói tiếng Việt → ASR → LLM agent gọi tool → chấm điểm theo công thức BTC).

> Repo **không chứa dữ liệu BTC** (BTC không cho phép phát tán). Mỗi thành viên tự giữ gói dữ liệu và khai báo đường dẫn trên giao diện.

## Cài đặt

Cần: Python 3.11+, [`uv`](https://docs.astral.sh/uv/), Node 18+.

```bash
git clone https://github.com/trong269/lifemat-Lab.git lifemate-lab && cd lifemate-lab
./start.sh            # lần đầu: cài thư viện + build giao diện; mở http://127.0.0.1:8765
```

## Bắt đầu (4 bước trên giao diện)

1. **Dữ liệu** — nhập đường dẫn tới thư mục giải nén gói dữ liệu BTC (thư mục chứa `train/`, `public_test/`...). Dữ liệu được đọc tại chỗ.
   Có thể đặt sẵn bằng biến môi trường: `LAB_DATA_ROOTS=/đường/dẫn/zac2026_data ./start.sh`.
2. **Kết nối model** — địa chỉ server (vLLM, server ASR/TTS kiểu OpenAI, Claude, OpenAI, Gemini, OpenRouter) + khoá + tên model.
3. **Đánh giá** — chạy model trên train/public_test, xem điểm theo công thức BTC và các lỗi hay gặp.
4. **Tạo dữ liệu** — sinh dữ liệu huấn luyện, duyệt, xuất file để fine-tune.

Ở trang **Dữ liệu** còn có thể **import kết quả do thành viên khác chạy trên máy khác**:
- **Dự đoán ASR** (JSONL `{"id", "asr_text", "history": [{"role": "user", "asr_text"}, ...]}`) → thành một model nhận dạng giọng nói dùng được ngay trong Đánh giá.
- **Dự đoán LLM / file nộp** (JSONL `{"id", "tool_calls", "state_hash"}`) → được chạy lại trên bộ mô phỏng như BTC và chấm điểm.

## Server model đi kèm (tuỳ chọn)

```bash
MODEL=150m ./servers/start_zipformer.sh   # ASR Zipformer-150M (sherpa-onnx, CPU) — http://127.0.0.1:9001/v1, tên model zipformer-150m
./servers/start_tts.sh                    # TTS Piper tiếng Việt (chỉ dùng khi sinh dữ liệu) — http://127.0.0.1:9100/v1, tên model piper
```
Trọng số được tải vào `models/` (không đưa lên git).

## Cấu trúc

```
agent_core/   solution nộp bài (vào Docker): ASR → prompt → agent → zaic_tools
lab/          platform: API (FastAPI), runner, chấm điểm, Data Studio, import dự đoán
training/     sinh dữ liệu tổng hợp, script SFT / fine-tune ASR
servers/      server ASR (sherpa-onnx / transformers) và TTS (Piper) chuẩn OpenAI
ui/           giao diện React
docker/       Docker nộp bài
docs/         hướng dẫn, kế hoạch, quyết định chấm điểm
lab_data/     (không lên git) DB, kết quả chạy, cache, khoá API — riêng từng máy
```

Tài liệu chi tiết: `docs/HUONG_DAN_SU_DUNG.md`, quyết định chấm điểm: `docs/QUYET_DINH_CHAM_DIEM.md`.

Kiểm thử: `.venv/bin/python -m pytest -q tests` (cần đã thêm nguồn dữ liệu, hoặc đặt `LAB_TRAIN_ROOT=/đường/dẫn/zac2026_data`).

## Lưu ý cho thành viên team

- **Dữ liệu BTC không nằm trong repo** — nhờ trưởng nhóm gửi gói dữ liệu, giải nén ở đâu cũng được rồi khai báo đường dẫn ở trang **Dữ liệu**. Không commit `train/`, `public_test/`, `lab_data/`, `models/`.
- **Khoá API** (Claude, OpenAI, Gemini...) chỉ lưu trong `lab_data/secrets.json` trên máy bạn; không bao giờ đưa lên git.
- **Mỗi split dùng gói `zaic_tools` riêng** nên một tiến trình chỉ xử lý một split; platform đã tự tách tiến trình, nhưng script của bạn nếu khởi chạy run cần có `if __name__ == "__main__":`.
- Đường dẫn chứa ký tự `+` thì nhớ đặt trong dấu ngoặc kép khi dùng shell.
- Giấy phép ASR Zipformer-30M (`hynt/Zipformer-30M-RNNT-6000h`) là CC-BY-NC-ND — chỉ dùng cho nghiên cứu/thi, không phân phối lại trọng số.

## Quy trình làm việc chung

```bash
git pull
./start.sh                                   # chạy platform
.venv/bin/python -m pytest -q tests          # kiểm thử (cần đã khai báo dữ liệu hoặc LAB_TRAIN_ROOT)
git checkout -b ten-nhanh && git push -u origin ten-nhanh   # làm việc trên nhánh riêng, mở Pull Request
```

Sự cố thường gặp:
- `import lab` lỗi sau khi cài: chạy `uv pip install -e .` (`start.sh` tự kiểm tra bước này).
- Giao diện trống: build lại bằng `REBUILD_UI=1 ./start.sh`.
