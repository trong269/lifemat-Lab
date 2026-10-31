import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, ChevronLeft, ChevronRight, Dices, RotateCcw, Save, Sparkles, X } from "lucide-react";
import { RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, Json, QueueRow } from "../../api";
import { AudioPlayer } from "../../components/Audio";
import { PairBars } from "../../components/Charts";
import { JsonEditor } from "../../components/CodeEditor";
import { JobProgress } from "../../components/JobProgress";
import { JsonView } from "../../components/JsonView";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, Collapsible, Empty, ErrorBox, Field, Loading, Notice, NumberInput, Select, StatusBadge, Textarea } from "../../components/ui";
import { fmtTime, statusVi } from "../../lib/format";
import { useDatasets, useMeta, useModels } from "../../lib/hooks";

const same = (a: Json, b: Json) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function stripMeta(s: Json) {
  if (!s || typeof s !== "object") return s;
  const o = { ...s };
  delete o._meta;
  return o;
}

function Coverage({ ds }: { ds: string }) {
  const q = useQuery({ queryKey: ["coverage", ds], queryFn: () => api.coverage(ds) });
  const meta = useMeta();
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const c = q.data!;
  const rows = Object.entries(c.scenario).map(([k, v]) => ({ label: meta.data?.scenarios?.[k]?.name ?? k, a: Math.round(v.actual * 1000) / 10, b: v.target == null ? null : Math.round(v.target * 1000) / 10 }));
  const small = (title: string, d: Record<string, number>) => (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{title}</div>
      <table className="tbl">
        <tbody>
          {Object.entries(d).map(([k, v]) => (
            <tr key={k}>
              <td className="text-xs">{k === "null" || k === "None" ? "—" : k}</td>
              <td className="text-right font-mono text-xs">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-500">{c.n} mẫu trong split. Mục tiêu lấy từ công thức của đợt sinh đầu tiên.</div>
      <PairBars rows={rows} aLabel="Thực tế (%)" bLabel="Mục tiêu (%)" fmt={(v) => `${v}%`} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {small("Vùng miền", c.region)}
        {small("Số lượt history", c.history_turns)}
        {small("Số tool call", c.n_calls)}
        <div className="max-h-56 overflow-auto">{small("App trọng tâm", c.focus_apps)}</div>
      </div>
    </div>
  );
}

function SampleEditor({ ds, sid, textRef, onChanged }: { ds: string; sid: string; textRef: RefObject<HTMLTextAreaElement>; onChanged: () => void }) {
  const q = useQuery({ queryKey: ["synth-sample", ds, sid], queryFn: () => api.synthSample(ds, sid) });
  const models = useModels();
  const meta = useMeta();
  const toast = useToast();
  const [text, setText] = useState("");
  const [history, setHistory] = useState<Json>(null);
  const [calls, setCalls] = useState<Json>(null);
  const [state, setState] = useState<Json>(null);
  const [base, setBase] = useState<Json>(null);
  const [valid, setValid] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [relModel, setRelModel] = useState("");
  const [relRules, setRelRules] = useState("rules_v2");
  const [relJob, setRelJob] = useState<string | null>(null);
  const d = q.data;
  const rec = d?.record;
  useEffect(() => {
    if (!d) return;
    setText(d.record.audio_text ?? "");
    setHistory(d.record.history ?? []);
    setCalls(d.record.label?.tool_calls ?? []);
    setState(stripMeta(d.state));
    setBase(d.base_state);
    setValid({});
  }, [d]);
  useEffect(() => setRelJob(null), [sid]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!d || !rec) return null;
  const m = rec.meta ?? {};
  const flags = d.review?.flags ?? m.flags ?? [];
  const edits: Json = {};
  if (text !== (rec.audio_text ?? "")) edits.audio_text = text;
  if (!same(history, rec.history ?? [])) edits.history = history;
  if (!same(calls, rec.label?.tool_calls ?? [])) edits.tool_calls = calls;
  if (!same(state, stripMeta(d.state))) edits.state = state;
  if (d.base_state !== null && !same(base, d.base_state)) edits.base_state = base;
  const nChanged = Object.keys(edits).length;
  const allValid = Object.values(valid).every(Boolean);

  const save = async () => {
    setBusy(true);
    try {
      const out = await api.editSynth(ds, sid, edits);
      toast.success(`Đã lưu & mô phỏng lại (${out.changed.join(", ") || "không đổi"}) — ${out.flags.length} cờ`);
      await q.refetch();
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const relabel = async () => {
    try {
      const r = await api.relabel(ds, { sample_ids: [sid], model: relModel, rules: relRules });
      setRelJob(r.job_id);
      toast.info("Đã gửi teacher gán nhãn lại");
    } catch (e) {
      toast.error(e);
    }
  };
  const reset = () => {
    setText(rec.audio_text ?? "");
    setHistory(rec.history ?? []);
    setCalls(rec.label?.tool_calls ?? []);
    setState(stripMeta(d.state));
    setBase(d.base_state);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-semibold">{sid}</span>
        <StatusBadge status={d.review?.status} />
        <Badge color="blue">{meta.data?.scenarios?.[m.scenario]?.name ?? m.scenario}</Badge>
        {m.region && <Badge>{m.region}</Badge>}
        {m.style && <Badge>{m.style}</Badge>}
        {d.review?.spot_check ? <Badge color="purple">kiểm tra ngẫu nhiên</Badge> : null}
        {d.review?.disagreement ? <Badge color="orange">2 teacher không khớp</Badge> : null}
      </div>
      {flags.length > 0 && (
        <div className="space-y-1">
          {flags.map((f: Json, i: number) => (
            <div key={i} className={clsx("rounded px-2 py-1 text-xs", f.level === "error" ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300")}>
              <b>{f.level === "error" ? "Lỗi" : "Cảnh báo"}</b>
              {f.code && <span className="ml-1 font-mono">[{f.code}]</span>}: {f.msg}
            </div>
          ))}
        </div>
      )}
      <div className="grid gap-x-3 gap-y-0.5 rounded-md bg-slate-50 p-2 text-xs dark:bg-white/[0.03] sm:grid-cols-[120px_1fr]">
        <span className="text-slate-500">Kỳ vọng</span>
        <span>{m.expected ?? "—"}</span>
        <span className="text-slate-500">Ghi chú bẫy</span>
        <span>{Array.isArray(m.trap_notes) ? m.trap_notes.map((x: Json) => (typeof x === "string" ? x : JSON.stringify(x))).join("; ") || "—" : typeof m.trap_notes === "string" ? m.trap_notes || "—" : m.trap_notes ? JSON.stringify(m.trap_notes) : "—"}</span>
        <span className="text-slate-500">App trọng tâm</span>
        <span>{Array.isArray(m.focus) && m.focus.length ? m.focus.join(", ") : "—"}</span>
        <span className="text-slate-500">Model</span>
        <span>
          writer {m.writer ?? "—"} · teacher {m.labeler ?? "—"} · luật {m.rules ?? "—"}
        </span>
        {m.label2_score !== undefined && (
          <>
            <span className="text-slate-500">Teacher 2</span>
            <span>
              điểm khớp {m.label2_score} <JsonView data={m.label2_calls} openDepth={0} className="mt-0.5" />
            </span>
          </>
        )}
        {m.final_text && (
          <>
            <span className="text-slate-500">Câu trả lời teacher</span>
            <span>{m.final_text}</span>
          </>
        )}
        {m.gen_error && (
          <>
            <span className="text-slate-500">Lỗi sinh</span>
            <span className="text-red-600">{m.gen_error}</span>
          </>
        )}
      </div>
      {rec.audio && <AudioPlayer ds={ds} path={rec.audio} label="audio" />}
      <Field label="Câu yêu cầu cuối (audio_text)" hint="Đổi câu mà không đổi tool call → trạng thái chuyển sang “cần gán lại”">
        <Textarea ref={textRef} rows={2} value={text} onChange={(e) => setText(e.target.value)} className="text-[15px]" />
      </Field>
      <div className="grid gap-3 2xl:grid-cols-2">
        <Field label="Nhãn: tool_calls (sửa được)">
          <JsonEditor value={calls} onChange={setCalls} onValidity={(ok) => setValid((v) => ({ ...v, calls: ok }))} height="200px" resetKey={d} />
        </Field>
        <Field label="History (sửa được; tool_results được mô phỏng lại từ base_state)">
          <JsonEditor value={history} onChange={setHistory} onValidity={(ok) => setValid((v) => ({ ...v, history: ok }))} height="200px" resetKey={d} />
        </Field>
      </div>
      <div className="grid gap-3 2xl:grid-cols-2">
        <Collapsible title="tool_results (chỉ đọc — tính lại khi lưu)">
          <JsonView data={rec.label?.tool_results} openDepth={1} />
        </Collapsible>
        <Collapsible title="final_state (chỉ đọc — tính lại khi lưu)">
          <JsonView data={rec.label?.final_state} openDepth={1} />
        </Collapsible>
      </div>
      <Collapsible title="State trước lượt cuối (state.json, sửa được)" right={edits.state ? <Badge color="yellow">đã sửa</Badge> : undefined}>
        <JsonEditor value={state} onChange={setState} onValidity={(ok) => setValid((v) => ({ ...v, state: ok }))} height="280px" resetKey={d} />
      </Collapsible>
      {d.base_state !== null && (
        <Collapsible title="State trước history (base_state, sửa được)" right={edits.base_state ? <Badge color="yellow">đã sửa</Badge> : undefined}>
          <JsonEditor value={base} onChange={setBase} onValidity={(ok) => setValid((v) => ({ ...v, base: ok }))} height="280px" resetKey={d} />
        </Collapsible>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" icon={<Save className="h-4 w-4" />} onClick={save} loading={busy} disabled={!nChanged || !allValid}>
          Lưu & mô phỏng lại {nChanged ? `(${Object.keys(edits).join(", ")})` : ""}
        </Button>
        <Button icon={<RotateCcw className="h-4 w-4" />} onClick={reset} disabled={!nChanged}>
          Hoàn tác
        </Button>
      </div>
      <Card title="Teacher gán nhãn lại" bodyClass="p-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Model" className="w-56">
            <Select value={relModel} onChange={setRelModel} placeholder="Chọn model…" options={(models.data ?? []).filter((x) => x.role === "llm" && x.id !== "oracle").map((x) => x.id)} />
          </Field>
          <Field label="Bộ luật" className="w-40">
            <Select value={relRules} onChange={setRelRules} options={meta.data?.rules ?? ["rules_v2"]} />
          </Field>
          <Button icon={<Sparkles className="h-4 w-4" />} disabled={!relModel} onClick={relabel}>
            Gán nhãn lại mẫu này
          </Button>
        </div>
        {relJob && (
          <div className="mt-2">
            <JobProgress id={relJob} compact />
            <Button size="xs" className="mt-1" onClick={() => (q.refetch(), onChanged())}>
              Tải lại mẫu
            </Button>
          </div>
        )}
      </Card>
      {d.edits.length > 0 && (
        <Collapsible title={`Lịch sử sửa (${d.edits.length})`}>
          <ul className="space-y-0.5 text-xs">
            {d.edits.map((e, i) => (
              <li key={i}>
                <span className="text-slate-500">{fmtTime(e.ts)}</span> — <span className="font-mono">{e.field}</span>
              </li>
            ))}
          </ul>
        </Collapsible>
      )}
      <Collapsible title="Bản ghi đầy đủ">
        <JsonView data={rec} openDepth={1} />
      </Collapsible>
    </div>
  );
}

function Review({ ds }: { ds: string }) {
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useMeta();
  const [status, setStatus] = useState("");
  const [flagged, setFlagged] = useState("");
  const [scenario, setScenario] = useState("");
  const [spot, setSpot] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [rate, setRate] = useState<number | null>(0.1);
  const [bulkModel, setBulkModel] = useState("");
  const [bulkJob, setBulkJob] = useState<string | null>(null);
  const models = useModels();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const summary = useQuery({ queryKey: ["synth-summary", ds], queryFn: () => api.synthSummary(ds) });
  const queue = useQuery({
    queryKey: ["queue", ds, status, flagged, scenario, spot],
    queryFn: () => api.queue(ds, { status, flagged, scenario, spot: spot === "" ? null : Number(spot) }),
  });
  const rows: QueueRow[] = useMemo(() => queue.data ?? [], [queue.data]);
  useEffect(() => {
    if (rows.length && (!sel || !rows.find((r) => r.sample_id === sel))) setSel((s) => (s && rows.find((r) => r.sample_id === s) ? s : rows[0].sample_id));
  }, [rows, sel]);
  const idx = sel ? rows.findIndex((r) => r.sample_id === sel) : -1;
  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["queue", ds] });
    qc.invalidateQueries({ queryKey: ["synth-summary", ds] });
    qc.invalidateQueries({ queryKey: ["datasets"] });
  }, [qc, ds]);
  const go = useCallback(
    (d: number) => {
      if (!rows.length) return;
      const i = idx < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, idx + d));
      setSel(rows[i].sample_id);
    },
    [rows, idx],
  );
  const review = useCallback(
    async (ids: string[], st: string, advance = false) => {
      if (!ids.length) return;
      try {
        await api.review(ds, ids, st);
        toast.success(`${ids.length} mẫu → ${statusVi(st)}`);
        if (advance) go(1);
        refresh();
        qc.invalidateQueries({ queryKey: ["synth-sample", ds] });
      } catch (e) {
        toast.error(e);
      }
    },
    [ds, go, refresh, toast, qc],
  );
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || t.closest(".cm-editor")) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "a" && sel) review([sel], "approved", true);
      else if (k === "r" && sel) review([sel], "rejected", true);
      else if (k === "n" || k === "j") go(1);
      else if (k === "k" || k === "p") go(-1);
      else if (k === "e") {
        e.preventDefault();
        textRef.current?.focus();
      } else return;
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [sel, go, review]);

  const s = summary.data;
  const clean = rows.filter((r) => !r.n_err && !r.n_warn && r.status !== "approved").map((r) => r.sample_id);
  const withErr = rows.filter((r) => r.n_err > 0 && r.status !== "rejected" && r.status !== "approved").map((r) => r.sample_id);
  const spotCheck = async () => {
    try {
      const r = await api.spotCheck(ds, rate ?? 0.1);
      toast.success(`Đã chọn ${r.n} mẫu để kiểm tra ngẫu nhiên`);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  const bulkRelabel = async () => {
    const ids = rows.filter((r) => r.status === "needs_relabel").map((r) => r.sample_id);
    if (!ids.length) return toast.info("Không có mẫu “cần gán lại” trong danh sách");
    try {
      const r = await api.relabel(ds, { sample_ids: ids, model: bulkModel, rules: "rules_v2" });
      setBulkJob(r.job_id);
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="space-y-4">
      {s && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge color="blue">{s.n} mẫu</Badge>
          {Object.entries(s.status).map(([k, v]) => (
            <Badge key={k} color={k === "approved" ? "green" : k === "rejected" ? "red" : k === "needs_relabel" ? "purple" : "gray"}>
              {statusVi(k)}: {v}
            </Badge>
          ))}
          <Badge color="red">có lỗi: {s.with_error}</Badge>
          <Badge color="orange">không khớp 2 teacher: {s.disagreement}</Badge>
          <Badge color="purple">
            kiểm tra ngẫu nhiên: {s.spot_checked} đã duyệt, tỉ lệ lỗi {s.spot_error_rate == null ? "—" : `${(100 * s.spot_error_rate).toFixed(1)}%`}
          </Badge>
          <Link to={`/datasets/${ds}`} className="link ml-auto text-xs">
            Xem dataset →
          </Link>
        </div>
      )}
      <Collapsible title="Độ phủ (thực tế so với công thức)">
        <Coverage ds={ds} />
      </Collapsible>
      <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
        <Card title={`Hàng đợi (${rows.length})`} bodyClass="p-0">
          <div className="grid grid-cols-2 gap-1.5 border-b border-slate-200 p-2 dark:border-slate-800">
            <Select className="!h-7 !py-0 text-xs" value={status} onChange={setStatus} placeholder="Mọi trạng thái" options={["pending", "approved", "rejected", "needs_relabel"].map((x) => ({ value: x, label: statusVi(x) }))} />
            <Select
              className="!h-7 !py-0 text-xs"
              value={flagged}
              onChange={setFlagged}
              placeholder="Mọi cờ"
              options={[
                { value: "error", label: "Có lỗi" },
                { value: "any", label: "Có lỗi/cảnh báo" },
                { value: "clean", label: "Sạch" },
              ]}
            />
            <Select className="!h-7 !py-0 text-xs" value={scenario} onChange={setScenario} placeholder="Mọi kịch bản" options={Object.keys(s?.scenario ?? {}).map((k) => ({ value: k, label: meta.data?.scenarios?.[k]?.name ?? k }))} />
            <Select
              className="!h-7 !py-0 text-xs"
              value={spot}
              onChange={setSpot}
              placeholder="Kiểm tra ngẫu nhiên?"
              options={[
                { value: "1", label: "Chỉ mẫu được chọn" },
                { value: "0", label: "Không được chọn" },
              ]}
            />
          </div>
          <div className="flex flex-wrap gap-1 border-b border-slate-200 p-2 dark:border-slate-800">
            <Button size="xs" variant="success" disabled={!clean.length} onClick={() => confirm(`Duyệt ${clean.length} mẫu sạch trong danh sách?`) && review(clean, "approved")}>
              Duyệt mọi mẫu sạch ({clean.length})
            </Button>
            <Button size="xs" variant="danger" disabled={!withErr.length} onClick={() => confirm(`Loại ${withErr.length} mẫu có lỗi trong danh sách?`) && review(withErr, "rejected")}>
              Loại mọi mẫu lỗi chưa duyệt ({withErr.length})
            </Button>
          </div>
          <div className="max-h-[calc(100vh-340px)] min-h-[200px] overflow-y-auto">
            {queue.isLoading ? (
              <Loading />
            ) : queue.error ? (
              <ErrorBox error={queue.error} />
            ) : !rows.length ? (
              <div className="p-3">
                <Empty>Không có mẫu.</Empty>
              </div>
            ) : (
              rows.map((r) => (
                <button
                  key={r.sample_id}
                  onClick={() => setSel(r.sample_id)}
                  className={clsx(
                    "flex w-full items-center gap-2 border-b border-slate-100 px-2.5 py-1.5 text-left text-xs dark:border-slate-800/70",
                    sel === r.sample_id ? "bg-accent-50 dark:bg-accent-900/30" : "hover:bg-slate-50 dark:hover:bg-white/[0.03]",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="font-mono">{r.sample_id}</div>
                    <div className="truncate text-[11px] text-slate-500">{meta.data?.scenarios?.[r.scenario]?.name ?? r.scenario}</div>
                  </div>
                  <div className="flex shrink-0 flex-wrap justify-end gap-0.5">
                    {r.n_err > 0 && <Badge color="red">{r.n_err} lỗi</Badge>}
                    {r.n_warn > 0 && <Badge color="yellow">{r.n_warn} cảnh báo</Badge>}
                    {r.disagreement ? <Badge color="orange">≠</Badge> : null}
                    {r.spot_check ? <Badge color="purple">KT</Badge> : null}
                    <StatusBadge status={r.status} />
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="space-y-2 border-t border-slate-200 p-2 dark:border-slate-800">
            <div className="flex items-center gap-1.5">
              <span className="text-xs">Tỉ lệ</span>
              <NumberInput className="!h-7 !w-20 !py-0 text-xs" value={rate} onChange={setRate} step={0.05} min={0} max={1} />
              <Button size="xs" icon={<Dices className="h-3.5 w-3.5" />} onClick={spotCheck}>
                Chọn kiểm tra ngẫu nhiên
              </Button>
            </div>
            <div className="flex items-center gap-1.5">
              <Select className="!h-7 !py-0 text-xs" value={bulkModel} onChange={setBulkModel} placeholder="Teacher…" options={(models.data ?? []).filter((x) => x.role === "llm" && x.id !== "oracle").map((x) => x.id)} />
              <Button size="xs" icon={<Sparkles className="h-3.5 w-3.5" />} disabled={!bulkModel} onClick={bulkRelabel} title="Gán nhãn lại mọi mẫu “cần gán lại” trong danh sách">
                Gán lại hàng loạt
              </Button>
            </div>
            {bulkJob && <JobProgress id={bulkJob} compact />}
          </div>
        </Card>
        <Card
          title="Mẫu đang duyệt"
          subtitle={
            <span>
              Phím tắt: <span className="kbd">A</span> duyệt · <span className="kbd">R</span> loại · <span className="kbd">N</span>/<span className="kbd">J</span> sau ·{" "}
              <span className="kbd">K</span>/<span className="kbd">P</span> trước · <span className="kbd">E</span> sửa câu
            </span>
          }
          actions={
            sel && (
              <>
                <Button size="xs" icon={<ChevronLeft className="h-3.5 w-3.5" />} onClick={() => go(-1)} disabled={idx <= 0} />
                <span className="text-xs text-slate-500">
                  {idx + 1}/{rows.length}
                </span>
                <Button size="xs" icon={<ChevronRight className="h-3.5 w-3.5" />} onClick={() => go(1)} disabled={idx >= rows.length - 1} />
                <Button size="xs" variant="success" data-e2e="approve" icon={<Check className="h-3.5 w-3.5" />} onClick={() => review([sel], "approved", true)}>
                  Duyệt
                </Button>
                <Button size="xs" variant="danger" data-e2e="reject" icon={<X className="h-3.5 w-3.5" />} onClick={() => review([sel], "rejected", true)}>
                  Loại
                </Button>
                <Button size="xs" onClick={() => review([sel], "needs_relabel")}>
                  Cần gán lại
                </Button>
                <Button size="xs" variant="ghost" onClick={() => review([sel], "pending")}>
                  Về chờ duyệt
                </Button>
              </>
            )
          }
        >
          {sel ? <SampleEditor key={sel} ds={ds} sid={sel} textRef={textRef} onChanged={refresh} /> : <Empty>Chọn một mẫu trong hàng đợi.</Empty>}
        </Card>
      </div>
    </div>
  );
}

export default function ReviewTab() {
  const { ds } = useParams();
  const nav = useNavigate();
  const datasets = useDatasets();
  const synth = (datasets.data ?? []).filter((d) => d.kind === "synthetic");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Dataset tổng hợp" className="w-80">
          <Select value={ds ?? ""} onChange={(v) => nav(`/studio/review/${v}`)} placeholder="Chọn dataset…" options={synth.map((d) => ({ value: d.id, label: `${d.name} · ${d.id} (${d.n})` }))} />
        </Field>
      </div>
      {!ds ? (
        datasets.isLoading ? (
          <Loading />
        ) : synth.length ? (
          <Empty>Chọn một dataset tổng hợp để duyệt.</Empty>
        ) : (
          <Notice>Chưa có dataset tổng hợp. Tạo ở tab Công thức.</Notice>
        )
      ) : (
        <Review key={ds} ds={ds} />
      )}
    </div>
  );
}
