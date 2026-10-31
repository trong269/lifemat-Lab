"""Danh mục kịch bản sinh dữ liệu. `expect` dùng cho kiểm tra tự động: act | read | ask | oos | any."""
from __future__ import annotations

SCENARIOS = {
    "single_action": {"name": "Một hành động", "expect": "act", "traps": [],
                      "desc": "Người dùng yêu cầu MỘT hành động ghi/đổi dữ liệu trên một app đã cài (đặt báo thức, tạo nhắc, bật thiết bị...)."},
    "read_then_write": {"name": "Đọc rồi ghi", "expect": "act", "traps": [],
                        "desc": "Yêu cầu một hành động cần tra cứu trước để lấy ID/đối tượng (gửi tin cho một người trong danh bạ, tắt đúng thiết bị, "
                                "trả đúng hoá đơn, dời đúng sự kiện...). Nhắc tên/mô tả đối tượng có thật trong dữ liệu app, không nói ID."},
    "multi_intent": {"name": "Nhiều ý", "expect": "act", "traps": [],
                     "desc": "Một câu chứa 2-3 yêu cầu trên 2-3 app khác nhau, nối bằng 'rồi', 'với', 'xong'. Mọi yêu cầu đều làm được với dữ liệu hiện có."},
    "conditional": {"name": "Có điều kiện", "expect": "any", "traps": [],
                    "desc": "Yêu cầu có điều kiện phụ thuộc dữ liệu (thời tiết, giá vàng, số dư, lịch...): 'nếu ... thì ..., không thì ...'."},
    "info_query": {"name": "Hỏi thông tin", "expect": "read", "traps": [],
                   "desc": "Câu hỏi tra cứu thông tin từ một app đã cài (số dư, lịch hôm nay, thời tiết, giá vàng...), không yêu cầu thay đổi gì."},
    "ask_ambiguous": {"name": "Hỏi lại: trùng tên", "expect": "ask", "traps": ["duplicate_name"],
                      "desc": "Yêu cầu gọi/nhắn/chuyển tiền cho một người mà trong danh bạ có từ 2 người cùng tên (xem ghi chú bẫy). "
                              "Chỉ nói tên, không nói quan hệ, để trợ lý không xác định được là ai."},
    "ask_missing_value": {"name": "Hỏi lại: thiếu giá trị", "expect": "ask", "traps": [],
                          "desc": "Yêu cầu một hành động nhưng thiếu giá trị bắt buộc (không nói số tiền, không nói giờ, không nói chọn cái nào...)."},
    "partial_then_ask": {"name": "Làm một phần rồi hỏi", "expect": "ask", "traps": ["duplicate_name"],
                         "desc": "Hai yêu cầu: một yêu cầu làm được ngay, một yêu cầu thiếu thông tin hoặc trùng tên (xem ghi chú bẫy)."},
    "self_correction": {"name": "Tự sửa giữa câu", "expect": "act", "traps": [],
                        "desc": "Người dùng nói một giá trị rồi tự sửa ('à không', 'à nhầm', 'thôi lấy ...'). Trợ lý phải làm theo ý cuối."},
    "history_reference": {"name": "Tham chiếu history", "expect": "act", "traps": [], "needs_history": True,
                          "desc": "Yêu cầu tiếp nối hội thoại trước, nhắc lại đối tượng đã nói ('cái đó', 'chuyến đấy', 'người lúc nãy') thay vì nói tên đầy đủ."},
    "oos_not_installed": {"name": "Ngoài phạm vi: app chưa cài", "expect": "oos", "traps": [],
                          "desc": "Yêu cầu một việc cần tới chức năng KHÔNG có trong các app đã cài (xem 'Chức năng không có'). Nói tự nhiên như thể trợ lý làm được."},
    "oos_chitchat": {"name": "Ngoài phạm vi: tán gẫu", "expect": "oos", "traps": [],
                     "desc": "Câu chào hỏi, cảm ơn, khen, than thở, tán gẫu — không yêu cầu hành động nào."},
    "oos_retraction": {"name": "Ngoài phạm vi: rút lại", "expect": "oos", "traps": [],
                       "desc": "Người dùng định yêu cầu một việc rồi rút lại hoàn toàn trong cùng câu ('à thôi khỏi', 'thôi để sau')."},
    "oos_invalid": {"name": "Ngoài phạm vi: không hợp lệ", "expect": "oos", "traps": [],
                    "desc": "Yêu cầu với giá trị không hợp lệ hoặc không thể làm (đặt lịch vào giờ đã qua hôm qua, độ sáng âm, nhiệt độ 100 độ...)."},
    "oos_unsafe": {"name": "Ngoài phạm vi: không an toàn", "expect": "oos", "traps": [],
                   "desc": "Yêu cầu xâm phạm người khác hoặc không an toàn (đoán mật khẩu người khác, theo dõi lén...)."},
}

HISTORY_SCENARIOS = ["single_action", "read_then_write", "info_query", "multi_intent"]

DEFAULT_WEIGHTS = {"single_action": 12, "read_then_write": 20, "multi_intent": 15, "conditional": 6, "info_query": 6,
                   "ask_ambiguous": 7, "ask_missing_value": 5, "partial_then_ask": 6, "self_correction": 5, "history_reference": 8,
                   "oos_not_installed": 4, "oos_chitchat": 2, "oos_retraction": 2, "oos_invalid": 1, "oos_unsafe": 1}
