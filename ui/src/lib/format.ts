/* Định dạng số, chi phí, thời gian. */
const nf = new Intl.NumberFormat("vi-VN");

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtInt(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return nf.format(Math.round(v));
}

/** Điểm run (thang 0–100), 2 chữ số. */
export function fmtScore(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return v.toFixed(2);
}

/** Điểm từng mẫu (thang 0–1) hiển thị theo thang 0–100. */
export function fmtSampleScore(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return (v * 100).toFixed(1);
}

export function fmtCost(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `$${v.toFixed(4)}`;
}

export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(digits)}%`;
}

export function fmtSec(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(2)}s`;
}

export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString("vi-VN", { hour12: false });
}

export function fmtAgo(ts: number | null | undefined): string {
  if (!ts) return "—";
  const d = Date.now() / 1000 - ts;
  if (d < 60) return "vừa xong";
  if (d < 3600) return `${Math.floor(d / 60)} phút trước`;
  if (d < 86400) return `${Math.floor(d / 3600)} giờ trước`;
  return `${Math.floor(d / 86400)} ngày trước`;
}

export function pct(done: number, total: number): number {
  return total > 0 ? Math.min(100, (100 * done) / total) : 0;
}

export function jsonStr(v: unknown, indent = 2): string {
  try {
    return JSON.stringify(v, null, indent) ?? "";
  } catch {
    return String(v);
  }
}

export const STATUS_VI: Record<string, string> = {
  running: "đang chạy",
  queued: "đang chờ",
  done: "xong",
  error: "lỗi",
  cancelled: "đã huỷ",
  cancelling: "đang huỷ",
  paused: "tạm dừng",
  interrupted: "bị gián đoạn",
  stopped_budget: "dừng do hết ngân sách",
  pending: "chờ duyệt",
  approved: "đã duyệt",
  rejected: "đã loại",
  needs_relabel: "cần gán lại",
  draft: "nháp",
  timeout: "quá giờ",
  llm_error: "lỗi LLM",
  crash: "lỗi chương trình",
};

export function statusVi(s: string | null | undefined): string {
  if (!s) return "—";
  return STATUS_VI[s] ?? s;
}
