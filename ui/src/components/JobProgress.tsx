/* Theo dõi một job: poll /api/jobs/{id} mỗi 2 giây khi đang chạy. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Square } from "lucide-react";
import { api } from "../api";
import { fmtCost } from "../lib/format";
import { useToast } from "./Toast";
import { Button, Collapsible, ErrorBox, ProgressLabel, StatusBadge } from "./ui";
import { JsonView } from "./JsonView";

export const ACTIVE_JOB = new Set(["running", "cancelling", "queued"]);

export function useJob(id: string | null | undefined) {
  return useQuery({
    queryKey: ["job", id],
    queryFn: () => api.job(id as string),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && !ACTIVE_JOB.has(q.state.data.status) ? false : 2000),
  });
}

export function JobProgress({ id, compact, showResult = true }: { id: string; compact?: boolean; showResult?: boolean }) {
  const q = useJob(id);
  const toast = useToast();
  const qc = useQueryClient();
  const j = q.data;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!j) return <div className="text-xs text-slate-500">Đang tải job {id}…</div>;
  const cancel = async () => {
    try {
      await api.cancelJob(j.id);
      toast.info("Đã gửi yêu cầu huỷ");
      qc.invalidateQueries({ queryKey: ["job", id] });
    } catch (e) {
      toast.error(e);
    }
  };
  const log = j.log ?? [];
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-2.5 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-xs">{j.id}</span>
        <span className="text-xs text-slate-500">{j.kind}</span>
        <StatusBadge status={j.status} />
        <span className="text-xs text-slate-500">
          chi phí {fmtCost(j.cost)}
          {j.budget ? ` / ${fmtCost(j.budget)}` : ""}
        </span>
        {ACTIVE_JOB.has(j.status) && (
          <Button size="xs" variant="danger" icon={<Square className="h-3 w-3" />} onClick={cancel} disabled={j.status === "cancelling"}>
            Huỷ
          </Button>
        )}
      </div>
      <ProgressLabel done={j.progress} total={j.total} />
      {j.error && (
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded bg-red-50 p-2 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">{j.error}</pre>
      )}
      {!compact && log.length > 0 && (
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] text-slate-600 dark:bg-black/20 dark:text-slate-300">
          {log.slice(-80).join("\n")}
        </pre>
      )}
      {showResult && j.result != null && (
        <Collapsible title="Kết quả">
          <JsonView data={j.result} openDepth={2} />
        </Collapsible>
      )}
    </div>
  );
}
