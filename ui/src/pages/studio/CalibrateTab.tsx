import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Play } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, ExperimentConfig } from "../../api";
import { useToast } from "../../components/Toast";
import { Button, Card, Field, NumberInput, Progress, Select, StatusBadge } from "../../components/ui";
import { fmtCost, fmtScore } from "../../lib/format";
import { useDatasets, useMeta, useModels } from "../../lib/hooks";
import { CalibrationStatus } from "./Calibration";

function RunWatch({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.run(id),
    refetchInterval: (qq) => (qq.state.data && !qq.state.data.active && !["running", "queued"].includes(qq.state.data.status) ? false : 2000),
  });
  const r = q.data;
  if (!r) return null;
  const s = r.score;
  return (
    <div className="space-y-2 rounded-md border border-slate-200 p-3 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link to={`/runs/${id}`} className="link">
          {r.name}
        </Link>
        <StatusBadge status={r.status} />
        <span className="text-xs text-slate-500">{fmtCost(r.cost)}</span>
      </div>
      <Progress value={r.done} max={r.total} />
      <div className="text-sm">
        {r.done}/{r.total} mẫu ·{" "}
        {s != null ? (
          <span>
            Điểm teacher: <b className={s >= 90 ? "text-emerald-600" : s >= 85 ? "text-amber-600" : "text-red-600"}>{fmtScore(s)}</b>
            {s >= 90 ? " — đủ tốt để sinh hàng loạt" : " — nên cải thiện (đổi model, bộ luật, tham số) trước khi sinh hàng loạt"}
          </span>
        ) : (
          "điểm sẽ có khi run kết thúc"
        )}
      </div>
    </div>
  );
}

export default function CalibrateTab() {
  const meta = useMeta();
  const models = useModels();
  const datasets = useDatasets();
  const toast = useToast();
  const qc = useQueryClient();
  const [model, setModel] = useState("");
  const [rules, setRules] = useState("rules_v2");
  const [ds, setDs] = useState("train");
  const [limit, setLimit] = useState<number | null>(100);
  const [workers, setWorkers] = useState<number | null>(4);
  const [runId, setRunId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trainSets = (datasets.data ?? []).filter((d) => d.id === "train" || d.parent_id === "train");
  const start = async () => {
    if (!meta.data) return;
    const cfg: ExperimentConfig = {
      ...meta.data.experiment_default,
      name: `Hiệu chỉnh teacher ${model}`,
      mode: "full",
      dataset: ds,
      asr_model: "gold-asr",
      llm_model: model,
      prompt: { plugin: "rules", rules },
      limit: limit ?? 0,
      workers: workers ?? 4,
    };
    setBusy(true);
    try {
      const r = await api.startRun({ config: cfg, name: cfg.name });
      setRunId(r.id);
      qc.invalidateQueries({ queryKey: ["runs"] });
      qc.invalidateQueries({ queryKey: ["calibration", model] });
      toast.success("Đã bắt đầu run hiệu chỉnh");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Hiệu chỉnh teacher" subtitle="Chạy teacher như một agent trên train (transcript gốc) để đo độ chính xác gán nhãn">
        <div className="space-y-3">
          <div className="rounded-md bg-slate-50 p-3 text-sm text-slate-700 dark:bg-white/[0.03] dark:text-slate-300">
            Teacher gán nhãn cho dữ liệu tổng hợp bằng cách tự gọi tool trên mô phỏng. Nếu teacher sai nhiều trên train (nơi có đáp án), nhãn tổng hợp
            cũng sẽ sai. Hãy chạy thử trên train và chỉ sinh hàng loạt khi điểm đạt khoảng <b>90+</b> (backend cảnh báo khi dưới 85 hoặc ít hơn 50 mẫu).
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Model LLM">
              <Select value={model} onChange={setModel} placeholder="Chọn model…" options={(models.data ?? []).filter((m) => m.role === "llm" && m.id !== "oracle").map((m) => ({ value: m.id, label: `${m.id}${m.ready ? " (chưa sẵn sàng)" : ""}` }))} />
            </Field>
            <Field label="Bộ luật">
              <Select value={rules} onChange={setRules} options={meta.data?.rules ?? ["rules_v2"]} />
            </Field>
            <Field label="Tập dữ liệu (train hoặc tập con)">
              <Select value={ds} onChange={setDs} options={trainSets.map((d) => ({ value: d.id, label: `${d.name} (${d.n})` }))} />
            </Field>
            <Field label="Số mẫu (0 = tất cả)">
              <NumberInput value={limit} onChange={setLimit} step={1} min={0} />
            </Field>
            <Field label="Số worker">
              <NumberInput value={workers} onChange={setWorkers} step={1} min={1} max={64} />
            </Field>
          </div>
          <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={start} loading={busy} disabled={!model}>
            Chạy hiệu chỉnh
          </Button>
          {runId && <RunWatch id={runId} />}
        </div>
      </Card>
      <Card title="Trạng thái hiệu chỉnh của model">
        {model ? <CalibrationStatus model={model} showRuns /> : <div className="text-sm text-slate-500">Chọn một model để xem các lần chạy gần nhất trên train.</div>}
      </Card>
    </div>
  );
}
