import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Download, Plus, ShieldCheck, Trash2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { tooltipStyle, useChartColors } from "../components/Charts";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Loading, Notice, NumberInput, PageHeader, Select } from "../components/ui";
import { fmtScore, fmtTime } from "../lib/format";
import { useRuns } from "../lib/hooks";

export default function Submission() {
  const runs = useRuns();
  const toast = useToast();
  const qc = useQueryClient();
  const c = useChartColors();
  const done = useMemo(() => {
    // ưu tiên: public_test → run agent đã chấm điểm → còn lại (run chỉ ASR xếp cuối)
    const rank = (x: { dataset_id: string; score: number | null; kind: string }) => (x.dataset_id === "public_test" ? 0 : x.score !== null ? 1 : 2);
    return (runs.data ?? []).filter((x) => x.done > 0).sort((a, b) => rank(a) - rank(b) || b.created - a.created);
  }, [runs.data]);
  const [run, setRun] = useState("");
  const [other, setOther] = useState("");
  useEffect(() => {
    if (!run && done.length) setRun(done[0].id);
  }, [done, run]);
  const checks = useQuery({ queryKey: ["sub-checks", run, other], queryFn: () => api.subChecks(run, other || undefined), enabled: !!run });
  const [val, setVal] = useState<{ returncode: number; stdout: string; stderr: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const validate = async () => {
    setBusy(true);
    setVal(null);
    try {
      setVal(await api.subValidate(run));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const selRun = done.find((r) => r.id === run);

  const lb = useQuery({ queryKey: ["lb"], queryFn: api.lbScores });
  const [lbRun, setLbRun] = useState("");
  const [lbScore, setLbScore] = useState<number | null>(null);
  const [lbNote, setLbNote] = useState("");
  const addLb = async () => {
    if (lbScore === null) return;
    try {
      await api.addLb({ run_id: lbRun || null, score: lbScore, note: lbNote });
      setLbScore(null);
      setLbNote("");
      qc.invalidateQueries({ queryKey: ["lb"] });
      toast.success("Đã ghi điểm leaderboard");
    } catch (e) {
      toast.error(e);
    }
  };
  const delLb = async (id: number) => {
    try {
      await api.deleteLb(id);
      qc.invalidateQueries({ queryKey: ["lb"] });
    } catch (e) {
      toast.error(e);
    }
  };
  const chartData = [...(lb.data ?? [])].reverse().map((x) => ({ name: x.run_name ?? fmtTime(x.ts), lb: x.score, local: x.local_score }));

  return (
    <div className="space-y-4">
      <PageHeader title="Nộp bài" subtitle="Kiểm tra luật thi trước khi nộp submission.jsonl và theo dõi điểm leaderboard" />
      <Card>
        <div className="grid gap-3 md:grid-cols-[2fr_2fr_auto]">
          <Field label="Run cần nộp" hint="Ưu tiên run trên public_test">
            <Select value={run} onChange={(v) => (setRun(v), setVal(null))} options={done.map((r) => ({ value: r.id, label: `${r.dataset_id} · ${r.name} · ${fmtScore(r.score)} · ${r.id}` }))} placeholder="Chọn run…" />
          </Field>
          <Field label="Run thứ hai để kiểm tra tất định (tuỳ chọn)" hint="Chạy lại cùng cấu hình rồi chọn ở đây">
            <Select value={other} onChange={setOther} placeholder="(không)" options={done.filter((r) => r.id !== run).map((r) => ({ value: r.id, label: `${r.dataset_id} · ${r.name} · ${r.id}` }))} />
          </Field>
          <div className="flex items-end gap-2">
            <Button icon={<ShieldCheck className="h-4 w-4" />} onClick={validate} loading={busy} disabled={!run}>
              Validate bằng zaic_tools
            </Button>
            <a href={run ? api.submissionUrl(run) : undefined} download>
              <Button variant="primary" icon={<Download className="h-4 w-4" />} disabled={!run}>
                Tải submission
              </Button>
            </a>
          </div>
        </div>
        {selRun && selRun.dataset_id !== "public_test" && (
          <Notice color="yellow" className="mt-3">
            Run này chạy trên <b>{selRun.dataset_id}</b>, không phải public_test — chỉ dùng để thử quy trình.
          </Notice>
        )}
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card
          title="Danh sách kiểm tra"
          actions={checks.data && (checks.data.passed ? <Badge color="green">đạt</Badge> : <Badge color="red">chưa đạt</Badge>)}
          bodyClass="p-0"
        >
          {!run ? (
            <div className="p-3">
              <Empty>Chọn một run.</Empty>
            </div>
          ) : checks.isLoading ? (
            <Loading />
          ) : checks.error ? (
            <div className="p-3">
              <ErrorBox error={checks.error} />
            </div>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {checks.data?.items.map((it, i) => (
                <li key={i} className="flex items-start gap-2.5 px-3.5 py-2">
                  {it.ok ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  ) : it.level === "warn" ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium">
                      {it.name} {!it.ok && <span className="text-xs font-normal text-slate-500">({it.level === "warn" ? "cảnh báo" : "lỗi"})</span>}
                    </div>
                    <div className="break-words text-xs text-slate-500">{it.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Kết quả validate (zaic_tools --validate)">
          {!val ? (
            <div className="text-sm text-slate-500">Bấm “Validate bằng zaic_tools” để kiểm tra định dạng file submission bằng công cụ chính thức.</div>
          ) : (
            <div className="space-y-2">
              <div>{val.ok ? <Badge color="green">hợp lệ (mã {val.returncode})</Badge> : <Badge color="red">lỗi (mã {val.returncode})</Badge>}</div>
              {val.stdout && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-slate-50 p-2 font-mono text-[11px] dark:bg-black/20">{val.stdout}</pre>}
              {val.stderr && <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-red-50 p-2 font-mono text-[11px] text-red-700 dark:bg-red-950/30 dark:text-red-300">{val.stderr}</pre>}
            </div>
          )}
        </Card>
      </div>
      <Card title="Nhật ký điểm leaderboard" subtitle="Ghi lại điểm public LB để so với điểm local">
        <div className="mb-3 grid gap-2 md:grid-cols-[2fr_120px_2fr_auto]">
          <Select value={lbRun} onChange={setLbRun} placeholder="Run (tuỳ chọn)" options={done.map((r) => ({ value: r.id, label: `${r.name} · ${r.id}` }))} />
          <NumberInput value={lbScore} onChange={setLbScore} placeholder="Điểm LB" />
          <Input value={lbNote} onChange={(e) => setLbNote(e.target.value)} placeholder="Ghi chú" />
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={addLb} disabled={lbScore === null}>
            Thêm
          </Button>
        </div>
        {chartData.length > 0 && (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ left: -10, right: 16, top: 8 }}>
              <CartesianGrid vertical={false} stroke={c.grid} />
              <XAxis dataKey="name" stroke={c.axis} tickLine={false} tick={{ fontSize: 11, fill: c.text }} />
              <YAxis stroke={c.axis} tickLine={false} axisLine={false} domain={["auto", "auto"]} />
              <Tooltip {...tooltipStyle(c)} cursor={{ stroke: c.axis }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="local" name="Điểm local" stroke={c.s1} strokeWidth={2} dot={{ r: 4 }} connectNulls />
              <Line type="monotone" dataKey="lb" name="Điểm LB" stroke={c.s2} strokeWidth={2} dot={{ r: 4 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
        {lb.isLoading ? (
          <Loading />
        ) : !lb.data?.length ? (
          <Empty>Chưa ghi điểm nào.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl mt-2">
              <thead>
                <tr>
                  <th>Thời điểm</th>
                  <th>Run</th>
                  <th className="text-right">Điểm local</th>
                  <th className="text-right">Điểm LB</th>
                  <th className="text-right">Chênh</th>
                  <th>Ghi chú</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {lb.data.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap text-xs text-slate-500">{fmtTime(x.ts)}</td>
                    <td className="text-xs">
                      {x.run_id ? (
                        <Link className="link" to={`/runs/${x.run_id}`}>
                          {x.run_name ?? x.run_id}
                        </Link>
                      ) : (
                        "—"
                      )}
                      {x.dataset_id && <span className="ml-1 text-slate-500">({x.dataset_id})</span>}
                    </td>
                    <td className="text-right font-mono text-xs">{fmtScore(x.local_score)}</td>
                    <td className="text-right font-mono text-xs font-semibold">{fmtScore(x.score)}</td>
                    <td className="text-right font-mono text-xs">{x.local_score != null ? (x.score - x.local_score).toFixed(2) : "—"}</td>
                    <td className="text-xs">{x.note}</td>
                    <td className="text-right">
                      <Button size="xs" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => delLb(x.id)} title="Xoá" />
                    </td>
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
