/* Diễn giải kết quả bằng lời dễ hiểu cho giao diện đơn giản. */
import type { Dataset, Model } from "../api";

export const ERROR_FRIENDLY: Record<string, { title: string; hint: string }> = {
  hash_mismatch: { title: "Kết quả cuối cùng khác đáp án", hint: "Dữ liệu app sau khi làm không giống đáp án, nên mẫu bị 0 điểm." },
  wrong_id: { title: "Chọn sai đối tượng", hint: "Ví dụ gửi tin cho nhầm người, tắt nhầm đèn, trả nhầm hoá đơn." },
  wrong_time: { title: "Sai thời gian", hint: "Tính sai giờ hoặc ngày (\"mai\", \"tối nay\", \"trước 30 phút\"...)." },
  wrong_amount: { title: "Sai số tiền hoặc số lượng", hint: "Ví dụ hiểu sai \"ba trăm rưỡi\"." },
  wrong_args: { title: "Sai thông tin khác trong lệnh", hint: "Một giá trị trong lệnh gọi app khác đáp án." },
  extra_args: { title: "Điền thừa thông tin", hint: "Tự thêm tuỳ chọn người dùng không nói." },
  missing_args: { title: "Thiếu thông tin trong lệnh", hint: "Thiếu một giá trị mà đáp án có." },
  fuzzy_below_threshold: { title: "Nội dung chữ quá khác đáp án", hint: "Nội dung tin nhắn, tiêu đề... khác nhiều so với lời người dùng." },
  extra_read: { title: "Tra cứu thừa", hint: "Gọi thêm bước tra cứu không cần thiết (bị trừ điểm nhẹ)." },
  missing_read: { title: "Thiếu bước tra cứu", hint: "Đáp án có tra cứu trước nhưng model bỏ qua." },
  extra_write: { title: "Làm thừa hành động", hint: "Thực hiện việc người dùng không yêu cầu." },
  missing_write: { title: "Thiếu hành động", hint: "Bỏ sót một việc người dùng yêu cầu." },
  missing_ask: { title: "Lẽ ra phải hỏi lại", hint: "Thiếu thông tin hoặc trùng tên nhưng model không hỏi lại người dùng." },
  wrong_ask_params: { title: "Hỏi lại sai nội dung", hint: "Có hỏi lại nhưng hỏi sai thông tin còn thiếu." },
  unneeded_ask: { title: "Hỏi lại không cần thiết", hint: "Đủ thông tin nhưng model vẫn hỏi lại." },
  acted_on_oos: { title: "Làm việc lẽ ra không được làm", hint: "Yêu cầu ngoài phạm vi (app chưa cài, tán gẫu, rút lại...) nhưng model vẫn gọi app." },
  empty_but_should_act: { title: "Không làm gì", hint: "Model không gọi app nào dù yêu cầu làm được." },
  rejected_call: { title: "Gọi app sai cú pháp", hint: "Lệnh gọi bị hệ thống từ chối (sai tên hoặc thiếu tham số)." },
  timeout: { title: "Quá thời gian", hint: "Mẫu xử lý lâu hơn giới hạn (luật thi: 30 giây)." },
  llm_error: { title: "Lỗi khi gọi model", hint: "Server model báo lỗi hoặc không phản hồi." },
  crash: { title: "Lỗi chương trình", hint: "Có lỗi khi chạy mẫu này." },
  asr_error: { title: "Lỗi nhận dạng giọng nói", hint: "Server ASR báo lỗi." },
};

export function errorTitle(tag: string): string {
  return ERROR_FRIENDLY[tag]?.title ?? tag;
}

export const SCENARIO_FRIENDLY: Record<string, string> = {
  out_of_scope: "Ngoài phạm vi (không làm gì)",
  ask_missing: "Phải hỏi lại người dùng",
  read_then_write: "Tra cứu rồi thực hiện",
  write_only: "Thực hiện trực tiếp",
  read_only: "Chỉ hỏi thông tin",
  unlabeled: "Không có đáp án",
};

export const ROLE_FRIENDLY: Record<string, string> = {
  llm: "Model ngôn ngữ (LLM)",
  asr: "Nhận dạng giọng nói (ASR)",
  tts: "Đọc văn bản (TTS)",
};

export function datasetLabel(d: Dataset): string {
  if (d.id === "train") return `Tập train — ${d.n} mẫu, có đáp án`;
  if (d.id === "public_test") return `Tập public test — ${d.n} mẫu, không có đáp án (để tạo file nộp)`;
  if (d.kind === "synthetic") return `Dữ liệu tự tạo: ${d.name} — ${d.n} mẫu`;
  return `${d.name} — ${d.n} mẫu`;
}

export function modelLabel(m: Model): string {
  if (m.id === "oracle") return "Đáp án mẫu (chỉ để kiểm tra hệ thống)";
  if (m.id === "gold-asr") return "Dùng chữ có sẵn trong dữ liệu (không cần ASR)";
  return m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id;
}

/** Hiện một lệnh gọi app dạng dễ đọc: contacts.search(query: "Lan") */
export function callText(c: { name: string; arguments?: Record<string, unknown> } | null | undefined): string {
  if (!c) return "";
  const args = Object.entries(c.arguments ?? {})
    .map(([k, v]) => `${k}: ${typeof v === "string" ? `"${v}"` : JSON.stringify(v)}`)
    .join(", ");
  return `${c.name}(${args})`;
}
