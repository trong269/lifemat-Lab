/* Tạo dữ liệu: 1. Tạo (model viết câu + model gán nhãn + số mẫu) → 2. Duyệt / sửa → 3. Xuất file train. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Download, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type Json, type QueueRow } from "../../api";
import { JsonEditor } from "../../components/CodeEditor";
import { JobProgress, useJob } from "../../components/JobProgress";
import { HistoryView } from "../../components/SampleView";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, Checkbox, Collapsible, Empty, Field, Input, Loading, Notice, NumberInput, PageHeader, Select, Tabs, Textarea } from "../../components/ui";
import { fmtAgo, fmtCost, statusVi } from "../../lib/format";
import { callText, modelLabel } from "../../lib/friendly";
import { useDatasets, useMeta, useModels } from "../../lib/hooks";

type Tab = "create" | "review" | "export";

// ---------------- 1. Tạo ----------------
function CreateTab({ onReview }: { onReview: (ds: string) => void }) {
  const meta = useMeta();
  const models = useModels();
  const toast = useToast();
  const qc = useQueryClient();
  const llms = (models.data ?? []).filter((m) => m.role === "llm" && m.id !== "oracle");
  const [name, setName] = useState("");
  const [writer, setWriter] = useState("");
  const [labeler, setLabeler] = useState("");
  const [n, setN] = useState<number | null>(100);
  const [budget, setBudget] = useState<number | null>(5);
  const [busy, setBusy] = useState<string | null>(null);
  const [warn, setWarn] = useState<string | null>(null);
  useEffect(() => {
    if (!writer && llms.length) setWriter(llms[0].id);
    if (!labeler && llms.length) setLabeler(llms[0].id);
  }, [llms, writer, labeler]);
  const cal = useQuery({ queryKey: ["calibration", labeler], queryFn: () => api.calibration(labeler), enabled: !!labeler });
  const batches = useQuery({ queryKey: ["batches"], queryFn: api.batches, refetchInterval: 4000 });

  const start = async (preview: boolean) => {
    if (!meta.data) return;
    if (!writer || !labeler) return toast.error("Hãy chọn model viết câu và model gán nhãn");
    setBusy(preview ? "preview" : "gen");
    setWarn(null);
    try {
      const recipe = { ...meta.data.recipe_default, writer_model: writer, labeler_model: labeler, n_samples: n ?? 100, budget_usd: budget };
      const r = preview
        ? await api.synthPreview(recipe, 5, name || "Thử 5 mẫu")
        : await api.synthGenerate({ recipe, name: name || undefined });
      if (r.calibration && !r.calibration.ok) setWarn(r.calibration.message);
      toast.success(preview ? "Đang tạo thử 5 mẫu…" : "Đã bắt đầu tạo dữ liệu");
      qc.invalidateQueries({ queryKey: ["batches"] });
      qc.invalidateQueries({ queryKey: ["datasets"] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  if (models.isLoading || meta.isLoading) return <Loading />;
  if (!llms.length)
    return (
      <Notice color="yellow">
        Cần ít nhất một model LLM để tạo dữ liệu. <Link to="/connect" className="font-medium underline">Kết nối model</Link>
      </Notice>
    );
  return (
    <div className="space-y-4">
      <Card title="Tạo bộ dữ liệu mới" subtitle="Model viết câu nói giả lập của người dùng; model gán nhãn chạy thật trên bộ mô phỏng để tạo đáp án. Mọi mẫu đều được tự kiểm tra trước khi đến bước duyệt.">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Tên bộ dữ liệu (tuỳ chọn)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: đợt 1" />
          </Field>
          <Field label="Số mẫu">
            <NumberInput value={n} onChange={setN} min={1} />
          </Field>
          <Field label="Model viết câu">
            <Select value={writer} onChange={setWriter} options={llms.map((m) => ({ value: m.id, label: modelLabel(m) }))} />
          </Field>
          <Field label="Model gán nhãn (teacher)" hint="Nên là model mạnh nhất bạn có">
            <Select value={labeler} onChange={setLabeler} options={llms.map((m) => ({ value: m.id, label: modelLabel(m) }))} />
          </Field>
          <Field label="Chi phí tối đa (USD)" hint="Vượt thì tự dừng">
            <NumberInput value={budget} onChange={setBudget} step={0.5} />
          </Field>
        </div>
        {cal.data && (
          <Notice color={cal.data.ok ? "green" : "yellow"} className="mt-3">
            {cal.data.ok ? "✓ " : "⚠ "}Model gán nhãn: {cal.data.message}.
            {!cal.data.ok && (
              <>
                {" "}
                <Link className="font-medium underline" to={`/evaluate?llm_model=${encodeURIComponent(labeler)}&dataset=train`}>
                  Chấm thử model này trên tập train
                </Link>{" "}
                để biết nhãn nó tạo có đáng tin không (nên ≥ 85 điểm).
              </>
            )}
          </Notice>
        )}
        {warn && <Notice color="yellow" className="mt-2">{warn}</Notice>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button loading={busy === "preview"} onClick={() => start(true)}>
            Tạo thử 5 mẫu
          </Button>
          <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} loading={busy === "gen"} onClick={() => start(false)}>
            Tạo {n ?? 0} mẫu
          </Button>
        </div>
      </Card>
      <Card title="Các lần tạo" bodyClass="p-0">
        {batches.isLoading ? (
          <Loading />
        ) : (batches.data ?? []).length === 0 ? (
          <Empty className="m-3">Chưa tạo lần nào.</Empty>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {(batches.data ?? []).map((b) => (
              <div key={b.id} className="space-y-2 px-3 py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">{b.name}</div>
                    <div className="muted text-xs">
                      {b.n_done}/{b.n_target} mẫu · {fmtCost(b.cost)} · {fmtAgo(b.created)}
                    </div>
                  </div>
                  <Button size="sm" variant="primary" onClick={() => onReview(b.dataset_id)} disabled={!b.n_done}>
                    Duyệt
                  </Button>
                </div>
                {b.job_id && b.status === "running" && <JobProgress id={b.job_id} compact showResult={false} />}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------- 2. Duyệt ----------------
const FILTERS: { v: string; label: string; q: { status?: string; flagged?: string } }[] = [
  { v: "pending", label: "Chờ duyệt", q: { status: "pending" } },
  { v: "warn", label: "Có cảnh báo", q: { flagged: "any" } },
  { v: "relabel", label: "Cần gán lại", q: { status: "needs_relabel" } },
  { v: "approved", label: "Đã duyệt", q: { status: "approved" } },
  { v: "rejected", label: "Đã loại", q: { status: "rejected" } },
];

function ReviewEditor({ ds, row, onDone, onEdited }: { ds: string; row: QueueRow; onDone: (status?: string) => void; onEdited: (status: string) => void }) {
  const meta = useMeta();
  const models = useModels();
  const toast = useToast();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["synth-sample", ds, row.sample_id], queryFn: () => api.synthSample(ds, row.sample_id) });
  const [text, setText] = useState("");
  const [calls, setCalls] = useState<unknown>(null);
  const [callsOk, setCallsOk] = useState(true);
  const [saving, setSaving] = useState(false);
  const [relabelJob, setRelabelJob] = useState<string | null>(null);
  const rj = useJob(relabelJob);
  useEffect(() => {
    // gán nhãn lại xong -> tải lại mẫu và hàng đợi
    if (rj.data && rj.data.status !== "running" && rj.data.status !== "cancelling") {
      qc.invalidateQueries({ queryKey: ["synth-sample", ds, row.sample_id] });
      qc.invalidateQueries({ queryKey: ["queue", ds] });
    }
  }, [rj.data?.status, ds, row.sample_id, qc]);
  const rec: Json = q.data?.record;
  useEffect(() => {
    if (rec) {
      setText(rec.audio_text ?? "");
      setCalls(rec.label?.tool_calls ?? []);
    }
  }, [rec]);
  const llms = (models.data ?? []).filter((m) => m.role === "llm" && m.id !== "oracle");
  const [relabelModel, setRelabelModel] = useState("");
  useEffect(() => {
    if (!relabelModel && llms.length) setRelabelModel(rec?.meta?.labeler ?? llms[0].id);
  }, [llms, relabelModel, rec]);

  const setStatus = async (status: string) => {
    try {
      await api.review(ds, [row.sample_id], status);
      qc.invalidateQueries({ queryKey: ["queue", ds] });
      qc.invalidateQueries({ queryKey: ["datasets"] });
      onDone(status);
    } catch (e) {
      toast.error(e);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "a" || e.key === "A") setStatus("approved");
      if (e.key === "r" || e.key === "R") setStatus("rejected");
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  if (q.isLoading || !rec) return <Loading />;
  const textChanged = text !== (rec.audio_text ?? "");
  const callsChanged = JSON.stringify(calls) !== JSON.stringify(rec.label?.tool_calls ?? []);
  const save = async () => {
    const edits: Record<string, unknown> = {};
    if (textChanged) edits.audio_text = text;
    if (callsChanged) edits.tool_calls = calls;
    setSaving(true);
    try {
      await api.editSynth(ds, row.sample_id, edits);
      toast.success(callsChanged ? "Đã lưu và tính lại kết quả" : "Đã lưu câu mới — cần gán nhãn lại cho khớp câu");
      qc.invalidateQueries({ queryKey: ["synth-sample", ds, row.sample_id] });
      qc.invalidateQueries({ queryKey: ["queue", ds] });
      qc.invalidateQueries({ queryKey: ["datasets"] });
      onEdited(callsChanged ? "pending" : "needs_relabel");
    } catch (e) {
      toast.error(e);
    } finally {
      setSaving(false);
    }
  };
  const relabel = async () => {
    try {
      const r = await api.relabel(ds, { sample_ids: [row.sample_id], model: relabelModel, rules: rec.meta?.rules ?? "rules_v2" });
      setRelabelJob(r.job_id);
    } catch (e) {
      toast.error(e);
    }
  };
  const scen = meta.data?.scenarios?.[rec.meta?.scenario];
  const flags = (q.data?.review?.flags ?? rec.meta?.flags ?? []) as { level: string; msg: string }[];
  const status = q.data?.review?.status ?? row.status;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs">{row.sample_id}</span>
        <Badge color={status === "approved" ? "green" : status === "rejected" ? "red" : status === "needs_relabel" ? "yellow" : "gray"}>{statusVi(status)}</Badge>
        {scen && <Badge color="blue">{scen.name}</Badge>}
      </div>
      {flags.length > 0 && (
        <Notice color={flags.some((f) => f.level === "error") ? "red" : "yellow"}>
          <div className="font-medium">Hệ thống tự kiểm tra thấy:</div>
          <ul className="ml-4 list-disc text-sm">
            {flags.map((f, i) => (
              <li key={i}>{f.msg}</li>
            ))}
          </ul>
        </Notice>
      )}
      {(rec.history ?? []).length > 0 && (
        <Collapsible title={`Hội thoại trước đó (${(rec.history ?? []).filter((t: Json) => t.role === "user").length} lượt)`}>
          <HistoryView history={rec.history} />
        </Collapsible>
      )}
      <Field label="Người dùng nói" hint={rec.meta?.expected ? `Hành vi mong đợi: ${rec.meta.expected}` : undefined}>
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <div>
        <div className="mb-1 text-sm font-medium">Trợ lý cần làm (đáp án)</div>
        {(rec.label?.tool_calls ?? []).length === 0 ? (
          <div className="muted rounded-md border border-dashed border-slate-300 p-2 text-sm dark:border-slate-700">Không gọi app nào (ngoài phạm vi)</div>
        ) : (
          <ol className="space-y-1">
            {(rec.label?.tool_calls ?? []).map((c: Json, i: number) => {
              const res = rec.label?.tool_results?.[i];
              return (
                <li key={i} className="rounded-md border border-slate-200 px-2.5 py-1.5 dark:border-slate-700">
                  <div className="break-all font-mono text-[12px]">{i + 1}. {callText(c)}</div>
                  {res && <div className="muted mt-0.5 truncate text-xs">→ {JSON.stringify(res).slice(0, 180)}</div>}
                </li>
              );
            })}
          </ol>
        )}
      </div>
      <Collapsible title="Sửa đáp án (JSON)">
        <JsonEditor value={calls} onChange={setCalls} onValidity={setCallsOk} height="200px" resetKey={row.sample_id + (q.dataUpdatedAt ?? 0)} />
        <div className="muted mt-1 text-xs">Sau khi lưu, kết quả của từng lệnh và dữ liệu cuối được hệ thống mô phỏng tính lại tự động.</div>
      </Collapsible>
      {(textChanged || callsChanged) && (
        <div className="flex justify-end">
          <Button variant="primary" loading={saving} disabled={!callsOk} onClick={save}>
            Lưu thay đổi
          </Button>
        </div>
      )}
      {status === "needs_relabel" && (
        <Notice color="yellow">
          <div className="mb-2">Câu nói đã đổi nên đáp án có thể không còn khớp. Cho model gán nhãn lại:</div>
          <div className="flex flex-wrap gap-2">
            <Select value={relabelModel} onChange={setRelabelModel} options={llms.map((m) => ({ value: m.id, label: modelLabel(m) }))} className="max-w-xs" />
            <Button onClick={relabel}>Gán nhãn lại</Button>
          </div>
          {relabelJob && (
            <div className="mt-2">
              <JobProgress id={relabelJob} compact showResult={false} />
            </div>
          )}
        </Notice>
      )}
      <div className="flex flex-wrap gap-2 border-t border-slate-200 pt-3 dark:border-slate-800">
        <Button variant="success" size="md" icon={<Check className="h-4 w-4" />} onClick={() => setStatus("approved")}>
          Duyệt <kbd className="ml-1 rounded bg-white/20 px-1 text-[10px]">A</kbd>
        </Button>
        <Button variant="danger" size="md" icon={<X className="h-4 w-4" />} onClick={() => setStatus("rejected")}>
          Loại <kbd className="ml-1 rounded bg-black/5 px-1 text-[10px]">R</kbd>
        </Button>
        <span className="muted self-center text-xs">Phím J / K: mẫu sau / trước</span>
      </div>
    </div>
  );
}

function ReviewTab({ ds, setDs }: { ds: string | null; setDs: (d: string) => void }) {
  const datasets = useDatasets();
  const toast = useToast();
  const qc = useQueryClient();
  const syn = (datasets.data ?? []).filter((d) => d.kind === "synthetic");
  const [filter, setFilter] = useState("pending");
  const [cur, setCur] = useState<string | null>(null);
  useEffect(() => {
    if (!ds && syn.length) setDs(syn[syn.length - 1].id);
  }, [ds, syn, setDs]);
  const fq = FILTERS.find((f) => f.v === filter)!.q;
  const queue = useQuery({ queryKey: ["queue", ds, filter], queryFn: () => api.queue(ds as string, fq), enabled: !!ds });
  const rows = queue.data ?? [];
  const idx = rows.findIndex((r) => r.sample_id === cur);
  const row = idx >= 0 ? rows[idx] : rows[0];
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const i = rows.findIndex((r) => r.sample_id === row?.sample_id);
      if ((e.key === "j" || e.key === "J") && i < rows.length - 1) setCur(rows[i + 1].sample_id);
      if ((e.key === "k" || e.key === "K") && i > 0) setCur(rows[i - 1].sample_id);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });
  const approveClean = async () => {
    if (!ds) return;
    try {
      const clean = await api.queue(ds, { status: "pending", flagged: "clean" });
      if (!clean.length) return toast.info("Không có mẫu sạch nào đang chờ duyệt");
      if (!confirm(`Duyệt ${clean.length} mẫu không có cảnh báo nào?`)) return;
      await api.review(ds, clean.map((r) => r.sample_id), "approved");
      qc.invalidateQueries({ queryKey: ["queue", ds] });
      qc.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(`Đã duyệt ${clean.length} mẫu`);
    } catch (e) {
      toast.error(e);
    }
  };
  if (datasets.isLoading) return <Loading />;
  if (!syn.length) return <Empty>Chưa có dữ liệu tự tạo. Sang bước 1 để tạo.</Empty>;
  const summary = syn.find((d) => d.id === ds)?.review;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Bộ dữ liệu" className="min-w-64">
          <Select value={ds} onChange={setDs} options={syn.map((d) => ({ value: d.id, label: `${d.name} (${d.n} mẫu)` }))} />
        </Field>
        {summary && (
          <div className="muted text-sm">
            Đã duyệt {summary.status?.approved ?? 0} · đã loại {summary.status?.rejected ?? 0} · chờ {summary.status?.pending ?? 0}
          </div>
        )}
        <Button className="ml-auto" onClick={approveClean}>
          Duyệt nhanh mọi mẫu không có cảnh báo
        </Button>
      </div>
      <div className="grid gap-3 lg:grid-cols-[280px_1fr]">
        <Card bodyClass="p-0">
          <div className="flex flex-wrap gap-1 border-b border-slate-200 p-2 dark:border-slate-800">
            {FILTERS.map((f) => (
              <button
                key={f.v}
                onClick={() => {
                  setFilter(f.v);
                  setCur(null);
                }}
                className={clsx("rounded px-2 py-0.5 text-xs", filter === f.v ? "bg-accent-600 text-white" : "bg-slate-100 dark:bg-slate-800")}
              >
                {f.label}
              </button>
            ))}
          </div>
          {queue.isLoading ? (
            <Loading />
          ) : rows.length === 0 ? (
            <div className="muted p-3 text-sm">Không có mẫu.</div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              {rows.map((r) => (
                <button
                  key={r.sample_id}
                  onClick={() => setCur(r.sample_id)}
                  className={clsx(
                    "flex w-full items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1.5 text-left text-xs dark:border-slate-800",
                    row?.sample_id === r.sample_id ? "bg-accent-50 dark:bg-accent-950/30" : "hover:bg-slate-50 dark:hover:bg-white/5",
                  )}
                >
                  <span className="truncate font-mono">{r.sample_id.split("_").pop()}</span>
                  <span className="flex gap-1">
                    {r.n_err > 0 && <Badge color="red">{r.n_err} lỗi</Badge>}
                    {r.n_warn > 0 && <Badge color="yellow">{r.n_warn}</Badge>}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>
        <Card>
          {row && ds ? (
            <ReviewEditor
              key={row.sample_id}
              ds={ds}
              row={row}
              onDone={() => {
                const i = rows.findIndex((r) => r.sample_id === row.sample_id);
                const nx = rows[i + 1] ?? rows[i - 1];
                setCur(nx?.sample_id ?? null);
              }}
              onEdited={(st) => {
                // giữ nguyên mẫu đang sửa: chuyển sang bộ lọc chứa trạng thái mới của nó
                setCur(row.sample_id);
                setFilter(st === "needs_relabel" ? "relabel" : "pending");
              }}
            />
          ) : (
            <div className="muted text-sm">Chọn một mẫu bên trái.</div>
          )}
        </Card>
      </div>
    </div>
  );
}

// ---------------- 3. Xuất ----------------
function ExportTab() {
  const datasets = useDatasets();
  const toast = useToast();
  const qc = useQueryClient();
  const exports = useQuery({ queryKey: ["exports"], queryFn: api.exports, refetchInterval: 4000 });
  const [sel, setSel] = useState<Record<string, boolean>>({ train: true });
  const [name, setName] = useState("");
  const [job, setJob] = useState<string | null>(null);
  const choices = useMemo(() => (datasets.data ?? []).filter((d) => d.id === "train" || d.kind === "synthetic"), [datasets.data]);
  const go = async () => {
    const comps = choices.filter((d) => sel[d.id]).map((d) => ({ dataset_id: d.id, weight: 1.0, statuses: ["approved"] }));
    if (!comps.length) return toast.error("Chọn ít nhất một bộ dữ liệu");
    try {
      const r = await api.startExport({ name: name || "train", components: comps, options: { kind: "sft" } });
      setJob(r.job_id);
      qc.invalidateQueries({ queryKey: ["exports"] });
    } catch (e) {
      toast.error(e);
    }
  };
  if (datasets.isLoading) return <Loading />;
  return (
    <div className="space-y-4">
      <Card title="Xuất file train" subtitle="Gộp các bộ dữ liệu thành một file JSONL để fine-tune model (đúng định dạng prompt lúc chạy thật). Với dữ liệu tự tạo, chỉ mẫu đã duyệt được xuất.">
        <div className="space-y-2">
          {choices.map((d) => (
            <Checkbox
              key={d.id}
              checked={!!sel[d.id]}
              onChange={(v) => setSel((s) => ({ ...s, [d.id]: v }))}
              label={
                d.id === "train"
                  ? `Tập train gốc (${d.n} mẫu)`
                  : `${d.name} (${d.review?.status?.approved ?? 0} mẫu đã duyệt / ${d.n})`
              }
            />
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <Field label="Tên file (tuỳ chọn)">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: sft_v1" />
          </Field>
          <Button variant="primary" icon={<Download className="h-4 w-4" />} onClick={go}>
            Xuất file
          </Button>
        </div>
        <div className="muted mt-2 text-xs">Tập public test không bao giờ được xuất (luật thi).</div>
        {job && (
          <div className="mt-3">
            <JobProgress id={job} compact showResult={false} />
          </div>
        )}
      </Card>
      <Card title="Các file đã xuất" bodyClass="p-0">
        {(exports.data ?? []).length === 0 ? (
          <Empty className="m-3">Chưa xuất file nào.</Empty>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {(exports.data ?? []).map((v) => {
              const file = (v.options?.kind ?? "sft") === "sft" ? "sft.jsonl" : "asr_manifest.jsonl";
              return (
                <div key={v.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
                  <div>
                    <div className="text-sm font-medium">{v.name}</div>
                    <div className="muted text-xs">
                      {v.stats?.n ?? 0} mẫu · {fmtAgo(v.created)}
                    </div>
                  </div>
                  <a href={api.exportDownloadUrl(v.id, file)}>
                    <Button size="sm" icon={<Download className="h-3.5 w-3.5" />}>
                      Tải {file}
                    </Button>
                  </a>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

export default function CreateData() {
  const { ds: dsParam } = useParams();
  const nav = useNavigate();
  const [tab, setTab] = useState<Tab>(dsParam ? "review" : "create");
  const [ds, setDs] = useState<string | null>(dsParam ?? null);
  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <PageHeader title="Tạo dữ liệu" subtitle="Sinh thêm dữ liệu huấn luyện, tự kiểm tra lại, rồi xuất file để fine-tune." />
      <Tabs
        value={tab}
        onChange={(t) => {
          setTab(t);
          if (t !== "review") nav("/data", { replace: true });
        }}
        items={[
          { value: "create", label: "1. Tạo" },
          { value: "review", label: "2. Duyệt" },
          { value: "export", label: "3. Xuất file train" },
        ]}
      />
      {tab === "create" && (
        <CreateTab
          onReview={(d) => {
            setDs(d);
            setTab("review");
          }}
        />
      )}
      {tab === "review" && <ReviewTab ds={ds} setDs={setDs} />}
      {tab === "export" && <ExportTab />}
    </div>
  );
}
