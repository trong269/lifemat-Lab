/* Một mẫu: câu người dùng nói, đáp án vs việc model đã làm (đặt cạnh nhau), lỗi giải thích bằng lời. */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, ChevronLeft, ChevronRight } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { api, type Json } from "../../api";
import { AudioList, HistoryView } from "../../components/SampleView";
import { Badge, Button, Card, Collapsible, ErrorBox, Loading, Notice, PageHeader } from "../../components/ui";
import { DiffText } from "../Trace";
import { useAdvanced } from "../../lib/advanced";
import { callText, ERROR_FRIENDLY, errorTitle } from "../../lib/friendly";

function CallList({ calls, matched, results, diffs, side }: { calls: Json[]; matched: Set<number>; results?: Json[]; diffs: Json[]; side: "gold" | "pred" }) {
  if (!calls.length)
    return <div className="muted rounded-md border border-dashed border-slate-300 p-3 text-sm dark:border-slate-700">Không gọi app nào</div>;
  return (
    <ol className="space-y-1.5">
      {calls.map((c, i) => {
        const ok = matched.has(i);
        const d = diffs.find((x) => (side === "gold" ? x.gold : x.pred) && JSON.stringify(side === "gold" ? x.gold : x.pred) === JSON.stringify({ name: c.name, arguments: c.arguments ?? {} }));
        const res = results?.[i];
        const rejected = res && res.ok === false;
        return (
          <li
            key={i}
            className={clsx(
              "rounded-md border px-2.5 py-1.5",
              ok ? "border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30" : "border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
            )}
          >
            <div className="break-all font-mono text-[12px]">
              {i + 1}. {callText(c)}
            </div>
            {!ok && d?.diff && (
              <div className="mt-0.5 text-xs text-red-700 dark:text-red-300">
                {Object.entries(d.diff as Record<string, string>)
                  .map(([k, v]) => (k === "_" ? v : `${k}: ${v}`))
                  .join(" · ")}
              </div>
            )}
            {rejected && <div className="mt-0.5 text-xs text-red-700 dark:text-red-300">Bị từ chối: {String(res.error ?? "")}</div>}
          </li>
        );
      })}
    </ol>
  );
}

export default function SampleResult() {
  const { id = "", sid = "" } = useParams();
  const { advanced } = useAdvanced();
  const q = useQuery({ queryKey: ["trace", id, sid], queryFn: () => api.trace(id, sid) });
  const runQ = useQuery({ queryKey: ["run", id], queryFn: () => api.run(id) });
  const ds = runQ.data?.dataset_id;
  const list = useQuery({
    queryKey: ["run-samples-nav", id],
    queryFn: () => api.runSamples(id, { sort: "score", limit: 5000 }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorBox error={q.error ?? "Không tìm thấy mẫu"} />;
  const { trace, row, sample } = q.data;
  const rec = sample?.sample ?? {};
  const gold: Json[] | null = trace.gold ?? null;
  const pred: Json[] = trace.pred ?? [];
  const matches: [number, number][] = trace.matches ?? [];
  const mp = new Set(matches.map((x) => x[0]));
  const mg = new Set(matches.map((x) => x[1]));
  const diffs: Json[] = trace.diff ?? [];
  const finalText: string = rec.audio_text ?? "";
  const heard: string | undefined = trace.transcripts?.[rec.audio];
  const ids = (list.data?.rows ?? []).map((r) => r.sample_id);
  const pos = ids.indexOf(sid);
  const prev = pos > 0 ? ids[pos - 1] : null;
  const next = pos >= 0 && pos < ids.length - 1 ? ids[pos + 1] : null;
  const score = row?.score as number | null;
  const tags: string[] = row?.tags ?? [];
  const agentErr = trace.agent?.error;
  const asrOnly = runQ.data?.config?.mode === "asr_only";
  const asrRows: [string, Json][] = Object.entries((trace.asr ?? {}) as Record<string, Json>).sort((a, b) => Number(!!a[1].final) - Number(!!b[1].final));

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <Link to={`/evaluate/${id}`} className="muted inline-flex items-center gap-1 text-sm hover:underline">
          <ArrowLeft className="h-4 w-4" /> Kết quả lần chạy
        </Link>
        <div className="flex gap-1.5">
          <Link to={prev ? `/evaluate/${id}/${prev}` : "#"}>
            <Button size="sm" disabled={!prev} icon={<ChevronLeft className="h-4 w-4" />}>Mẫu trước</Button>
          </Link>
          <Link to={next ? `/evaluate/${id}/${next}` : "#"}>
            <Button size="sm" disabled={!next}>
              Mẫu sau <ChevronRight className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </div>
      <PageHeader
        title={<span className="font-mono">{sid}</span>}
        subtitle={
          asrOnly ? (
            "Lần chạy chỉ đo nhận dạng giọng nói"
          ) : score == null ? (
            "Mẫu không có đáp án"
          ) : (
            <span>
              Điểm mẫu: <b className={score >= 0.999 ? "text-emerald-600" : score > 0 ? "text-amber-600" : "text-red-600"}>{Math.round(score * 100)}/100</b>
              {row?.hash_ok === 0 && " — kết quả cuối khác đáp án nên mẫu bị 0 điểm"}
            </span>
          )
        }
        actions={advanced ? <Link className="text-sm text-accent-600 hover:underline" to={`/runs/${id}/s/${sid}`}>Chi tiết kỹ thuật →</Link> : undefined}
      />

      {asrOnly && (
        <Card title="Nhận dạng giọng nói" subtitle="Từng lượt nói: chữ đúng so với chữ model nghe được · gạch đỏ: nghe mất · nền xanh: nghe thêm/sai">
          {asrRows.length === 0 ? (
            <div className="muted text-sm">Không có dữ liệu ASR cho mẫu này.</div>
          ) : (
            <div className="space-y-2">
              {asrRows.map(([rel, a]) => (
                <div key={rel} className="rounded-md border border-slate-200 p-2 text-sm dark:border-slate-800">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium">{a.final ? "Lượt cuối" : `Lượt ${rel.match(/_u(\d+)\.wav$/)?.[1] ?? "?"}`}</span>
                    {a.w_n != null && <Badge color={a.w_err ? "yellow" : "green"}>WER {((100 * a.w_err) / Math.max(1, a.w_n)).toFixed(1)}%</Badge>}
                    {a.e_n ? <span>tên/số/giờ đúng {a.e_hit}/{a.e_n}</span> : null}
                    {a.error && <Badge color="red">{a.error}</Badge>}
                  </div>
                  {a.ref != null ? <DiffText ref_={a.ref} hyp={a.hyp ?? ""} refNorm={a.ref_norm} hypNorm={a.hyp_norm} /> : <span>{a.hyp}</span>}
                </div>
              ))}
            </div>
          )}
          {sample && ds && sample.audio_files.length > 0 && (
            <Collapsible title="Nghe audio" className="mt-3">
              <AudioList ds={ds} files={sample.audio_files} />
            </Collapsible>
          )}
        </Card>
      )}

      {!asrOnly && (<>
      <Card title="Người dùng nói">
        <div className="text-base">“{finalText || heard || "—"}”</div>
        {heard != null && heard !== finalText && (
          <div className="mt-2 text-sm">
            <span className="muted">Model nhận dạng giọng nói nghe thành: </span>“{heard}”
          </div>
        )}
        {sample && ds && sample.audio_files.length > 0 && (
          <Collapsible title="Nghe audio" className="mt-3">
            <AudioList ds={ds} files={sample.audio_files} />
          </Collapsible>
        )}
        {(rec.history ?? []).length > 0 && (
          <Collapsible title={`Hội thoại trước đó (${(rec.history ?? []).filter((t: Json) => t.role === "user").length} lượt)`} className="mt-3">
            <HistoryView history={rec.history} ds={ds} />
          </Collapsible>
        )}
      </Card>

      {tags.length > 0 && (
        <Notice color="red">
          <div className="font-medium">Vấn đề:</div>
          <ul className="ml-4 list-disc">
            {tags.map((t) => (
              <li key={t}>
                <b>{errorTitle(t)}</b> — {ERROR_FRIENDLY[t]?.hint}
              </li>
            ))}
          </ul>
          {agentErr && <div className="mt-1 text-xs">Chi tiết: {String(agentErr)}</div>}
        </Notice>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Card title="Đáp án đúng" subtitle="Các lệnh gọi app mà BTC chấm là đúng">
          {gold == null ? <div className="muted text-sm">Không có đáp án</div> : <CallList calls={gold} matched={mg} diffs={diffs} side="gold" />}
        </Card>
        <Card title="Model đã làm" subtitle="Xanh: khớp đáp án · Đỏ: sai hoặc thừa">
          <CallList calls={pred} matched={gold == null ? new Set(pred.map((_, i) => i)) : mp} results={trace.pred_results} diffs={diffs} side="pred" />
        </Card>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {tags.length === 0 && score != null && score >= 0.999 && <Badge color="green">Mẫu này đúng hoàn toàn</Badge>}
      </div>
      </>)}
    </div>
  );
}
