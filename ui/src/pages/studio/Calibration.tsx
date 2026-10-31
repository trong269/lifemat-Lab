import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api, Calibration } from "../../api";
import { Spinner } from "../../components/ui";
import { fmtScore } from "../../lib/format";

export function CalibrationNote({ cal, showRuns }: { cal: Calibration; showRuns?: boolean }) {
  return (
    <div
      className={
        cal.ok
          ? "rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"
          : "rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
      }
    >
      <div className="flex items-start gap-1.5">
        {cal.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" /> : <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />}
        <span>
          {cal.ok ? "Teacher đã hiệu chỉnh: " : "Cảnh báo teacher: "}
          {cal.message}
          {!cal.ok && (
            <>
              {" "}
              —{" "}
              <Link to="/studio/calibrate" className="underline">
                hiệu chỉnh
              </Link>
            </>
          )}
        </span>
      </div>
      {showRuns && cal.runs.length > 0 && (
        <ul className="mt-1.5 space-y-0.5 pl-5">
          {cal.runs.map((r) => (
            <li key={r.id}>
              <Link className="underline" to={`/runs/${r.id}`}>
                {r.name}
              </Link>{" "}
              · {r.dataset_id} · {r.done} mẫu · điểm <b>{fmtScore(r.score)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CalibrationStatus({ model, showRuns }: { model: string | null | undefined; showRuns?: boolean }) {
  const q = useQuery({ queryKey: ["calibration", model], queryFn: () => api.calibration(model as string), enabled: !!model });
  if (!model) return null;
  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return null;
  return <CalibrationNote cal={q.data} showRuns={showRuns} />;
}
