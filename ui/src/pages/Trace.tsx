import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, ChevronLeft, ChevronRight, TerminalSquare } from "lucide-react";
import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, Json } from "../api";
import { AudioPlayer, audioLabel } from "../components/Audio";
import { CallView, InlineJson, JsonView } from "../components/JsonView";
import { ContextView, HistoryView } from "../components/SampleView";
import { Badge, BadgeColor, Button, Card, Collapsible, ErrorBox, Loading, StatusBadge } from "../components/ui";
import { wordDiff } from "../lib/diff";
import { fmtCost, fmtSampleScore, fmtSec } from "../lib/format";
import { useMeta } from "../lib/hooks";

/** So sánh chữ đúng / chữ model nghe được. Nếu có bản chuẩn hoá (cách tính WER: chữ thường, bỏ dấu câu, số viết bằng chữ
 * đổi thành chữ số) thì so trên bản đó — để "sáu" và "6" không bị tô là lỗi — và hiện câu gốc bên dưới. */
export function DiffText({ ref_, hyp, refNorm, hypNorm }: { ref_: string; hyp: string; refNorm?: string; hypNorm?: string }) {
  if (refNorm != null && hypNorm != null) {
    return (
      <span className="block">
        <DiffText ref_={refNorm} hyp={hypNorm} />
        <span className="mt-1 block text-[11px] leading-4 text-slate-500">
          <span className="block">Đúng: {ref_}</span>
          <span className="block">Nghe: {hyp}</span>
        </span>
      </span>
    );
  }
  const toks = wordDiff(ref_, hyp);
  return (
    <span className="block break-words leading-6 [overflow-wrap:anywhere]">
      {toks.map((t, i) => (
        <span key={i}>
          <span
            className={clsx(
              t.op === "del" && "rounded bg-red-100 px-0.5 text-red-800 line-through dark:bg-red-900/40 dark:text-red-300",
              t.op === "ins" && "rounded bg-emerald-100 px-0.5 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
            )}
          >
            {t.text}
          </span>{" "}
        </span>
      ))}
    </span>
  );
}

const GUARD_COLOR: Record<string, BadgeColor> = { allow: "green", rewrite: "yellow", reject: "red", skip: "gray" };

function StepView({ step }: { step: Json }) {
  const u = step.usage ?? {};
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs dark:border-slate-800 dark:bg-white/[0.02]">
        <span className="font-semibold">Bước {step.i + 1}</span>
        <span>{fmtSec(step.latency_s)}</span>
        <span className="text-slate-500">
          vào {u.input_tokens ?? 0}
          {u.cache_read_tokens ? ` (+${u.cache_read_tokens} cache)` : ""} · ra {u.output_tokens ?? 0}
        </span>
        {step.cached && <Badge color="purple">cache</Badge>}
        {step.cost ? <span className="font-mono">{fmtCost(step.cost)}</span> : null}
        {step.stop_reason && <span className="text-slate-400">{step.stop_reason}</span>}
      </div>
      <div className="space-y-2 p-2.5">
        {step.text && <div className="whitespace-pre-wrap rounded bg-slate-50 p-2 text-sm dark:bg-black/20">{step.text}</div>}
        {(step.tool_calls ?? []).length === 0 && !step.text && <div className="text-xs italic text-slate-500">Model không gọi tool — kết thúc.</div>}
        {(step.actions ?? []).map((a: Json, j: number) => {
          const proposed = step.tool_calls?.[j];
          const rewritten = proposed && JSON.stringify(proposed.arguments) !== JSON.stringify(a.call?.arguments);
          return (
            <div key={j} className="rounded border border-slate-200 p-2 dark:border-slate-800">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge color={GUARD_COLOR[a.guard] ?? "gray"}>{a.guard}</Badge>
                {a.executed ? <Badge color="blue">đã chạy</Badge> : <Badge>không chạy</Badge>}
                {a.note && <span className="text-xs text-slate-500">{a.note}</span>}
              </div>
              {rewritten && (
                <div className="mt-1 text-xs text-slate-500">
                  Đề xuất: <CallView call={proposed} className="inline" />
                </div>
              )}
              <CallView call={a.call} className="mt-1" />
              {a.result !== undefined && a.result !== null && (
                <Collapsible title={<span className="text-xs">Kết quả {a.result?.ok === false ? <Badge color="red">ok=false</Badge> : null}</span>} className="mt-1.5">
                  <JsonView data={a.result} openDepth={1} />
                </Collapsible>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AgentTrace({ agent, error }: { agent: Json; error: Json }) {
  if (!agent) return <div className="text-sm text-slate-500">Không có trace agent (chế độ asr_only hoặc mẫu bị replay sau timeout).</div>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        Trạng thái: <StatusBadge status={agent.status} />
        <span className="text-xs text-slate-500">{(agent.steps ?? []).length} bước</span>
      </div>
      {(agent.error || error) && <ErrorBox error={agent.error || error} />}
      <Collapsible title={`System prompt (${(agent.system ?? "").length} ký tự)`}>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap text-xs">{agent.system}</pre>
      </Collapsible>
      <Collapsible title={`Tool (${(agent.tools ?? []).length})`}>
        <div className="flex flex-wrap gap-1">
          {(agent.tools ?? []).map((t: string) => (
            <code key={t} className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800">
              {t}
            </code>
          ))}
        </div>
      </Collapsible>
      <Collapsible title={`Tin nhắn ban đầu (${(agent.messages_init ?? []).length})`}>
        <JsonView data={agent.messages_init} openDepth={2} />
      </Collapsible>
      {(agent.steps ?? []).map((s: Json) => (
        <StepView key={s.i} step={s} />
      ))}
    </div>
  );
}

function Scoring({ trace, row }: { trace: Json; row: Json }) {
  const meta = useMeta();
  const gold: Json[] | null = trace.gold;
  const pred: Json[] = trace.pred ?? [];
  const matches: [number, number][] = trace.matches ?? [];
  const predMatched = new Map(matches.map(([p, g]) => [p, g]));
  const goldMatched = new Map(matches.map(([p, g]) => [g, p]));
  return (
    <div className="space-y-3">
      {row && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md bg-slate-50 p-2 dark:bg-white/[0.03]">
            <div className="text-[11px] text-slate-500">Điểm</div>
            <div className={clsx("text-xl font-semibold", row.score >= 0.999 ? "text-emerald-600" : row.score <= 0.001 ? "text-red-600" : "text-amber-600")}>
              {fmtSampleScore(row.score)}
            </div>
          </div>
          <div className="rounded-md bg-slate-50 p-2 dark:bg-white/[0.03]">
            <div className="text-[11px] text-slate-500">Hash</div>
            <div className="text-xl font-semibold">{row.hash_ok == null ? "—" : row.hash_ok ? "✓" : "✗"}</div>
          </div>
          <div className="rounded-md bg-slate-50 p-2 dark:bg-white/[0.03]">
            <div className="text-[11px] text-slate-500">M / U / G</div>
            <div className="font-mono text-lg font-semibold">{row.M == null ? "—" : `${row.M}/${row.U}/${row.G}`}</div>
          </div>
          <div className="col-span-3 flex justify-center gap-4 text-xs text-slate-600 dark:text-slate-300">
            <span>P = {row.P?.toFixed?.(3) ?? "—"}</span>
            <span>R = {row.R?.toFixed?.(3) ?? "—"}</span>
            <span>F1 (bỏ hash) = {row.f1_nohash?.toFixed?.(3) ?? "—"}</span>
          </div>
        </div>
      )}
      {(row?.tags ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.tags.map((t: string) => (
            <Badge key={t} color="red" title={t}>
              {meta.data?.error_tags?.[t] ?? t}
            </Badge>
          ))}
        </div>
      )}
      {(trace.diff ?? []).length > 0 && (
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Khác biệt</div>
          <div className="space-y-1.5">
            {trace.diff.map((d: Json, i: number) => (
              <div key={i} className="rounded border border-red-200 p-2 text-xs dark:border-red-900/60">
                <div className="mb-1 flex flex-wrap gap-1">
                  {Object.entries(d.diff ?? {}).map(([k, v]) => (
                    <Badge key={k} color="red">
                      {k === "_" ? String(v) : `${k}: ${v}`}
                    </Badge>
                  ))}
                </div>
                <div className="grid gap-1">
                  <div>
                    <span className="text-slate-500">gold: </span>
                    {d.gold ? <CallView call={d.gold} className="inline" /> : "—"}
                  </div>
                  <div>
                    <span className="text-slate-500">pred: </span>
                    {d.pred ? <CallView call={d.pred} className="inline" /> : "—"}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Gold ({gold?.length ?? "không có nhãn"})</div>
        {gold === null || gold === undefined ? (
          <div className="text-xs text-slate-500">Mẫu không có nhãn.</div>
        ) : gold.length === 0 ? (
          <div className="text-xs text-slate-500">[] — không gọi tool nào</div>
        ) : (
          <ol className="space-y-1">
            {gold.map((c, i) => (
              <li key={i} className={clsx("rounded border p-1.5", goldMatched.has(i) ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30")}>
                <span className="mr-1 font-mono text-[11px] text-slate-500">
                  G{i}
                  {goldMatched.has(i) ? ` ↔ P${goldMatched.get(i)}` : ""}
                </span>
                <CallView call={c} className="inline" />
              </li>
            ))}
          </ol>
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Dự đoán ({pred.length})</div>
        {pred.length === 0 ? (
          <div className="text-xs text-slate-500">[] — không gọi tool nào</div>
        ) : (
          <ol className="space-y-1">
            {pred.map((c, i) => (
              <li
                key={i}
                className={clsx(
                  "rounded border p-1.5",
                  gold == null ? "border-slate-200 dark:border-slate-800" : predMatched.has(i) ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
                )}
              >
                <span className="mr-1 font-mono text-[11px] text-slate-500">
                  P{i}
                  {predMatched.has(i) ? ` ↔ G${predMatched.get(i)}` : ""}
                </span>
                <CallView call={c} className="inline" />
                {trace.pred_results?.[i] && (
                  <div className="mt-0.5">
                    <InlineJson v={trace.pred_results[i]} max={160} className="text-[11px]" />
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="space-y-0.5 text-[11px]">
        <div>
          <span className="text-slate-500">state_hash: </span>
          <code className={clsx("break-all font-mono", trace.gold_hash && (trace.state_hash === trace.gold_hash ? "text-emerald-600" : "text-red-600"))}>{trace.state_hash}</code>
        </div>
        {trace.gold_hash && (
          <div>
            <span className="text-slate-500">gold_hash: </span>
            <code className="break-all font-mono">{trace.gold_hash}</code>
          </div>
        )}
      </div>
    </div>
  );
}

export default function Trace() {
  const { id = "", sid = "" } = useParams();
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["trace", id, sid], queryFn: () => api.trace(id, sid) });
  const run = useQuery({ queryKey: ["run", id], queryFn: () => api.run(id) });
  const ids = useQuery({ queryKey: ["run-sample-ids", id], queryFn: async () => (await api.runSamples(id, { limit: 100000 })).rows.map((r) => r.sample_id), staleTime: 30000 });
  const list = ids.data ?? [];
  const pos = list.indexOf(sid);
  const prev = pos > 0 ? list[pos - 1] : null;
  const next = pos >= 0 && pos < list.length - 1 ? list[pos + 1] : null;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      if (e.key === "ArrowLeft" && prev) nav(`/runs/${id}/s/${prev}`);
      if (e.key === "ArrowRight" && next) nav(`/runs/${id}/s/${next}`);
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [prev, next, id, nav]);

  const ds = run.data?.dataset_id ?? "";
  const t = q.data?.trace;
  const row = q.data?.row;
  const s = q.data?.sample?.sample;
  const asrRows: [string, Json][] = Object.entries(t?.asr ?? {});
  const transcripts: [string, string][] = Object.entries(t?.transcripts ?? {});
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link to={`/runs/${id}`}>
            <Button size="sm" variant="ghost" icon={<ArrowLeft className="h-4 w-4" />}>
              {run.data?.name ?? id}
            </Button>
          </Link>
          <span className="font-mono text-base font-semibold">{sid}</span>
          {row && <StatusBadge status={row.status} />}
          {pos >= 0 && (
            <span className="text-xs text-slate-500">
              {pos + 1}/{list.length}
            </span>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button size="sm" icon={<ChevronLeft className="h-4 w-4" />} disabled={!prev} onClick={() => prev && nav(`/runs/${id}/s/${prev}`)} title="Mẫu trước (←)">
            Trước
          </Button>
          <Button size="sm" disabled={!next} onClick={() => next && nav(`/runs/${id}/s/${next}`)} title="Mẫu sau (→)">
            Sau <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" icon={<TerminalSquare className="h-4 w-4" />} onClick={() => nav(`/playground?ds=${encodeURIComponent(ds)}&sid=${encodeURIComponent(sid)}`)} disabled={!ds}>
            Mở trong Playground
          </Button>
        </div>
      </div>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : t ? (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)]">
          <Card title="Ngữ cảnh" bodyClass="p-3 space-y-3">
            <div>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Câu yêu cầu cuối</div>
              <div className="rounded-md border border-accent-200 bg-accent-50 p-2 text-[15px] dark:border-accent-900 dark:bg-accent-950/30">
                {s?.audio_text ?? <span className="italic text-slate-500">(không có transcript gốc)</span>}
              </div>
            </div>
            {asrRows.length > 0 ? (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-slate-500">ASR so với gold</div>
                <div className="space-y-1.5">
                  {asrRows.map(([rel, a]) => (
                    <div key={rel} className="rounded border border-slate-200 p-2 text-sm dark:border-slate-800">
                      <div className="mb-1 flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="font-mono">{audioLabel(rel)}</span>
                        {a.w_n != null && <Badge color={a.w_err ? "yellow" : "green"}>WER {((100 * a.w_err) / Math.max(1, a.w_n)).toFixed(1)}%</Badge>}
                        {a.e_n ? <span>thực thể {a.e_hit}/{a.e_n}</span> : null}
                        {a.error && <Badge color="red">{a.error}</Badge>}
                      </div>
                      {a.ref != null ? <DiffText ref_={a.ref} hyp={a.hyp ?? ""} refNorm={a.ref_norm} hypNorm={a.hyp_norm} /> : <span>{a.hyp}</span>}
                      {a.raw && a.raw !== a.hyp && <div className="mt-0.5 text-[11px] text-slate-500">thô: {a.raw}</div>}
                      {ds && (
                        <div className="mt-1">
                          <AudioPlayer ds={ds} path={rel} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              transcripts.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Transcript dùng cho agent</div>
                  <div className="space-y-1">
                    {transcripts.map(([rel, txt]) => (
                      <div key={rel} className="text-sm">
                        <span className="mr-1 font-mono text-[11px] text-slate-500">{audioLabel(rel)}</span>
                        {txt}
                      </div>
                    ))}
                  </div>
                </div>
              )
            )}
            {ds && q.data?.sample && asrRows.length === 0 && (
              <div className="space-y-1">
                {(q.data.sample.audio_files ?? []).map((f) => (
                  <AudioPlayer key={f} ds={ds} path={f} label={audioLabel(f)} />
                ))}
              </div>
            )}
            {s && (
              <>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-slate-500">History ({(s.history ?? []).length})</div>
                  <HistoryView history={s.history} />
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Người dùng & app</div>
                  <ContextView ctx={s.context} />
                </div>
              </>
            )}
          </Card>
          <Card title="Quỹ đạo agent" bodyClass="p-3">
            <AgentTrace agent={t.agent} error={t.error} />
          </Card>
          <Card title="Chấm điểm" bodyClass="p-3">
            <Scoring trace={t} row={row} />
          </Card>
        </div>
      ) : null}
    </div>
  );
}
