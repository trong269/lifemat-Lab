/* Đánh giá: chọn dữ liệu + model + số mẫu -> Chạy; danh sách các lần chạy. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { GitCompare, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api, type ExperimentConfig } from "../../api";
import { useToast } from "../../components/Toast";
import { Button, Card, Checkbox, Collapsible, Empty, Field, Loading, Notice, NumberInput, PageHeader, Progress, Select, StatusBadge } from "../../components/ui";
import { fmtAgo, fmtCost, fmtScore } from "../../lib/format";
import { datasetLabel, modelLabel } from "../../lib/friendly";
import { useDatasets, useMeta, useModels, useRules, useRuns } from "../../lib/hooks";

const SIZES: { v: number; label: string }[] = [
  { v: 20, label: "20 mẫu (thử nhanh)" },
  { v: 100, label: "100 mẫu" },
  { v: 300, label: "300 mẫu" },
  { v: 0, label: "Tất cả" },
];

function NewRun() {
  const meta = useMeta();
  const models = useModels();
  const datasets = useDatasets();
  const rules = useRules();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [sp] = useSearchParams();
  const [dataset, setDataset] = useState(sp.get("dataset") ?? "train");
  const [llm, setLlm] = useState(sp.get("llm_model") ?? "");
  const [asr, setAsr] = useState(sp.get("asr_model") ?? "gold-asr");
  const [size, setSize] = useState(20);
  const [timeout, setTimeoutS] = useState<number | null>(30);
  const [workers, setWorkers] = useState<number | null>(4);
  const [budget, setBudget] = useState<number | null>(null);
  const [rule, setRule] = useState("rules_v2");
  const [busy, setBusy] = useState(false);

  const llms = (models.data ?? []).filter((m) => m.role === "llm");
  const asrs = (models.data ?? []).filter((m) => m.role === "asr");
  const dss = datasets.data ?? [];
  useEffect(() => {
    if (!llm && llms.length) setLlm((llms.find((m) => m.id !== "oracle" && !m.ready) ?? llms[0]).id);
  }, [llms, llm]);

  const noTranscript = asr === "gold-asr" && dataset === "public_test";
  const cfg: ExperimentConfig | null = useMemo(() => {
    if (!meta.data || !llm) return null;
    const ds = dss.find((d) => d.id === dataset);
    const llmName = llms.find((m) => m.id === llm)?.name ?? llm;
    return {
      ...meta.data.experiment_default,
      name: `${llmName} · ${ds?.name ?? dataset} · ${size || "tất cả"} mẫu`,
      dataset,
      llm_model: llm,
      asr_model: asr,
      limit: size,
      timeout_s: timeout ?? 30,
      workers: workers ?? 4,
      budget_usd: budget,
      prompt: { plugin: "rules", rules: rule },
    } as ExperimentConfig;
  }, [meta.data, llm, asr, dataset, size, timeout, workers, budget, rule, dss, llms]);

  const est = useQuery({
    queryKey: ["estimate", cfg],
    queryFn: () => api.estimate(cfg as ExperimentConfig),
    enabled: !!cfg && !noTranscript,
    retry: false,
  });

  const run = async () => {
    if (!cfg) return;
    setBusy(true);
    try {
      const r = await api.startRun({ config: cfg, name: cfg.name });
      qc.invalidateQueries({ queryKey: ["runs"] });
      nav(`/evaluate/${r.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (models.isLoading || datasets.isLoading || meta.isLoading) return <Loading />;
  const readyLlm = llms.filter((m) => m.id !== "oracle");
  const chosen = llms.find((m) => m.id === llm);
  return (
    <Card title="Chạy đánh giá mới">
      {readyLlm.length === 0 && (
        <Notice color="yellow" className="mb-3">
          Bạn chưa kết nối model nào. <Link to="/connect" className="font-medium underline">Kết nối model</Link> trước, hoặc chọn
          "Đáp án mẫu" để thử hệ thống.
        </Notice>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Dữ liệu">
          <Select value={dataset} onChange={setDataset} options={dss.map((d) => ({ value: d.id, label: datasetLabel(d) }))} />
        </Field>
        <Field label="Model ngôn ngữ (LLM)">
          <Select value={llm} onChange={setLlm} options={llms.map((m) => ({ value: m.id, label: modelLabel(m) + (m.ready ? " — chưa sẵn sàng" : "") }))} />
        </Field>
        <Field label="Nhận dạng giọng nói" hint="Chọn model ASR để đánh giá cả bước nghe. Tập train có sẵn chữ nên có thể bỏ qua ASR.">
          <Select value={asr} onChange={setAsr} options={asrs.map((m) => ({ value: m.id, label: modelLabel(m) + (m.ready ? " — chưa sẵn sàng" : "") }))} />
        </Field>
        <Field label="Số mẫu">
          <div className="flex flex-wrap gap-1.5">
            {SIZES.map((s) => (
              <button
                key={s.v}
                onClick={() => setSize(s.v)}
                className={clsx(
                  "rounded-md border px-2.5 py-1.5 text-sm",
                  size === s.v ? "border-accent-500 bg-accent-50 font-medium dark:bg-accent-950/30" : "border-slate-200 dark:border-slate-700",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </Field>
      </div>
      {chosen?.ready && <Notice color="red" className="mt-3">{chosen.ready}</Notice>}
      {noTranscript && (
        <Notice color="yellow" className="mt-3">
          Tập public test không có sẵn chữ của câu nói — hãy chọn một model nhận dạng giọng nói (ASR).
        </Notice>
      )}
      <Collapsible title="Tuỳ chỉnh thêm (không bắt buộc)" className="mt-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Giới hạn thời gian / mẫu (giây)" hint="Luật thi: 30 giây">
            <NumberInput value={timeout} onChange={setTimeoutS} min={1} />
          </Field>
          <Field label="Chạy song song" hint="Số mẫu xử lý cùng lúc">
            <NumberInput value={workers} onChange={setWorkers} min={1} max={64} />
          </Field>
          <Field label="Chi phí tối đa (USD)" hint="Vượt thì tự dừng; trống = không giới hạn">
            <NumberInput value={budget} onChange={setBudget} step={0.5} />
          </Field>
          <Field label="Bộ luật (system prompt)">
            <Select value={rule} onChange={setRule} options={rules} />
          </Field>
        </div>
      </Collapsible>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="muted text-sm">
          {est.data && typeof est.data.usd === "number" && (
            <>
              Ước tính chi phí: <b className="text-slate-800 dark:text-slate-100">{fmtCost(est.data.usd as number)}</b> cho {String(est.data.n)} mẫu
              {(est.data.usd as number) === 0 && " (model chưa khai báo giá hoặc miễn phí)"}
            </>
          )}
        </div>
        <Button variant="primary" size="md" icon={<Play className="h-4 w-4" />} loading={busy} disabled={!cfg || noTranscript} onClick={run}>
          Chạy đánh giá
        </Button>
      </div>
    </Card>
  );
}

export default function Evaluate() {
  const runs = useRuns(3000);
  const datasets = useDatasets();
  const nav = useNavigate();
  const [sel, setSel] = useState<string[]>([]);
  const dsName = (id: string) => datasets.data?.find((d) => d.id === id)?.name ?? id;
  const rows = runs.data ?? [];
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <PageHeader title="Đánh giá" subtitle="Chạy model trên dữ liệu có đáp án để xem điểm theo đúng công thức của BTC, hoặc chạy trên public test để tạo file nộp bài." />
      <NewRun />
      <Card
        title="Các lần chạy"
        actions={
          <Button size="sm" icon={<GitCompare className="h-4 w-4" />} disabled={sel.length !== 2} onClick={() => nav(`/evaluate/compare?ids=${sel.join(",")}`)}>
            So sánh 2 lần chạy đã chọn
          </Button>
        }
        bodyClass="p-0"
      >
        {runs.isLoading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty className="m-3">Chưa có lần chạy nào.</Empty>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => {
              const running = r.active || r.status === "running";
              return (
                <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5">
                  <Checkbox
                    checked={sel.includes(r.id)}
                    onChange={(v) => setSel((s) => (v ? [...s.filter((x) => x !== r.id), r.id].slice(-2) : s.filter((x) => x !== r.id)))}
                  />
                  <Link to={`/evaluate/${r.id}`} className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{r.name}</div>
                    <div className="muted text-xs">
                      {dsName(r.dataset_id)} · {fmtAgo(r.created)} {r.cost ? `· ${fmtCost(r.cost)}` : ""}
                    </div>
                    {running && <Progress value={r.done} max={Math.max(r.total, 1)} className="mt-1 max-w-xs" />}
                  </Link>
                  <div className="w-28 text-right">
                    {r.score != null ? (
                      <div className="text-lg font-semibold tabular-nums">{fmtScore(r.score)}</div>
                    ) : (
                      <StatusBadge status={running ? "running" : r.status} />
                    )}
                    {r.score != null && <div className="muted text-[11px]">điểm / 100</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
