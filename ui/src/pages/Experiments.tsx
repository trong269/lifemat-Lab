import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Play, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api, Experiment } from "../api";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader } from "../components/ui";
import { fmtTime } from "../lib/format";

export default function Experiments() {
  const q = useQuery({ queryKey: ["experiments"], queryFn: api.experiments });
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const del = async (e: Experiment) => {
    if (!confirm(`Xoá thử nghiệm "${e.name}"?`)) return;
    try {
      await api.deleteExperiment(e.id);
      qc.invalidateQueries({ queryKey: ["experiments"] });
      toast.success("Đã xoá");
    } catch (err) {
      toast.error(err);
    }
  };
  const run = async (e: Experiment) => {
    try {
      const r = await api.startRun({ config: e.config, experiment_id: e.id, name: e.name });
      qc.invalidateQueries({ queryKey: ["runs"] });
      nav(`/runs/${r.id}`);
    } catch (err) {
      toast.error(err);
    }
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title="Thử nghiệm"
        subtitle="Cấu hình pipeline đã lưu (ASR → hậu xử lý → LLM agent → guard → chấm điểm)"
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => nav("/experiments/new")}>
            Thử nghiệm mới
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
            <Empty>Chưa lưu thử nghiệm nào. Bấm “Thử nghiệm mới” để bắt đầu.</Empty>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Tên</th>
                <th>Dataset</th>
                <th>Chế độ</th>
                <th>LLM</th>
                <th>ASR</th>
                <th>Bộ luật</th>
                <th>Cập nhật</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {q.data.map((e) => (
                <tr key={e.id} className="clickable" onClick={() => nav(`/experiments/${e.id}`)}>
                  <td>
                    <div>{e.name}</div>
                    <div className="font-mono text-[11px] text-slate-500">{e.id}</div>
                  </td>
                  <td className="text-xs">
                    {e.config.dataset}
                    {e.config.limit ? <span className="text-slate-500"> (giới hạn {e.config.limit})</span> : null}
                  </td>
                  <td>
                    <Badge color={e.config.mode === "asr_only" ? "purple" : "blue"}>{e.config.mode}</Badge>
                  </td>
                  <td className="font-mono text-xs">{e.config.llm_model}</td>
                  <td className="font-mono text-xs">{e.config.asr_model}</td>
                  <td className="text-xs">{typeof e.config.prompt === "string" ? e.config.prompt : e.config.prompt?.rules}</td>
                  <td className="whitespace-nowrap text-xs text-slate-500">{fmtTime(e.updated)}</td>
                  <td className="whitespace-nowrap text-right" onClick={(ev) => ev.stopPropagation()}>
                    <Button size="xs" variant="ghost" icon={<Play className="h-3.5 w-3.5" />} onClick={() => run(e)}>
                      Chạy
                    </Button>
                    <Button size="xs" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => nav("/experiments/new", { state: { config: e.config, name: `${e.name} (bản sao)` } })}>
                      Clone
                    </Button>
                    <Button size="xs" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => del(e)} title="Xoá" />
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
