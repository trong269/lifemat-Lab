/* Kết quả một lần chạy: điểm, lỗi diễn giải bằng lời, mẫu sai, ASR, tải/kiểm tra file nộp bài. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowLeft, Download, FileCheck2, RotateCcw, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, type AsrRow } from "../../api";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, Collapsible, Empty, ErrorBox, Loading, Notice, PageHeader, Progress, Stat, StatusBadge } from "../../components/ui";
import { useAdvanced } from "../../lib/advanced";
import { DiffText } from "../Trace";
import { fmtCost, fmtScore, fmtSec, statusVi } from "../../lib/format";
import { ERROR_FRIENDLY, errorTitle, SCENARIO_FRIENDLY } from "../../lib/friendly";

/** Danh sách câu ASR (xếp theo lỗi giảm dần), mỗi câu bấm được để mở trang mẫu. */
function AsrList({ rows, runId, loading }: { rows: AsrRow[]; runId: string; loading: boolean }) {
  const [shown, setShown] = useState(50);
  if (loading) return <Loading />;
  if (!rows.length) return <Empty>Không có câu nào nghe sai 🎉</Empty>;
  return (
    <div className="space-y-2 text-sm">
      <div className="muted text-xs">{rows.length} câu nghe chưa đúng · so sánh sau chuẩn hoá như cách tính WER (chữ thường, bỏ dấu câu, “sáu” = “6”) · gạch đỏ: nghe mất · nền xanh: nghe thêm/sai</div>
      <div className="max-h-[560px] space-y-1.5 overflow-y-auto pr-1">
        {rows.slice(0, shown).map((a, i) => (
          <Link
            key={i}
            to={`/evaluate/${runId}/${a.sample_id}`}
            className="block rounded-md border border-slate-100 p-2 hover:border-accent-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-white/5"
          >
            <div className="muted mb-0.5 flex flex-wrap gap-2 text-xs">
              <span className="font-mono">{a.sample_id}</span>
              <span>{a.final ? "lượt cuối" : "lượt history"}</span>
              <span>lỗi {a.wer}%</span>
              {a.entity_recall != null && <span>tên/số/giờ đúng {a.entity_recall}%</span>}
            </div>
            <DiffText ref_={a.ref ?? ""} hyp={a.hyp ?? ""} refNorm={a.ref_norm} hypNorm={a.hyp_norm} />
          </Link>
        ))}
      </div>
      {shown < rows.length && (
        <Button size="sm" onClick={() => setShown(shown + 100)}>
          Xem thêm ({rows.length - shown} câu)
        </Button>
      )}
    </div>
  );
}

export default function Result() {
  const { id = "" } = useParams();
  const { advanced } = useAdvanced();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [tag, setTag] = useState<string | null>(null);
  const [onlyWrong, setOnlyWrong] = useState(true);
  const [validate, setValidate] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const run = useQuery({
    queryKey: ["run", id],
    queryFn: () => api.run(id),
    refetchInterval: (q) => (q.state.data && (q.state.data.active || q.state.data.status === "running") ? 2000 : false),
  });
  const r = run.data;
  const active = !!r && (r.active || r.status === "running");
  const samples = useQuery({
    queryKey: ["run-samples-simple", id, tag, onlyWrong, r?.done],
    queryFn: () =>
      api.runSamples(id, { filter: { tag: tag ?? undefined, max_score: onlyWrong && r?.metrics?.score != null ? 0.9999 : undefined }, sort: "score", limit: 500 }),
    enabled: !!r,
  });
  const texts = useQuery({
    queryKey: ["ds-texts", r?.dataset_id],
    queryFn: () => api.datasetSamples(r!.dataset_id, { limit: 100000 }),
    enabled: !!r,
    staleTime: 300_000,
  });
  const textOf = useMemo(() => new Map((texts.data?.rows ?? []).map((x) => [x.id, x.text ?? ""])), [texts.data]);
  const hasAsr = !!r?.metrics?.asr;
  const asrOnly = r?.config?.mode === "asr_only";
  const asrRows = useQuery({ queryKey: ["run-asr", id, r?.done], queryFn: () => api.runAsr(id, 3000), enabled: hasAsr });

  if (run.isLoading) return <Loading />;
  if (run.error || !r) return <ErrorBox error={run.error ?? "Không tìm thấy lần chạy"} />;
  const m = r.metrics ?? { n: 0 };
  const labeled = m.score != null;
  const tags = Object.entries(m.tags ?? {}).sort((a, b) => b[1] - a[1]);

  const stop = async () => {
    try {
      await api.runAction(id, "cancel");
      qc.invalidateQueries({ queryKey: ["run", id] });
    } catch (e) {
      toast.error(e);
    }
  };
  const rerunWrong = async () => {
    setBusy("rerun");
    try {
      const n = await api.rerun(id, { which: "failed" });
      nav(`/evaluate/${n.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const doValidate = async () => {
    setBusy("validate");
    try {
      const v = await api.subValidate(id);
      setValidate({ ok: v.ok, text: (v.stdout || v.stderr || "").trim() });
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Link to="/evaluate" className="muted inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="h-4 w-4" /> Đánh giá
      </Link>
      <PageHeader
        title={r.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={active ? "running" : r.status} /> {r.done}/{r.total} mẫu · model {r.config.llm_model}
            {r.config.asr_model !== "gold-asr" && <> · ASR {r.config.asr_model}</>}
          </span>
        }
        actions={
          <>
            {active && (
              <Button variant="danger" icon={<Square className="h-4 w-4" />} onClick={stop}>
                Dừng
              </Button>
            )}
            {advanced && <Link className="text-sm text-accent-600 hover:underline" to={`/runs/${id}`}>Chi tiết kỹ thuật →</Link>}
          </>
        }
      />
      {active && (
        <Card>
          <div className="mb-1 text-sm">Đang chạy… {r.done}/{r.total} mẫu</div>
          <Progress value={r.done} max={Math.max(r.total, 1)} />
        </Card>
      )}
      {r.error && <Notice color="red">Lần chạy gặp lỗi: {r.error.split("\n")[0]}</Notice>}
      {labeled && m.alt_scores && (
        <Notice>
          Điểm chính chấm theo cách đã đối chiếu với leaderboard public: bỏ qua tham số thừa và không phân biệt hoa/thường.
          Nếu chấm chặt theo từng chữ của luật: tham số thừa là sai <b>{fmtScore(m.alt_scores.strict_keys)}</b> · phân biệt hoa/thường{" "}
          <b>{fmtScore(m.alt_scores.case_sensitive)}</b> · cả hai <b>{fmtScore(m.alt_scores.literal)}</b>.
        </Notice>
      )}

      {labeled ? (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Điểm (theo công thức BTC)" value={<span className="text-3xl">{fmtScore(m.score)}</span>} sub="trên thang 100" />
          <Stat label="Mẫu đúng hoàn toàn" value={`${m.perfect ?? 0}/${m.n_scored ?? m.n}`} />
          <Stat label="Thời gian / mẫu" value={fmtSec(m.latency_p50)} sub={`chậm nhất ${fmtSec(m.latency_max)}${m.over_30s ? ` · ${m.over_30s} mẫu quá 30s` : ""}`} tone={m.over_30s ? "bad" : undefined} />
          <Stat label="Chi phí" value={fmtCost(m.cost ?? r.cost)} />
        </div>
      ) : (
        !active &&
        (asrOnly ? (
          <Notice>Lần chạy này chỉ đo nhận dạng giọng nói (không chạy LLM), nên không có điểm agent. Bấm một câu bên dưới để xem chi tiết từng lượt nói.</Notice>
        ) : (
          <Notice>Dữ liệu này không có đáp án nên không chấm điểm được. Bạn có thể tải file nộp bài và kiểm tra tính hợp lệ bên dưới.</Notice>
        ))
      )}

      {labeled && tags.length > 0 && (
        <Card title="Model hay sai ở đâu?" subtitle="Bấm một dòng để xem các mẫu bị lỗi đó">
          <div className="space-y-1">
            {tags.map(([t, n]) => (
              <button
                key={t}
                onClick={() => {
                  setTag(tag === t ? null : t);
                  setOnlyWrong(false);
                }}
                className={clsx(
                  "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left hover:bg-slate-50 dark:hover:bg-white/5",
                  tag === t && "bg-accent-50 dark:bg-accent-950/30",
                )}
              >
                <span className="w-12 text-right font-semibold tabular-nums">{n}</span>
                <span className="min-w-0 flex-1">
                  <span className="text-sm font-medium">{errorTitle(t)}</span>
                  <span className="muted block text-xs">{ERROR_FRIENDLY[t]?.hint}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>
      )}

      {labeled && m.by_scenario && (
        <Collapsible title="Điểm theo loại yêu cầu">
          <table className="w-full text-sm">
            <tbody>
              {Object.entries(m.by_scenario).map(([k, g]) => (
                <tr key={k} className="border-b border-slate-100 last:border-0 dark:border-slate-800">
                  <td className="py-1.5">{SCENARIO_FRIENDLY[k] ?? k}</td>
                  <td className="muted py-1.5 text-right">{g.n} mẫu</td>
                  <td className="w-24 py-1.5 text-right font-semibold tabular-nums">{fmtScore(g.score)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Collapsible>
      )}

      {hasAsr && (
        <Card title="Nhận dạng giọng nói" subtitle="So chữ model nghe được với chữ đúng">
          <div className="mb-3 grid gap-3 sm:grid-cols-3">
            <Stat label="Tỉ lệ lỗi từ (WER)" value={`${m.asr!.wer}%`} sub="càng thấp càng tốt" />
            <Stat label="Giữ đúng tên, số, giờ" value={`${m.asr!.entity_recall}%`} />
            <Stat label="Câu nghe đúng hoàn toàn" value={`${m.asr!.exact}%`} />
          </div>
          {asrOnly ? (
            <AsrList rows={asrRows.data ?? []} runId={id} loading={asrRows.isLoading} />
          ) : (
            <Collapsible title="Các câu nghe sai nhiều nhất">
              <AsrList rows={(asrRows.data ?? []).slice(0, 30)} runId={id} loading={asrRows.isLoading} />
            </Collapsible>
          )}
        </Card>
      )}

      {!asrOnly && (<Card
        title={tag ? `Mẫu bị lỗi: ${errorTitle(tag)}` : onlyWrong ? "Các mẫu chưa đúng hoàn toàn" : "Tất cả mẫu"}
        actions={
          <>
            {tag && <Button size="xs" onClick={() => setTag(null)}>Bỏ lọc</Button>}
            {labeled && (
              <Button size="xs" onClick={() => setOnlyWrong(!onlyWrong)}>
                {onlyWrong ? "Xem tất cả" : "Chỉ mẫu sai"}
              </Button>
            )}
          </>
        }
        bodyClass="p-0"
      >
        {samples.isLoading ? (
          <Loading />
        ) : (samples.data?.rows ?? []).length === 0 ? (
          <Empty className="m-3">{labeled && onlyWrong && !active ? "Không có mẫu sai 🎉" : "Chưa có mẫu nào."}</Empty>
        ) : (
          <div className="max-h-[480px] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {(samples.data?.rows ?? []).map((s) => (
              <Link key={s.sample_id} to={`/evaluate/${id}/${s.sample_id}`} className="flex items-start gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/5">
                <span
                  className={clsx(
                    "mt-0.5 w-12 shrink-0 text-right font-semibold tabular-nums",
                    s.score == null ? "text-slate-400" : s.score >= 0.999 ? "text-emerald-600" : s.score > 0 ? "text-amber-600" : "text-red-600",
                  )}
                >
                  {s.score == null ? statusVi(s.status) : Math.round(s.score * 100)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{textOf.get(s.sample_id) || s.sample_id}</span>
                  <span className="mt-0.5 flex flex-wrap gap-1">
                    <span className="muted font-mono text-[11px]">{s.sample_id}</span>
                    {(s.tags ?? []).slice(0, 3).map((t) => (
                      <Badge key={t} color="red">
                        {errorTitle(t)}
                      </Badge>
                    ))}
                  </span>
                </span>
              </Link>
            ))}
          </div>
        )}
      </Card>)}

      {!active && (
        <Card title="Tiếp theo">
          <div className="flex flex-wrap gap-2">
            {labeled && (m.perfect ?? 0) < (m.n_scored ?? m.n) && (
              <Button icon={<RotateCcw className="h-4 w-4" />} loading={busy === "rerun"} onClick={rerunWrong}>
                Chạy lại các mẫu sai
              </Button>
            )}
            <a href={api.submissionUrl(id)}>
              <Button icon={<Download className="h-4 w-4" />}>Tải file nộp bài (submission.jsonl)</Button>
            </a>
            <Button icon={<FileCheck2 className="h-4 w-4" />} loading={busy === "validate"} onClick={doValidate}>
              Kiểm tra file nộp hợp lệ
            </Button>
          </div>
          {validate && (
            <Notice color={validate.ok ? "green" : "red"} className="mt-3">
              {validate.ok ? "✓ File hợp lệ. " : "✗ File chưa hợp lệ. "}
              <span className="font-mono text-xs">{validate.text.split("\n").slice(-2).join(" ")}</span>
            </Notice>
          )}
          {r.dataset_id === "public_test" && (
            <div className="muted mt-2 text-xs">File này có thể nộp lên leaderboard public của cuộc thi.</div>
          )}
        </Card>
      )}
    </div>
  );
}
