import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pause, Play, RotateCcw, Square, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, Dict, Group, Json, Run, RunSampleFilter } from "../api";
import { CountBars } from "../components/Charts";
import { JsonEditor } from "../components/CodeEditor";
import { JsonView } from "../components/JsonView";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, Collapsible, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, NumberInput, PageHeader, Pager, Progress, Select, Stat, StatusBadge } from "../components/ui";
import { fmtCost, fmtInt, fmtPct, fmtSampleScore, fmtScore, fmtSec, fmtTime } from "../lib/format";
import { useMeta } from "../lib/hooks";

interface LiveEvent {
  seq: number;
  type: "sample" | "status" | "log";
  sid?: string;
  score?: number | null;
  status?: string;
  tags?: string[] | null;
  latency_s?: number;
  done?: number;
  cost?: number;
  msg?: string;
}
interface LiveState {
  run: { status: string; done: number; total: number; cost: number; score: number | null } | null;
  active: boolean;
  events: LiveEvent[];
  final?: boolean;
}

/** WebSocket theo dõi run; lỗi thì trả wsFailed=true để trang chuyển sang poll. */
function useRunLive(id: string, enabled: boolean, onFinal: () => void, onSample: () => void) {
  const [live, setLive] = useState<LiveState | null>(null);
  const [wsFailed, setWsFailed] = useState(false);
  const cbs = useRef({ onFinal, onSample });
  cbs.current = { onFinal, onSample };
  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let finished = false;
    let lastSample = 0;
    try {
      ws = new WebSocket(api.wsUrl(id));
    } catch {
      setWsFailed(true);
      return;
    }
    ws.onmessage = (ev) => {
      let m: LiveState;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      setLive((prev) => ({ run: m.run, active: m.active, final: m.final, events: [...(prev?.events ?? []), ...(m.events ?? [])].slice(-300) }));
      if (m.events?.some((e) => e.type === "sample") && Date.now() - lastSample > 3000) {
        lastSample = Date.now();
        cbs.current.onSample();
      }
      if (m.final) {
        finished = true;
        cbs.current.onFinal();
      }
    };
    ws.onerror = () => setWsFailed(true);
    ws.onclose = () => {
      if (!finished) setWsFailed(true);
    };
    return () => {
      finished = true;
      ws?.close();
    };
  }, [id, enabled]);
  return { live, wsFailed };
}

function GroupTable({ title, data }: { title: string; data: Dict<Group> | undefined }) {
  if (!data || !Object.keys(data).length) return null;
  return (
    <Card title={title} bodyClass="p-0 max-h-[320px] overflow-auto">
      <table className="tbl">
        <thead>
          <tr>
            <th>Nhóm</th>
            <th className="text-right">n</th>
            <th className="text-right">Điểm</th>
            <th className="text-right">Hash OK</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(data).map(([k, g]) => (
            <tr key={k}>
              <td className="text-xs">{k}</td>
              <td className="text-right font-mono text-xs">{g.n}</td>
              <td className="text-right font-mono text-xs font-semibold">{fmtScore(g.score)}</td>
              <td className="text-right font-mono text-xs">{fmtPct(g.hash_ok)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const LIMIT = 100;

function SamplesTable({ run, tag, setTag }: { run: Run; tag: string; setTag: (t: string) => void }) {
  const nav = useNavigate();
  const meta = useMeta();
  const [f, setF] = useState<RunSampleFilter>({});
  const [sort, setSort] = useState("");
  const [offset, setOffset] = useState(0);
  const filter = useMemo(() => ({ ...f, tag: tag || undefined }), [f, tag]);
  useEffect(() => setOffset(0), [filter, sort]);
  const q = useQuery({
    queryKey: ["run-samples", run.id, filter, sort, offset],
    queryFn: () => api.runSamples(run.id, { filter, sort: sort || undefined, offset, limit: LIMIT }),
    placeholderData: (p) => p,
  });
  const m = run.metrics;
  const set = (k: keyof RunSampleFilter, v: Json) => setF((x) => ({ ...x, [k]: v === "" || v === null ? undefined : v }));
  return (
    <Card title="Mẫu" bodyClass="p-0">
      <div className="flex flex-wrap items-end gap-2 border-b border-slate-200 p-3 dark:border-slate-800">
        <Field label="Lỗi (tag)">
          <Select
            className="!w-56"
            value={tag}
            onChange={setTag}
            placeholder="Tất cả"
            options={Object.keys(m?.tags ?? meta.data?.error_tags ?? {}).map((t) => ({ value: t, label: `${meta.data?.error_tags?.[t] ?? t} (${t})` }))}
          />
        </Field>
        <Field label="Kịch bản">
          <Select className="!w-40" value={f.scenario ?? ""} onChange={(v) => set("scenario", v)} placeholder="Tất cả" options={Object.keys(m?.by_scenario ?? {})} />
        </Field>
        <Field label="App">
          <Select className="!w-40" value={f.app ?? ""} onChange={(v) => set("app", v)} placeholder="Tất cả" options={Object.keys(m?.by_app ?? {})} />
        </Field>
        <Field label="Trạng thái">
          <Select className="!w-32" value={f.status ?? ""} onChange={(v) => set("status", v)} placeholder="Tất cả" options={["done", "timeout", "llm_error", "crash"]} />
        </Field>
        <Field label="Điểm từ (0–1)">
          <NumberInput className="!w-20" value={f.min_score ?? null} onChange={(v) => set("min_score", v)} step={0.1} />
        </Field>
        <Field label="đến">
          <NumberInput className="!w-20" value={f.max_score ?? null} onChange={(v) => set("max_score", v)} step={0.1} />
        </Field>
        <Field label="ID mẫu">
          <Input className="!w-36" value={f.q ?? ""} onChange={(e) => set("q", e.target.value)} placeholder="chứa…" />
        </Field>
        <Field label="Sắp xếp">
          <Select
            className="!w-40"
            value={sort}
            onChange={setSort}
            placeholder="Theo thứ tự"
            options={[
              { value: "score", label: "Điểm tăng dần" },
              { value: "-score", label: "Điểm giảm dần" },
              { value: "-latency_s", label: "Chậm nhất" },
              { value: "-cost", label: "Đắt nhất" },
              { value: "-steps", label: "Nhiều bước nhất" },
              { value: "-wer", label: "WER cao nhất" },
            ]}
          />
        </Field>
        {tag && (
          <Button size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={() => setTag("")}>
            Bỏ lọc tag
          </Button>
        )}
        <div className="ml-auto">{q.data && <Pager offset={offset} limit={LIMIT} total={q.data.total} onChange={setOffset} />}</div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !q.data?.rows.length ? (
        <div className="p-3">
          <Empty>Không có mẫu.</Empty>
        </div>
      ) : (
        <div className="max-h-[640px] overflow-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th>Mẫu</th>
                <th className="text-right">Điểm</th>
                <th>Hash</th>
                <th className="text-right">M/U/G</th>
                <th>Lỗi</th>
                <th>Kịch bản</th>
                <th>App</th>
                <th className="text-right">Thời gian</th>
                <th className="text-right">Chi phí</th>
                <th className="text-right">Bước</th>
                <th className="text-right">WER</th>
              </tr>
            </thead>
            <tbody>
              {q.data.rows.map((r) => (
                <tr key={r.sample_id} className="clickable" onClick={() => nav(`/runs/${run.id}/s/${r.sample_id}`)}>
                  <td className="whitespace-nowrap font-mono text-xs">
                    {r.sample_id}
                    {r.status !== "done" && (
                      <span className="ml-1">
                        <StatusBadge status={r.status} />
                      </span>
                    )}
                  </td>
                  <td className={`text-right font-mono font-semibold ${r.score === null ? "" : r.score >= 0.999 ? "text-emerald-600 dark:text-emerald-400" : r.score <= 0.001 ? "text-red-600 dark:text-red-400" : "text-amber-600"}`}>
                    {fmtSampleScore(r.score)}
                  </td>
                  <td>{r.hash_ok == null ? "—" : r.hash_ok ? <Badge color="green">✓</Badge> : <Badge color="red">✗</Badge>}</td>
                  <td className="whitespace-nowrap text-right font-mono text-xs">{r.M == null ? "—" : `${r.M}/${r.U}/${r.G}`}</td>
                  <td>
                    <div className="flex max-w-[260px] flex-wrap gap-1">
                      {(r.tags ?? []).map((t) => (
                        <Badge key={t} color="red" title={meta.data?.error_tags?.[t]}>
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </td>
                  <td className="text-xs">{r.scenario ?? "—"}</td>
                  <td className="max-w-[180px] text-xs">{(r.apps ?? []).join(", ")}</td>
                  <td className="text-right font-mono text-xs">{fmtSec(r.latency_s)}</td>
                  <td className="text-right font-mono text-xs">{fmtCost(r.cost)}</td>
                  <td className="text-right font-mono text-xs">{r.steps ?? "—"}</td>
                  <td className="text-right font-mono text-xs">{r.wer != null ? `${r.wer}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const ACTIVE = new Set(["running", "queued", "paused"]);
const RESUMABLE = new Set(["paused", "interrupted", "cancelled", "stopped_budget", "error"]);

export default function RunDetail() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useMeta();
  const [tag, setTag] = useState("");
  const [rerunOpen, setRerunOpen] = useState(false);
  const [overrides, setOverrides] = useState<Dict>({});
  const [which, setWhich] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const runQ = useQuery({ queryKey: ["run", id], queryFn: () => api.run(id) });
  const run = runQ.data;
  const isActive = !!run && (run.active || ACTIVE.has(run.status));
  const { live, wsFailed } = useRunLive(
    id,
    isActive,
    () => {
      qc.invalidateQueries({ queryKey: ["run", id] });
      qc.invalidateQueries({ queryKey: ["run-samples", id] });
      qc.invalidateQueries({ queryKey: ["runs"] });
    },
    () => qc.invalidateQueries({ queryKey: ["run-samples", id] }),
  );
  // dự phòng: poll khi WebSocket lỗi
  useQuery({
    queryKey: ["run", id, "poll"],
    queryFn: async () => {
      const r = await api.run(id);
      qc.setQueryData(["run", id], r);
      return r;
    },
    enabled: isActive && wsFailed,
    refetchInterval: 2000,
  });

  const act = async (what: "pause" | "resume" | "cancel") => {
    setBusy(what);
    try {
      await api.runAction(id, what);
      toast.info(what === "pause" ? "Đã tạm dừng" : what === "resume" ? "Đã tiếp tục" : "Đã gửi yêu cầu huỷ");
      await qc.invalidateQueries({ queryKey: ["run", id] });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const rerun = async (w: string, ov?: Dict) => {
    // backend: nếu không có mẫu sai, sample_ids rỗng => chạy lại toàn bộ; chặn ở UI
    const mm = runQ.data?.metrics;
    if (w === "failed" && mm && mm.n > 0 && (mm.perfect ?? 0) === mm.n && (mm.status?.done ?? 0) === mm.n && runQ.data?.done === runQ.data?.total) {
      toast.info("Run không có mẫu sai nào để chạy lại");
      return;
    }
    if (w === "errors" && mm && (mm.status?.done ?? 0) === mm.n && runQ.data?.done === runQ.data?.total) {
      toast.info("Run không có mẫu lỗi nào để chạy lại");
      return;
    }
    setBusy("rerun");
    try {
      const r = await api.rerun(id, { which: w, overrides: ov });
      toast.success("Đã tạo run mới");
      qc.invalidateQueries({ queryKey: ["runs"] });
      setRerunOpen(false);
      nav(`/runs/${r.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const del = async () => {
    if (!confirm("Xoá run này cùng toàn bộ trace?")) return;
    try {
      await api.deleteRun(id);
      qc.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Đã xoá run");
      nav("/runs");
    } catch (e) {
      toast.error(e);
    }
  };

  if (runQ.isLoading) return <Loading />;
  if (runQ.error) return <ErrorBox error={runQ.error} />;
  if (!run) return null;
  const lr = live?.run;
  const status = lr?.status ?? run.status;
  const done = lr?.done ?? run.done;
  const total = lr?.total ?? run.total;
  const cost = lr?.cost ?? run.cost;
  const m = run.metrics;
  const samplesEv = (live?.events ?? []).filter((e) => e.type === "sample");
  const liveScores = samplesEv.map((e) => e.score).filter((s): s is number => typeof s === "number");
  const liveMean = liveScores.length ? (100 * liveScores.reduce((a, b) => a + b, 0)) / liveScores.length : null;
  const running = live ? live.active && !live.final : isActive;

  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {run.name} <StatusBadge status={status} />
          </span>
        }
        subtitle={
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            <span className="font-mono">{run.id}</span>
            <span>
              dataset <Link className="link" to={`/datasets/${run.dataset_id}`}>{run.dataset_id}</Link>
            </span>
            <span>LLM {run.config?.llm_model}</span>
            <span>ASR {run.config?.asr_model}</span>
            <span>{fmtTime(run.created)}</span>
            {run.experiment_id && (
              <Link className="link" to={`/experiments/${run.experiment_id}`}>
                thử nghiệm gốc
              </Link>
            )}
          </span>
        }
        actions={
          <>
            {status === "running" && (
              <Button icon={<Pause className="h-4 w-4" />} onClick={() => act("pause")} loading={busy === "pause"}>
                Tạm dừng
              </Button>
            )}
            {RESUMABLE.has(status) && done < total && (
              <Button icon={<Play className="h-4 w-4" />} onClick={() => act("resume")} loading={busy === "resume"}>
                Tiếp tục
              </Button>
            )}
            {(running || status === "paused") && (
              <Button variant="danger" icon={<Square className="h-4 w-4" />} onClick={() => act("cancel")} loading={busy === "cancel"}>
                Huỷ
              </Button>
            )}
            <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => rerun("failed")} loading={busy === "rerun"} disabled={running}>
              Chạy lại mẫu sai
            </Button>
            <Button icon={<RotateCcw className="h-4 w-4" />} onClick={() => setRerunOpen(true)}>
              Chạy lại với cấu hình khác
            </Button>
            <a href={api.submissionUrl(id)} download>
              <Button icon={<Download className="h-4 w-4" />}>Submission</Button>
            </a>
            <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={del} disabled={running} title="Xoá run" />
          </>
        }
      />

      {(running || status === "paused") && (
        <Card title="Tiến độ trực tiếp" subtitle={wsFailed ? "WebSocket lỗi — đang cập nhật bằng poll mỗi 2 giây" : "Cập nhật qua WebSocket"}>
          <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
            <div className="space-y-2">
              <div className="flex items-baseline justify-between text-sm">
                <span>
                  {done}/{total} mẫu
                </span>
                <span className="font-mono">{fmtCost(cost)}</span>
              </div>
              <Progress value={done} max={total} className="h-2.5" />
              <div className="text-sm">
                Điểm tạm tính (các mẫu vừa chạy): <span className="font-mono font-semibold">{liveMean != null ? liveMean.toFixed(2) : "—"}</span>
              </div>
            </div>
            <div className="max-h-48 overflow-auto rounded-md bg-slate-50 p-2 font-mono text-[11px] dark:bg-black/20">
              {(live?.events ?? []).length === 0 ? (
                <div className="text-slate-500">Đang chờ sự kiện…</div>
              ) : (
                [...(live?.events ?? [])]
                  .reverse()
                  .slice(0, 80)
                  .map((e) => (
                    <div key={e.seq} className="flex gap-2">
                      <span className="text-slate-400">#{e.seq}</span>
                      {e.type === "sample" ? (
                        <>
                          <Link className="link" to={`/runs/${id}/s/${e.sid}`}>
                            {e.sid}
                          </Link>
                          <span className={e.score === 1 ? "text-emerald-600" : e.score === 0 ? "text-red-600" : ""}>điểm {fmtSampleScore(e.score)}</span>
                          <span>{fmtSec(e.latency_s)}</span>
                          {e.status !== "done" && <span className="text-amber-600">{e.status}</span>}
                          {(e.tags ?? []).length > 0 && <span className="text-slate-500">{e.tags!.join(", ")}</span>}
                        </>
                      ) : e.type === "status" ? (
                        <span className="text-accent-600">trạng thái → {e.status}</span>
                      ) : (
                        <span className="text-amber-600">{e.msg}</span>
                      )}
                    </div>
                  ))
              )}
            </div>
          </div>
        </Card>
      )}

      {run.error && (
        <Notice color="red">
          <div className="mb-1 font-semibold">Lỗi run</div>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap font-mono text-xs">{run.error}</pre>
        </Notice>
      )}

      {m && m.n > 0 ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Điểm" value={fmtScore(m.score)} sub={`${m.n_scored ?? 0}/${m.n} mẫu được chấm`} />
            <Stat label="Hash OK" value={fmtPct(m.hash_ok)} sub={`${m.perfect ?? 0} mẫu đúng hoàn toàn`} />
            <Stat label="Precision / Recall" value={`${m.P?.toFixed(3) ?? "—"} / ${m.R?.toFixed(3) ?? "—"}`} sub={`F1 (bỏ hash) ${fmtScore(m.f1_nohash)}`} />
            {m.alt_scores && (
              <Stat
                label="Điểm nếu chấm chặt"
                value={`${fmtScore(m.alt_scores.strict_keys)} / ${fmtScore(m.alt_scores.case_sensitive)}`}
                sub={`tham số thừa là sai / phân biệt hoa-thường · cả hai: ${fmtScore(m.alt_scores.literal)}`}
              />
            )}
            <Stat
              label="Độ trễ P50 / P95"
              value={`${fmtSec(m.latency_p50)} / ${fmtSec(m.latency_p95)}`}
              sub={`max ${fmtSec(m.latency_max)} · ${m.over_30s ?? 0} mẫu > 30s`}
              tone={(m.latency_p95 ?? 0) >= 30 ? "bad" : undefined}
            />
            <Stat label="Chi phí" value={fmtCost(m.cost)} sub={`${fmtInt(m.tokens_in)} token vào · ${fmtInt(m.tokens_out)} ra`} />
            <Stat label="Bước / call TB" value={`${m.steps_mean ?? "—"} / ${m.calls_mean ?? "—"}`} sub={`ASR TB ${fmtSec(m.time_asr_mean)}`} />
            {m.asr && (
              <>
                <Stat label="WER" value={fmtPct(m.asr.wer, 2)} sub={`câu cuối ${fmtPct(m.asr.wer_final, 2)} · ${m.asr.utterances} câu`} />
                <Stat label="CER" value={fmtPct(m.asr.cer, 2)} />
                <Stat label="Recall thực thể" value={fmtPct(m.asr.entity_recall, 2)} sub={`khớp hoàn toàn ${fmtPct(m.asr.exact)}`} />
              </>
            )}
          </div>
          {m.status && (
            <div className="flex flex-wrap gap-1.5 text-xs">
              {Object.entries(m.status).map(([k, v]) => (
                <Badge key={k} color={k === "done" ? "green" : "red"}>
                  {k}: {v}
                </Badge>
              ))}
            </div>
          )}
          <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
            <GroupTable title="Theo kịch bản" data={m.by_scenario} />
            <GroupTable title="Theo app" data={m.by_app} />
            <GroupTable title="Theo số lượt history" data={m.by_history} />
            <GroupTable title="App mới / đã thấy" data={m.by_new_app} />
          </div>
          {m.tags && Object.keys(m.tags).length > 0 && (
            <Card title="Phân loại lỗi" subtitle="Bấm một cột để lọc bảng mẫu bên dưới">
              <CountBars data={m.tags} horizontal labels={meta.data?.error_tags} onClick={(k) => setTag(tag === k ? "" : k)} active={tag || null} />
            </Card>
          )}
        </>
      ) : (
        !running && <Notice color="yellow">Run chưa có chỉ số tổng hợp (chỉ có khi run kết thúc).</Notice>
      )}

      <SamplesTable run={run} tag={tag} setTag={setTag} />

      <Collapsible title="Cấu hình run (config)">
        <JsonView data={run.config} openDepth={1} />
      </Collapsible>

      <Modal
        open={rerunOpen}
        onClose={() => setRerunOpen(false)}
        title="Chạy lại với cấu hình khác"
        footer={
          <Button variant="primary" loading={busy === "rerun"} onClick={() => rerun(which, overrides)}>
            Chạy
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="Mẫu cần chạy">
            <Select
              value={which}
              onChange={setWhich}
              options={[
                { value: "all", label: "Toàn bộ (như run gốc)" },
                { value: "failed", label: "Chỉ mẫu sai (điểm < 1 hoặc lỗi)" },
                { value: "errors", label: "Chỉ mẫu lỗi (timeout / crash / lỗi LLM)" },
              ]}
            />
          </Field>
          <Field label="Ghi đè cấu hình (JSON, các khoá của ExperimentConfig)" hint='vd {"llm_model": "claude-sonnet", "guards": ["validate_repair"], "use_cache": false}'>
            <JsonEditor value={overrides} onChange={(v) => setOverrides((v as Dict) ?? {})} height="160px" />
          </Field>
          <Collapsible title="Cấu hình hiện tại để tham khảo">
            <JsonView data={run.config} openDepth={1} />
          </Collapsible>
        </div>
      </Modal>
    </div>
  );
}
