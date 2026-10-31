# Quyết định về chấm điểm và hành vi agent

## Cập nhật 30/10/2026 — hiệu chỉnh theo leaderboard public (Haiku 5.5 + Zipformer-150M, 634 mẫu)

| Thí nghiệm | Nếu BTC chấm chặt | Nếu BTC nới lỏng | Leaderboard thật | Kết luận |
|---|---|---|---|---|
| Bật / tắt `strip_read_filters` | bật hơn ~+18 điểm | ~0 | 63.93 / 64.41 (−0.48) | **Tham số thừa không làm call trượt** |
| Bật / tắt `restore_case` (21 mẫu khác nhau, cùng phản hồi model nhờ cache) | bật hơn ~+0.5 điểm | 0 | bằng nhau | **Không phân biệt hoa/thường** |

Điểm chính của platform từ nay: chỉ xét tham số có trong gold (thiếu vẫn sai), không phân biệt hoa/thường, gộp khoảng trắng.
Điểm chặt theo từng chữ của luật được tính kèm (`strict_keys`, `case_sensitive`, `literal`).
Kiểm chứng: chấm local Haiku + Zipformer-150M trên 100 mẫu train = 64.4, sát leaderboard public 63.9–64.4.
Guard `strip_read_filters` và `restore_case` tắt mặc định (không giúp theo cách chấm này). Mọi run cũ đã được chấm lại
(sao lưu: `lab_data/lab.sqlite.bak_truoc_doi_cach_cham_LB`, `traces.jsonl.bak_truoc_doi_cach_cham_LB`).

## Bản ghi ban đầu (30/10/2026, trước khi có kết quả leaderboard)

Luật BTC: hash khác gold → 0; M = 0 → 0; ngược lại F1 với P = M/(M+U), R = M/|G| (U gồm call bị từ chối vì schema);
gold rỗng → 1 khi và chỉ khi nộp rỗng; call khớp khi cùng tên, tham số không fuzzy "identical", tham số fuzzy token-F1 > 0.6
(sau lowercase + NFC); không xét thứ tự, mỗi call ghép tối đa một lần. Điểm cuối = 100/N × tổng.

Scorer của platform đã được kiểm độc lập (vét cạn) trên 400 mẫu: khớp từng mẫu, `state_hash` chạy lại khớp 100%.

| # | Điểm luật chưa rõ | Platform chấm | Agent làm | Ghi chú |
|---|---|---|---|---|
| A1 | Tham số thừa (pred có, gold không) | Chặt: là sai. Kèm điểm tham khảo `lenient_keys` | Chỉ điền tham số người dùng nói; guard `strip_read_filters` | Lệch 20–26 điểm giữa hai cách hiểu — hỏi BTC / thử leaderboard |
| A2 | Hoa/thường ở tham số không fuzzy | Phân biệt (đúng chữ "identical"). Kèm điểm tham khảo `case_insensitive` | Guard `restore_case` (tên người, tỉnh thành viết hoa từng từ; mã tiền tệ/sân bay viết hoa) + luật 12 trong `rules_v2` | ASR không biết hoa/thường; nhãn train: contacts.search.query viết hoa từng từ 204/204 |
| A3 | Kiểu giá trị | So theo giá trị: 1 == 1.0; số ≠ chuỗi; bool ≠ số | `validate_repair` ép đúng kiểu schema | Không đổi điểm mẫu nào trên dữ liệu hiện tại |
| A4 | Thứ tự trong list | Có xét thứ tự | Guard `ask_params_order` xếp params của ask_missing_info theo **bảng chữ cái** | Ví dụ BTC `["playlist_id","track_id"]` ngược thứ tự schema, trùng bảng chữ cái — hỏi BTC |
| A5 | ask_missing_info | Như tool thường | Tối đa 1 lần, call cuối (`ask_last`) | Khớp 217/217 nhãn train |
| A6 | Tách token cho token-F1 | Theo khoảng trắng | Chép đúng lời người dùng, không thêm dấu chấm cuối (`rules_v2` luật 11) | Chỉ đổi 1/400 mẫu |
| A7 | Ghép cặp | Ghép cực đại | — | Ghép tham lam cho cùng kết quả trên 400 mẫu |
| A8 | env.validate() | — | Dùng (`validate_repair`) | BTC hướng dẫn dùng trong README |

Mặc định mới cho thử nghiệm: bộ luật `rules_v2`; guard `validate_repair, iso_time, restore_case, ask_params_order,
strip_read_filters, dedupe_reads, ask_last`; một tool call mỗi bước (`single_tool_call`).
Oracle đi qua `restore_case` + `ask_params_order` vẫn tái tạo đúng 1545/1545 nhãn train.
