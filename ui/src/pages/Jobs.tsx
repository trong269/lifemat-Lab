import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { JobProgress } from "../components/JobProgress";
import { JsonView } from "../components/JsonView";
import { Card, Empty, ErrorBox, Loading, PageHeader, ProgressLabel, Select, StatusBadge } from "../components/ui";
import { fmtCost, fmtTime } from "../lib/format";

const KIND_VI: Record<string, string> = { generate: "Sinh dữ liệu", relabel: "Gán nhãn lại", export: "Xuất dữ liệu", tts: "TTS", app_factory: "App Factory" };

export default function Jobs() {
  const [sp, setSp] = useSearchParams();
  const [kind, setKind] = useState("");
  const q = useQuery({ queryKey: ["jobs", kind], queryFn: () => api.jobs(kind || undefined), refetchInterval: 3000 });
  const sel = sp.get("id");
  const selJob = (q.data ?? []).find((j) => j.id === sel);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Jobs"
        subtitle="Tác vụ nền: sinh dữ liệu, gán nhãn lại, TTS, xuất dữ liệu, App Factory"
        actions={<Select className="!w-48" value={kind} onChange={setKind} placeholder="Mọi loại" options={Object.entries(KIND_VI).map(([value, label]) => ({ value, label }))} />}
      />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card bodyClass="p-0 overflow-x-auto">
          {q.isLoading ? (
            <Loading />
          ) : q.error ? (
            <ErrorBox error={q.error} />
          ) : !q.data?.length ? (
            <div className="p-3">
              <Empty>Chưa có job nào.</Empty>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Loại</th>
                  <th>Trạng thái</th>
                  <th>Tiến độ</th>
                  <th className="text-right">Chi phí / hạn mức</th>
                  <th>Tạo lúc</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((j) => (
                  <tr key={j.id} className={`clickable ${sel === j.id ? "selected" : ""}`} onClick={() => setSp({ id: j.id })}>
                    <td className="font-mono text-xs">{j.id}</td>
                    <td className="text-xs">{KIND_VI[j.kind] ?? j.kind}</td>
                    <td>
                      <StatusBadge status={j.status} />
                    </td>
                    <td>
                      <ProgressLabel done={j.progress} total={j.total} />
                    </td>
                    <td className="text-right font-mono text-xs">
                      {fmtCost(j.cost)}
                      {j.budget ? ` / ${fmtCost(j.budget)}` : ""}
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{fmtTime(j.created)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title={sel ? `Chi tiết ${sel}` : "Chi tiết job"}>
          {!sel ? (
            <Empty>Chọn một job để xem nhật ký.</Empty>
          ) : (
            <div className="space-y-3">
              <JobProgress id={sel} />
              {selJob?.payload && (
                <div>
                  <div className="label">Tham số</div>
                  <JsonView data={selJob.payload} openDepth={1} />
                  {selJob.payload.dataset_id && (
                    <div className="mt-2 flex gap-3 text-sm">
                      <Link className="link" to={`/datasets/${selJob.payload.dataset_id}`}>
                        Mở dataset
                      </Link>
                      <Link className="link" to={`/studio/review/${selJob.payload.dataset_id}`}>
                        Duyệt
                      </Link>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
