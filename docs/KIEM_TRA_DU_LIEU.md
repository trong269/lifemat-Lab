# Kiểm tra chất lượng dữ liệu BTC (v3.2.0, 31/10/2026)

Phạm vi: train 1545 mẫu / 5036 file audio; public_test 634 mẫu / 1933 file audio.
Với public_test chỉ kiểm tra **đầu vào** (cấu trúc, audio); không gán hay suy ra nhãn.

## Kết luận

Nhãn train **rất sạch**: chỉ có **1 nhãn sai / 1545**. Phần "làm khó" của BTC nằm ở **audio** (nhiễu nền, giọng địa phương,
tên nước ngoài, một ít file bị cắt) và ở **lời nói** (tự sửa giữa câu, nói vấp, cách nói số), không nằm ở nhãn.
Mức nhiễu audio của public **giống train**, nên train là ảnh đại diện tốt cho public.

## 1. Nhãn train

| Kiểm tra | Kết quả |
|---|---|
| Phát lại `label.tool_calls` trên `zaic_tools`: call bị từ chối / `tool_results` khác / `final_state` khác | 0 / 0 / 0 |
| Tool trong nhãn hoặc trong history mà chưa cài | 0 |
| ID trong nhãn không lấy từ kết quả đọc trước đó (bịa ID) | **1: `train_1696`** |
| Số trong tham số không có căn cứ trong lời nói / kết quả đọc | 0 (10 trường hợp nghi vấn, tính tay đều đúng: 3,6 km × 2 × 1500 bước = 10800; 2 chỉ × giá bán = 23,22 tr; 18:30 − 14:25 = 245 phút…) |
| `sys.ask_missing_info` không ở cuối | 0 |
| history: `tool_results` lỗi, thiếu audio, thiếu `audio_text` | 0 |

**`train_1696` sai:** nhãn gửi `chat_ott.send_message` tới `chat_6142`, nhưng chat này không tồn tại (danh sách chat không có "bà Hồng").
Simulator trả `done: false` nên state không đổi. → **Loại mẫu này khỏi SFT** (hoặc sửa thành `sys.ask_missing_info` ở bước nhắn tin).

7 mẫu có app trong `final_state` nhưng state đã chuẩn hoá không đổi (`notes`, `maps`): chỉ đổi trường văn bản tự do
(BTC bỏ các trường này khi tính hash). Đây không phải lỗi.

## 2. Audio (train và public)

| | train | public |
|---|---|---|
| Định dạng | 16 kHz mono 16-bit, 100% | giống train |
| Thời lượng p50 / p99 | 4,1 s / 13,2 s | 4,3 s / 14,0 s |
| Có nhiễu nền (nền > −70 dB) | 71% | 72% |
| Nhiễu nền mạnh (nền > −45 dB) | 21% | 22% |
| Nghi bị cắt đầu (vào lời ngay từ mẫu đầu) | 0,7% | **1,8%** |
| Nghi bị cắt đuôi | 8,2% | 6,7% |
| Clipping / file thiếu / audio trùng giữa hai tập | 0 / 0 / 0 | 0 / 0 / 0 |

Ảnh hưởng lên ASR của đội (WER 3,96% trên toàn train):

| Nhóm | WER |
|---|---|
| Nền sạch | 3,2% |
| Nhiễu nền mạnh | 4,8% |
| SNR < 15 dB | 5,6% |
| **Bị cắt đầu** | **10,9%** (mất từ đầu câu 15% so với 4%) |
| Lượt cuối / lượt history | 4,4% / 3,5% |

Đối chiếu bằng hai ASR độc lập (ASR của đội và Zipformer-150M) trên 60 câu lệch nhiều nhất:
- **Audio khác `audio_text` thật** (cả hai ASR cùng nghe ra một kiểu): rất ít. Ví dụ `train_1581` (audio "có lịch họp với…",
  chữ "họp online với chị…"), `train_1179 u2` (audio nói lặp, chữ đã làm sạch), `train_1059 u3` (10 từ trong 1,6 s, mất đuôi),
  `train_0371 u5` và `train_1620 u1` (mất mấy từ đầu). Không làm sai nhãn.
- Phần lớn câu lệch là **lỗi ASR**: giọng miền Trung ("rứa, ni, răng, hè"), tên nước ngoài (Meera Kapoor, Kowalski, RemitNow),
  tên riêng trùng từ thường (Mạ/mẹ, Minh/mình), chuỗi số dài.
- ASR của đội có **ảo giác chép danh sách tên** khi audio khó (`train_0192 u4` ra cả danh bạ, `train_0979 u2`, `train_1320`):
  có vẻ do nhồi ngữ cảnh vào prompt ASR. Nên giới hạn độ dài output hoặc đối chiếu với thời lượng audio.

## 3. Cấu trúc public_test

634 id duy nhất; mọi tool đã cài đều có trong catalog; `_meta` khớp `context`; số file audio khớp số lượt user;
tool trong history đều đã cài và đều chạy thành công; không lộ `audio_text`/`label`.

## 4. Việc nên làm

1. Bỏ `train_1696` khỏi dữ liệu SFT và đánh giá.
2. Khi sinh dữ liệu TTS: thêm nhiễu nền cho khoảng 70% mẫu (20% nhiễu mạnh, SNR 10–20 dB), cắt 1–2% mẫu sát đầu,
   cắt khoảng 7% mẫu sát đuôi, thêm nói lặp/vấp, để khớp phân bố ở trên.
3. ASR: tăng dữ liệu giọng miền Trung, tên nước ngoài, chuỗi số; đệm 100–200 ms im lặng vào đầu audio trước khi nhận dạng
   (giúp với các file bị cắt đầu, cần đo lại); chặn output dài bất thường so với thời lượng.
