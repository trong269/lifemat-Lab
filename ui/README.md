# LifeMate Lab — giao diện web

Giao diện React + Vite + TypeScript cho LifeMate Lab (nền tảng phát triển bài LifeMate — Zalo AI Challenge 2026).
Backend FastAPI nằm ở `lab/api/app.py`; mọi API có tiền tố `/api`.

## Yêu cầu

- Node.js ≥ 18 (đã thử với Node 22) và npm.
- Backend chạy được: `.venv/bin/python -m lab serve --port 8765` (ở thư mục gốc repo).

## Phát triển (hot reload)

```bash
# cửa sổ 1 — backend
cd "<thư mục repo>"
.venv/bin/python -m lab serve --port 8765

# cửa sổ 2 — giao diện
cd ui
npm install
npm run dev        # http://localhost:5173
```

Vite proxy mọi request `/api` (kể cả WebSocket `/api/runs/{id}/ws`) sang `http://127.0.0.1:8765`
(xem `vite.config.ts`).

## Build để backend phục vụ

```bash
cd ui
npm install
npm run build      # tsc kiểm tra kiểu (strict) rồi vite build -> ui/dist
```

Kết quả: `ui/dist/index.html` và `ui/dist/assets/*`. Backend tự phục vụ `ui/dist` tại `/` (các đường dẫn
khác `/api/...` đều trả về `index.html` để router phía client xử lý). Lưu ý: backend chỉ mount `/assets`
nếu `ui/dist` đã tồn tại lúc khởi động — build lần đầu xong hãy khởi động lại backend
(dù không mount, file trong `ui/dist` vẫn được phục vụ qua route SPA).

Kiểm tra kiểu riêng: `npm run typecheck`.

## Cấu trúc

```
ui/
  src/
    api.ts               client API có kiểu (mọi endpoint backend), xử lý lỗi `detail`
    App.tsx, main.tsx    router, React Query, theme, toast
    components/          bộ component tự viết (Button, Card, Badge, Tabs, Modal, Drawer, Toggle,
                         Progress, Toast, JsonView, CodeEditor (CodeMirror), MultiSelect, Charts, ...)
    lib/                 định dạng số/thời gian (vi-VN), word diff (LCS), hook dùng chung
    pages/               từng trang; pages/studio/* là các tab của Data Studio
```

## Các trang

| Đường dẫn | Nội dung |
|---|---|
| `/` | Tổng quan: khoá API, chi phí, run/job gần đây, run tốt nhất, “Bắt đầu nhanh” |
| `/models` | Nhà cung cấp, nhập khoá API, registry model (LLM/ASR/TTS), kiểm tra model, “Đánh giá” |
| `/datasets`, `/datasets/:id` | Danh sách dataset; thống kê, lọc mẫu, tạo tập con / tập giấu app, mẫu gần trùng, xem mẫu |
| `/experiments`, `/experiments/new`, `/experiments/:id` | Soạn thử nghiệm (Biểu mẫu / YAML), ước tính chi phí, kiểm tra, lưu, chạy. Hỗ trợ `?llm_model=`, `?asr_model=`, `?dataset=`, `?limit=` |
| `/runs`, `/runs/:id` | Danh sách run, theo dõi trực tiếp (WebSocket, tự chuyển sang poll khi lỗi), chỉ số, phân loại lỗi, bảng mẫu |
| `/runs/:id/s/:sid` | Trace: ngữ cảnh, ASR so với gold, quỹ đạo agent từng bước, chấm điểm (gold ↔ pred) |
| `/compare?ids=a,b` | So sánh 2–4 run: chỉ số, khác biệt cấu hình, mẫu đổi điểm |
| `/asr` | ASR Lab: run có WER, chạy nhanh asr_only, điểm mất do ASR, lỗi từng câu (tô màu khác biệt từ) |
| `/studio/*` | Data Studio: Công thức, Đợt sinh, Duyệt (`/studio/review/:ds`), TTS, Xuất dữ liệu, App Factory, Hiệu chỉnh teacher |
| `/playground?ds=&sid=` | Chạy từng bước agent trên một mẫu, sửa/thực thi call, gọi tool thủ công, so với nhãn |
| `/prompts` | Sửa bộ luật (markdown), lưu thành phiên bản mới |
| `/costs` | Chi phí theo ngày, theo model, theo nguồn |
| `/submission` | Danh sách kiểm tra luật thi, validate bằng zaic_tools, tải submission, nhật ký điểm leaderboard |
| `/jobs` | Mọi job nền, tiến độ, nhật ký, huỷ |

## Phím tắt trang Duyệt

`A` duyệt · `R` loại · `N`/`J` mẫu sau · `K`/`P` mẫu trước · `E` sửa câu yêu cầu.
Trang Trace: `←` / `→` chuyển mẫu.

## Ghi chú

- Giao diện sáng/tối (nút ở góc phải trên), lưu trong `localStorage` (`lml-theme`).
- Mọi thư viện (kể cả CodeMirror) được đóng gói cục bộ, không tải CDN lúc chạy.
- Điểm run hiển thị theo thang 0–100; điểm từng mẫu (0–1) được nhân 100 khi hiển thị.
