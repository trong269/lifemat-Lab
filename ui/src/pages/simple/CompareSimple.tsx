/* So sánh 2 lần chạy: điểm, mẫu tốt hơn / kém hơn, khác biệt cấu hình. */
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../../api";
import { Card, Empty, ErrorBox, Loading, PageHeader, Stat } from "../../components/ui";
import { fmtScore } from "../../lib/format";

const LABELS: Record<string, string> = {
  llm_model: "Model LLM",
  asr_model: "Model ASR",
  dataset: "Dữ liệu",
  limit: "Số mẫu",
  timeout_s: "Giới hạn thời gian",
  prompt: "Bộ luật",
  renderer: "Cách mô tả tool",
  guards: "Bộ kiểm tra",
  postprocess: "Hậu xử lý ASR",
};

export default function CompareSimple() {
  const [sp] = useSearchParams();
  const ids = (sp.get("ids") ?? "").split(",").filter(Boolean);
  const q = useQuery({ queryKey: ["compare", ids], queryFn: () => api.compare(ids), enabled: ids.length === 2 });
  if (ids.length !== 2) return <ErrorBox error="Cần chọn đúng 2 lần chạy" />;
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const [a, b] = q.data.runs;
  const better = q.data.rows.filter((r) => r.delta > 0);
  const worse = q.data.rows.filter((r) => r.delta < 0);
  const diffKeys = Object.keys(LABELS).filter((k) => JSON.stringify((a.config as never)[k]) !== JSON.stringify((b.config as never)[k]));
  const show = (v: unknown) => (typeof v === "object" ? JSON.stringify(v) : String(v ?? "—"));
  const List = ({ rows, runId }: { rows: typeof better; runId: string }) =>
    rows.length === 0 ? (
      <Empty>Không có</Empty>
    ) : (
      <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto text-sm dark:divide-slate-800">
        {rows.map((r) => (
          <Link key={r.sample_id} to={`/evaluate/${runId}/${r.sample_id}`} className="flex justify-between px-1 py-1.5 hover:bg-slate-50 dark:hover:bg-white/5">
            <span className="font-mono text-xs">{r.sample_id}</span>
            <span className="tabular-nums">
              {Math.round(r.scores[0] * 100)} → <b>{Math.round(r.scores[1] * 100)}</b>
            </span>
          </Link>
        ))}
      </div>
    );
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link to="/evaluate" className="muted inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="h-4 w-4" /> Đánh giá
      </Link>
      <PageHeader title="So sánh 2 lần chạy" subtitle={`${q.data.common} mẫu chung`} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat label={`A · ${a.name}`} value={fmtScore(a.score)} />
        <Stat
          label={`B · ${b.name}`}
          value={fmtScore(b.score)}
          tone={a.score != null && b.score != null ? (b.score > a.score ? "good" : b.score < a.score ? "bad" : undefined) : undefined}
        />
      </div>
      {diffKeys.length > 0 && (
        <Card title="Khác nhau ở cấu hình">
          <table className="w-full text-sm">
            <tbody>
              {diffKeys.map((k) => (
                <tr key={k} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="py-1.5 font-medium">{LABELS[k]}</td>
                  <td className="py-1.5 font-mono text-xs">A: {show((a.config as never)[k])}</td>
                  <td className="py-1.5 font-mono text-xs">B: {show((b.config as never)[k])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Card title={`B tốt hơn A ở ${better.length} mẫu`}>
          <List rows={[...better].reverse()} runId={b.id} />
        </Card>
        <Card title={`B kém hơn A ở ${worse.length} mẫu`}>
          <List rows={worse} runId={b.id} />
        </Card>
      </div>
    </div>
  );
}
