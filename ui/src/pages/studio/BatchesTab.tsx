import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { JobProgress } from "../../components/JobProgress";
import { JsonView } from "../../components/JsonView";
import { Button, Card, Empty, ErrorBox, Loading, Modal, ProgressLabel, StatusBadge } from "../../components/ui";
import { fmtCost, fmtTime } from "../../lib/format";

export default function BatchesTab() {
  const q = useQuery({
    queryKey: ["batches"],
    queryFn: api.batches,
    refetchInterval: (qq) => ((qq.state.data ?? []).some((b) => b.status === "running") ? 2000 : 10000),
  });
  const [recipe, setRecipe] = useState<unknown>(null);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const rows = q.data ?? [];
  const running = rows.filter((b) => b.status === "running" && b.job_id);
  return (
    <div className="space-y-4">
      {running.length > 0 && (
        <Card title="Đang chạy">
          <div className="space-y-2">
            {running.map((b) => (
              <div key={b.id}>
                <div className="mb-1 text-sm">
                  {b.name} →{" "}
                  <Link className="link" to={`/studio/review/${b.dataset_id}`}>
                    duyệt {b.dataset_id}
                  </Link>
                </div>
                <JobProgress id={b.job_id!} />
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Mọi đợt sinh" bodyClass="p-0 overflow-x-auto">
        {!rows.length ? (
          <div className="p-3">
            <Empty>Chưa có đợt sinh nào. Tạo ở tab Công thức.</Empty>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Đợt</th>
                <th>Dataset</th>
                <th>Trạng thái</th>
                <th>Tiến độ</th>
                <th className="text-right">Chi phí</th>
                <th>Model</th>
                <th>Tạo lúc</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.id}>
                  <td>
                    <div>{b.name}</div>
                    <div className="font-mono text-[11px] text-slate-500">{b.id}</div>
                  </td>
                  <td>
                    <Link className="link font-mono text-xs" to={`/datasets/${b.dataset_id}`}>
                      {b.dataset_id}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={b.status} />
                  </td>
                  <td>
                    <ProgressLabel done={b.n_done} total={b.n_target} />
                  </td>
                  <td className="text-right font-mono text-xs">{fmtCost(b.cost)}</td>
                  <td className="text-xs">
                    {b.recipe?.writer_model} / {b.recipe?.labeler_model}
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-500">{fmtTime(b.created)}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button size="xs" variant="ghost" onClick={() => setRecipe(b.recipe)}>
                      Công thức
                    </Button>
                    {b.job_id && (
                      <Link to={`/jobs?id=${b.job_id}`}>
                        <Button size="xs" variant="ghost">
                          Job
                        </Button>
                      </Link>
                    )}
                    <Link to={`/studio/review/${b.dataset_id}`}>
                      <Button size="xs">Duyệt</Button>
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Modal open={recipe !== null} onClose={() => setRecipe(null)} title="Công thức của đợt sinh">
        <JsonView data={recipe} openDepth={2} />
      </Modal>
    </div>
  );
}
