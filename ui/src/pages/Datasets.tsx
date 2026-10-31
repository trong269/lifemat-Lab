import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { fmtTime, statusVi } from "../lib/format";
import { useDatasets } from "../lib/hooks";

const KIND: Record<string, { label: string; color: "blue" | "purple" | "gray" }> = {
  official: { label: "chính thức", color: "blue" },
  synthetic: { label: "tổng hợp", color: "purple" },
  subset: { label: "tập con", color: "gray" },
};

export default function Datasets() {
  const q = useDatasets();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [busy, setBusy] = useState(false);
  const rescan = async () => {
    setBusy(true);
    try {
      await api.rescan();
      await qc.invalidateQueries({ queryKey: ["datasets"] });
      toast.success("Đã quét lại dataset");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const del = async (id: string) => {
    if (!confirm(`Xoá dataset ${id}? (dataset tổng hợp sẽ bị xoá cả file trên đĩa)`)) return;
    try {
      await api.deleteDataset(id);
      toast.success("Đã xoá");
      qc.invalidateQueries({ queryKey: ["datasets"] });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Datasets"
        subtitle="Tập chính thức (train, public_test), dữ liệu tổng hợp và tập con"
        actions={
          <Button icon={<RefreshCw className="h-4 w-4" />} onClick={rescan} loading={busy}>
            Quét lại
          </Button>
        }
      />
      <Card bodyClass="p-0 overflow-x-auto">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !q.data?.length ? (
          <div className="p-3">
            <Empty>Chưa có dataset.</Empty>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>ID</th>
                <th>Tên</th>
                <th>Loại</th>
                <th className="text-right">Số mẫu</th>
                <th>Nguồn / duyệt</th>
                <th>Ghi chú</th>
                <th>Tạo lúc</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.map((d) => (
                <tr key={d.id} className="clickable" onClick={() => nav(`/datasets/${d.id}`)}>
                  <td className="font-mono text-xs">{d.id}</td>
                  <td>{d.name}</td>
                  <td>
                    <Badge color={KIND[d.kind]?.color ?? "gray"}>{KIND[d.kind]?.label ?? d.kind}</Badge>
                  </td>
                  <td className="text-right font-mono">{d.n}</td>
                  <td className="text-xs">
                    {d.kind === "subset" && d.parent_id && <span>từ {d.parent_id}</span>}
                    {d.review && (
                      <div className="flex flex-wrap gap-1" onClick={(e) => e.stopPropagation()}>
                        {Object.entries(d.review.status).map(([k, v]) => (
                          <Badge key={k} color={k === "approved" ? "green" : k === "rejected" ? "red" : "gray"}>
                            {statusVi(k)}: {v}
                          </Badge>
                        ))}
                        {d.review.with_error > 0 && <Badge color="red">lỗi: {d.review.with_error}</Badge>}
                        <Link to={`/studio/review/${d.id}`} className="link">
                          Duyệt →
                        </Link>
                      </div>
                    )}
                    {d.error && <div className="text-red-600">{d.error}</div>}
                  </td>
                  <td className="max-w-[260px] truncate text-xs text-slate-500" title={d.notes}>
                    {d.notes}
                  </td>
                  <td className="whitespace-nowrap text-xs text-slate-500">{fmtTime(d.created)}</td>
                  <td className="text-right" onClick={(e) => e.stopPropagation()}>
                    {d.kind !== "official" && <Button size="xs" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => del(d.id)} title="Xoá" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
