# Phân tích dữ liệu & đề xuất sinh dữ liệu tổng hợp (31/10/2026)

Nguồn số liệu: train (1545 mẫu, có nhãn), public_test (634 mẫu, chỉ dùng **thống kê đầu vào**, không dùng nhãn/nội dung),
và các run trong platform (100 mẫu train đầu, cách chấm đã hiệu chỉnh theo leaderboard: bỏ qua tham số thừa, không phân biệt hoa/thường).

## 1. Điểm đang mất ở đâu

| Cấu hình (100 mẫu train) | Điểm |
|---|---|
| Sonnet 5.5, chữ gold | 96.8 |
| Haiku 5.5, chữ gold | 94.1 |
| Haiku 5.5 + **ASR 1.7B của đội** (WER 4%) | 90.1 |
| Haiku 5.5 + Zipformer-150M (WER 14%) | 64.4 (≈ leaderboard public 63.9–64.4) |
| **Qwen3.5-9B**, chữ gold | **40.5–47.9** |

1. **ASR quyết định khoảng 26 điểm.** Cùng Haiku: Zipformer 64 → ASR đội 90. Lỗi ASR gây hại nhất là **tên người** ("Minh"→"mình", "Mai"→"má"),
   **số và thời gian** ("15 phút"→"30 phút"), **từ khoá hành động** ("bốn chỗ"→"bốn job", "huỷ lịch"→"nghỉ dịch").
2. **Model nhỏ là nút thắt thứ hai.** Model nộp bài phải < 5B, mà Qwen3.5-9B qua API chỉ được 40–48 (Haiku: 94). Phân loại 65 mẫu Qwen sai:
   - 37 **dừng sớm**: đọc xong (vd `contacts.search`) rồi dừng, không gọi bước ghi; 27/37 bước cuối trả về rỗng.
   - 15 **hết 30 giây** giữa chừng (P50 20 s/mẫu qua OpenRouter).
   - 5 không gọi tool nào; chỉ 8 là gọi đủ bước nhưng sai tham số.
   → Model nhỏ thiếu **kỷ luật vòng lặp agent** (đi tiếp sau khi đọc, biết khi nào dừng), không phải thiếu hiểu biết. Đây là thứ SFT dạy tốt nhất.
3. **Model mạnh vẫn sai ở:** đọc thừa (call không có trong đáp án bị tính vào U), nội dung tự do diễn đạt khác đáp án (token-F1 ≤ 0.6),
   hỏi lại khi không cần, thiếu bước ghi trong câu nhiều ý, tính sai thời gian (`wrong_time`).

## 2. Public / private khác train thế nào

| | train | public |
|---|---|---|
| Lượt history TB / 0 lượt / ≥ 4 lượt | 2.26 / 34% / 21% | 2.05 / 34% / 19% |
| App cài TB | 9.2 | 8.5 |
| Mẫu có app không có trong train | 0% | **65%** |
| Call trong history thuộc app mới | — | **23%** |

- Phân bố history, thời điểm (09–12/2026), thành phố (Hà Nội > TP.HCM > Đà Nẵng > Huế > Cần Thơ) giống nhau → sinh dữ liệu theo đúng phân bố này.
- **Khác biệt lớn duy nhất là app mới** (11 app ở public, private gần như chắc có app mới khác). Tool của app mới: 14 tham số ID (`x-ref`),
  12 số nguyên, 5 enum, ngày/giờ — cùng kiểu với app train. → Model phải **đọc schema**, không học thuộc tên tool.
- Các yêu cầu ngoài phạm vi trong train nhắc tới đúng các chức năng sau này thành app public (kho đồ ăn, đi chợ, vé tàu, cổ phiếu, công thức nấu ăn)
  → private có thể thêm app từ cùng "kho ý tưởng": khách sạn, khám bệnh, phạt nguội, file đám mây, thể thao, phim, chuyển tiền quốc tế, camera...

## 3. Quy ước của nhãn mà dữ liệu tổng hợp phải theo

| Quy ước | Bằng chứng (train) |
|---|---|
| ID lấy từ kết quả đọc trong lượt, hoặc **dùng lại từ history mà không đọc lại** | 839 / 303 / 1 lần đoán |
| Tool đọc gọi với `{}`, trừ tham số tìm kiếm (`contacts.search.query` 87%, `gold_price.type` 100%...) | `list_bills` 112/112 là `{}` |
| Trùng tên trong danh bạ / thiếu giá trị bắt buộc → `sys.ask_missing_info`, **1 lần, là call cuối**, làm xong phần làm được trước | 217/217 |
| 7% mẫu không gọi tool: app chưa cài, rút lại ("à thôi"), tán gẫu, không an toàn, giá trị vô lý, đã làm/đã biết từ history | 111 mẫu |
| Người dùng tự sửa giữa câu → làm theo ý cuối | |
| Điều kiện ("nếu mai mưa") → đọc nguồn rồi rẽ nhánh; điều kiện đã biết từ history thì không đọc lại | |
| Số bước: 1–3 call là chính, tới 6 call; 1–2 app/mẫu là chính, tới 5 app | |

Không cần tốn công cho: tham số tuỳ chọn thừa và hoa/thường (BTC không trừ điểm — đã kiểm bằng leaderboard).

## 4. Đề xuất bộ dữ liệu SFT (≈ 10–20k trajectory)

| Phần | Tỉ lệ | Cách làm (platform) |
|---|---|---|
| **Train thật** (chữ gold) | ×2–3 | Xuất từ dataset `train` |
| **Train + transcript ASR thật** | ×1–2 | Lấy `asr_text` từ file dự đoán của đội thay cho `audio_text`, giữ nhãn gốc → model học chịu nhiễu ASR thật |
| Tổng hợp trên app train | ~35% | Data Studio, tỉ trọng kịch bản ở mục 5 |
| Tổng hợp trên **app tự tạo** | ~30% | App Factory: ≥ 30 app từ "kho ý tưởng" mục 2; không dùng 11 app public |
| Đổi tên app/tool (chống học thuộc) | 20% số mẫu | Tuỳ chọn `mutate_ratio` khi xuất |
| Có nhiễu ASR | 30–50% số mẫu tổng hợp | TTS (giọng 3 miền) → ASR của đội → dùng transcript làm input |

Giữ một **tập kiểm tra giấu app** (vài app train không đưa vào SFT) để đo khả năng tổng quát — gần với tình huống private.

## 5. Tỉ trọng kịch bản đề xuất (khác mặc định, theo chỗ đang mất điểm)

| Kịch bản | Tỉ trọng | Lý do |
|---|---|---|
| Đọc rồi ghi (cần ID) | 22 | lỗi số 1 của model nhỏ: dừng sau bước đọc |
| Nhiều ý (2–3 app, 3–6 call) | 18 | thiếu bước ghi trong câu nhiều ý |
| Tham chiếu history (dùng lại ID, không đọc lại) | 12 | 21% mẫu có ≥ 4 lượt history; đọc thừa |
| Có điều kiện | 7 | |
| Tính thời gian / số tiền ("trước giờ hẹn 45 phút", tổng hoá đơn) | 8 | `wrong_time`, hash sai |
| Hỏi lại: trùng tên / thiếu giá trị / làm một phần rồi hỏi | 12 | |
| Một hành động / hỏi thông tin | 10 | |
| Tự sửa giữa câu | 4 | |
| Ngoài phạm vi (đủ 6 loại, gồm app *gần giống* nhưng không đúng) | 7 | giữ đúng 100% hiện có |

Mỗi trajectory: **mỗi bước một tool call**, câu trả lời cuối ngắn (1 câu) — vừa đúng cách agent chạy, vừa giảm token/thời gian cho model nhỏ.

## 6. Chọn teacher và chi phí

- Teacher đạt chuẩn (≥ 90 trên train, chữ gold): **Haiku 5.5 ~94**, **Sonnet 5.5 ~97**.
- Chi phí ước tính mỗi mẫu tổng hợp (writer + các lượt history + teacher): Haiku ≈ $0.005–0.01, Sonnet ≈ $0.05–0.1.
  → Đề xuất: Haiku làm writer + teacher; Sonnet làm teacher thứ hai đối chiếu trên 20–30% mẫu (ưu tiên kịch bản khó: nhiều ý, điều kiện, history).
  10k mẫu ≈ $100–200.
- Duyệt: ưu tiên mẫu có cờ lỗi / hai teacher bất đồng; kiểm tra ngẫu nhiên 5–10% mẫu sạch.

## 7. Thứ tự làm

1. Chạy LLM với ASR của đội trên public_test → nộp leaderboard (kỳ vọng tăng mạnh so với 64, vì ASR là lỗ lớn nhất).
2. Xuất "train + train-ASR" làm bộ SFT v0 → fine-tune model < 5B → đo trên tập giấu app.
3. Sinh 2–3k mẫu tổng hợp (mục 5) + 10 app tự tạo → SFT v1 → đo. Mở rộng tới 10–20k nếu điểm còn tăng.
4. Thêm nhánh TTS + ASR cho dữ liệu tổng hợp khi model đã ổn với chữ sạch.
