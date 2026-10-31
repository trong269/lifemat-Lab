import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitCompare, Play } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ExperimentConfig } from "../api";
import { AudioPlayer, audioLabel } from "../components/Audio";
import { MultiSelect } from "../components/MultiSelect";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Loading, NumberInput, PageHeader, Select } from "../components/ui";
import { fmtScore } from "../lib/format";
import { useDatasets, useMeta, useModels, usePlugins, useRuns } from "../lib/hooks";
import { DiffText } from "./Trace";
import { RunsTable } from "./Runs";

export default function AsrLab() {
  const runs = useRuns(5000);
  const models = useModels();
  const datasets = useDatasets();
  const plugins = usePlugins();
  const meta = useMeta();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const asrRuns = useMemo(() => (runs.data ?? []).filter((r) => r.wer !== null).sort((a, b) => (a.wer ?? 0) - (b.wer ?? 0)), [runs.data]);
  const asrModels = (models.data ?? []).filter((m) => m.role === "asr");

  // form chạy nhanh
  const [form, setForm] = useState({ dataset: "train", asr_model: "", postprocess: [] as string[], limit: 100 as number | null, workers: 4 as number | null });
  const [busy, setBusy] = useState(false);
  const start = async () => {
    if (!meta.data) return;
    const cfg: ExperimentConfig = {
      ...meta.data.experiment_default,
      name: `ASR ${form.asr_model} · ${form.dataset}`,
      mode: "asr_only",
      dataset: form.dataset,
      asr_model: form.asr_model,
      postprocess: form.postprocess,
      limit: form.limit ?? 0,
      workers: form.workers ?? 4,
    };
    setBusy(true);
    try {
      const r = await api.startRun({ config: cfg, name: cfg.name });
      qc.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Đã bắt đầu run ASR");
      nav(`/runs/${r.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  // điểm mất do ASR
  const fullRuns = (runs.data ?? []).filter((r) => r.score !== null && r.kind !== "asr");
  const goldRuns = fullRuns.filter((r) => r.asr_model === "gold-asr");
  const [goldRun, setGoldRun] = useState("");
  const [realRun, setRealRun] = useState("");
  const gr = fullRuns.find((r) => r.id === goldRun);
  const realCands = fullRuns.filter((r) => r.asr_model !== "gold-asr" && (!gr || (r.llm_model === gr.llm_model && r.dataset_id === gr.dataset_id)));

  // bảng lỗi từng câu
  const [sel, setSel] = useState("");
  const [onlyErr, setOnlyErr] = useState(true);
  const selRun = (runs.data ?? []).find((r) => r.id === sel);
  const utt = useQuery({ queryKey: ["run-asr", sel, onlyErr], queryFn: () => api.runAsr(sel, 500, onlyErr), enabled: !!sel });

  return (
    <div className="space-y-4">
      <PageHeader title="ASR Lab" subtitle="Đo WER/CER, recall thực thể và điểm mất do nhận dạng giọng nói" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Chạy nhanh: chỉ ASR" subtitle="Chế độ asr_only — không gọi LLM, chỉ đo lỗi nhận dạng">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Dataset" hint="Cần transcript gốc (train hoặc dữ liệu tổng hợp) để tính WER">
              <Select value={form.dataset} onChange={(v) => setForm({ ...form, dataset: v })} options={(datasets.data ?? []).map((d) => ({ value: d.id, label: `${d.id} (${d.n})` }))} />
            </Field>
            <Field label="Model ASR">
              <Select
                value={form.asr_model}
                onChange={(v) => setForm({ ...form, asr_model: v })}
                placeholder="Chọn model…"
                options={asrModels.filter((m) => m.id !== "gold-asr").map((m) => ({ value: m.id, label: `${m.id}${m.ready ? " (chưa sẵn sàng)" : ""}` }))}
              />
            </Field>
            <Field label="Hậu xử lý" className="sm:col-span-2">
              <MultiSelect ordered value={form.postprocess} onChange={(v) => setForm({ ...form, postprocess: v })} options={(plugins.data?.postprocess ?? []).map((p) => ({ value: p.name, hint: p.description }))} placeholder="Không dùng" />
            </Field>
            <Field label="Số mẫu (0 = tất cả)">
              <NumberInput value={form.limit} onChange={(v) => setForm({ ...form, limit: v })} step={1} min={0} />
            </Field>
            <Field label="Số worker">
              <NumberInput value={form.workers} onChange={(v) => setForm({ ...form, workers: v })} step={1} min={1} max={64} />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={start} loading={busy} disabled={!form.asr_model}>
              Chạy
            </Button>
          </div>
        </Card>
        <Card title="Điểm mất do ASR" subtitle="So run dùng gold-asr với run dùng ASR thật (cùng LLM, cùng dataset)">
          <div className="grid gap-3">
            <Field label="Run dùng gold-asr (mốc)">
              <Select value={goldRun} onChange={setGoldRun} placeholder="Chọn…" options={goldRuns.map((r) => ({ value: r.id, label: `${r.name} · ${r.llm_model} · ${r.dataset_id} · ${fmtScore(r.score)}` }))} />
            </Field>
            <Field label="Run dùng ASR thật">
              <Select value={realRun} onChange={setRealRun} placeholder="Chọn…" options={realCands.map((r) => ({ value: r.id, label: `${r.name} · ${r.asr_model} · ${fmtScore(r.score)}` }))} />
            </Field>
            {gr && realRun && (
              <div className="text-sm">
                Chênh lệch điểm:{" "}
                <span className="font-mono font-semibold text-red-600">
                  {((fullRuns.find((r) => r.id === realRun)?.score ?? 0) - (gr.score ?? 0)).toFixed(2)}
                </span>
              </div>
            )}
            <div className="flex justify-end">
              <Button icon={<GitCompare className="h-4 w-4" />} disabled={!goldRun || !realRun} onClick={() => nav(`/compare?ids=${goldRun},${realRun}`)}>
                Mở so sánh
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Run có số liệu ASR" subtitle="Sắp theo WER tăng dần" bodyClass="p-0 overflow-x-auto">
        {runs.isLoading ? (
          <Loading />
        ) : !asrRuns.length ? (
          <div className="p-3">
            <Empty>Chưa có run nào dùng ASR thật.</Empty>
          </div>
        ) : (
          <RunsTable rows={asrRuns} onOpen={(id) => setSel(id)} />
        )}
      </Card>

      <Card
        title={sel ? `Lỗi từng câu — ${selRun?.name ?? sel}` : "Lỗi từng câu"}
        subtitle="Chọn một run trong bảng trên. Đỏ gạch = từ bị mất/sai trong ref, xanh = từ ASR thêm/đổi."
        actions={<Checkbox checked={onlyErr} onChange={setOnlyErr} label={<span className="text-xs">chỉ câu sai</span>} />}
        bodyClass="p-0"
      >
        {!sel ? (
          <div className="p-3">
            <Empty>Chưa chọn run.</Empty>
          </div>
        ) : utt.isLoading ? (
          <Loading />
        ) : utt.error ? (
          <ErrorBox error={utt.error} />
        ) : !utt.data?.length ? (
          <div className="p-3">
            <Empty>Không có câu nào.</Empty>
          </div>
        ) : (
          <div className="max-h-[700px] overflow-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Mẫu</th>
                  <th>So khớp (ref → hyp)</th>
                  <th className="text-right">WER</th>
                  <th className="text-right">Thực thể</th>
                  <th>Audio</th>
                </tr>
              </thead>
              <tbody>
                {utt.data.map((u) => (
                  <tr key={`${u.sample_id}-${u.audio}`}>
                    <td className="whitespace-nowrap">
                      <Link className="link font-mono text-xs" to={`/runs/${sel}/s/${u.sample_id}`}>
                        {u.sample_id}
                      </Link>
                      <div className="text-[11px] text-slate-500">
                        {audioLabel(u.audio)} {u.final && <Badge color="blue">câu cuối</Badge>}
                      </div>
                      {u.error && <Badge color="red">{u.error}</Badge>}
                    </td>
                    <td className="min-w-[320px] text-sm">
                      {u.ref != null ? <DiffText ref_={u.ref} hyp={u.hyp ?? ""} refNorm={u.ref_norm} hypNorm={u.hyp_norm} /> : u.hyp}
                      {u.raw && u.raw !== u.hyp && <div className="text-[11px] text-slate-500">thô: {u.raw}</div>}
                    </td>
                    <td className="text-right font-mono text-xs">{u.wer.toFixed(1)}%</td>
                    <td className="text-right font-mono text-xs">{u.entity_recall != null ? `${u.entity_recall}%` : "—"}</td>
                    <td className="min-w-[280px]">{selRun && <AudioPlayer ds={selRun.dataset_id} path={u.audio} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
