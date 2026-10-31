import { GitCompare } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RunListRow } from "../api";
import { Button, Card, Empty, ErrorBox, Input, Loading, PageHeader, ProgressLabel, Select, StatusBadge } from "../components/ui";
import { fmtCost, fmtPct, fmtScore, fmtSec, fmtTime } from "../lib/format";
import { useRuns } from "../lib/hooks";

type SortKey = "created" | "score" | "cost" | "p95" | "wer";

export default function Runs() {
  const q = useRuns(4000);
  const nav = useNavigate();
  const [sel, setSel] = useState<string[]>([]);
  const [ds, setDs] = useState("");
  const [text, setText] = useState("");
  const [sort, setSort] = useState<SortKey>("created");
  const rows = useMemo(() => {
    let r = (q.data ?? []).filter((x) => (!ds || x.dataset_id === ds) && (!text || `${x.name} ${x.id} ${x.llm_model} ${x.asr_model}`.toLowerCase().includes(text.toLowerCase())));
    r = [...r].sort((a, b) => {
      const av = (a[sort] ?? -Infinity) as number;
      const bv = (b[sort] ?? -Infinity) as number;
      return sort === "p95" || sort === "wer" || sort === "cost" ? (av === -Infinity ? 1 : bv === -Infinity ? -1 : av - bv) : bv - av;
    });
    return r;
  }, [q.data, ds, text, sort]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));
  const dsOpts = Array.from(new Set((q.data ?? []).map((r) => r.dataset_id)));
  return (
    <div className="space-y-4">
      <PageHeader
        title="Runs"
        subtitle="Mọi lần chạy pipeline. Chọn 2–4 run để so sánh."
        actions={
          <Button variant="primary" icon={<GitCompare className="h-4 w-4" />} disabled={sel.length < 2} onClick={() => nav(`/compare?ids=${sel.join(",")}`)}>
            So sánh ({sel.length})
          </Button>
        }
      />
      <div className="flex flex-wrap gap-2">
        <Input className="!w-64" placeholder="Tìm theo tên, ID, model…" value={text} onChange={(e) => setText(e.target.value)} />
        <Select className="!w-48" value={ds} onChange={setDs} placeholder="Mọi dataset" options={dsOpts} />
        <Select
          className="!w-48"
          value={sort}
          onChange={(v) => setSort(v as SortKey)}
          options={[
            { value: "created", label: "Mới nhất" },
            { value: "score", label: "Điểm cao nhất" },
            { value: "cost", label: "Rẻ nhất" },
            { value: "p95", label: "P95 thấp nhất" },
            { value: "wer", label: "WER thấp nhất" },
          ]}
        />
      </div>
      <Card bodyClass="p-0 overflow-x-auto">
        {q.isLoading ? (
          <Loading />
        ) : q.error ? (
          <ErrorBox error={q.error} />
        ) : !rows.length ? (
          <div className="p-3">
            <Empty>Chưa có run nào.</Empty>
          </div>
        ) : (
          <RunsTable rows={rows} sel={sel} toggle={toggle} onOpen={(id) => nav(`/runs/${id}`)} />
        )}
      </Card>
    </div>
  );
}

export function RunsTable({ rows, sel, toggle, onOpen }: { rows: RunListRow[]; sel?: string[]; toggle?: (id: string) => void; onOpen: (id: string) => void }) {
  return (
    <table className="tbl">
      <thead>
        <tr>
          {toggle && <th />}
          <th>Tên</th>
          <th>Dataset</th>
          <th>LLM</th>
          <th>ASR</th>
          <th>Trạng thái</th>
          <th>Tiến độ</th>
          <th className="text-right">Điểm</th>
          <th className="text-right">Hash OK</th>
          <th className="text-right">P95</th>
          <th className="text-right">WER</th>
          <th className="text-right">Chi phí</th>
          <th>Tạo lúc</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className={`clickable ${sel?.includes(r.id) ? "selected" : ""}`} onClick={() => onOpen(r.id)}>
            {toggle && (
              <td onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="accent-accent-600" checked={!!sel?.includes(r.id)} onChange={() => toggle(r.id)} />
              </td>
            )}
            <td>
              <div className="max-w-[240px] truncate">{r.name}</div>
              <div className="font-mono text-[11px] text-slate-500">{r.id}</div>
            </td>
            <td className="text-xs">{r.dataset_id}</td>
            <td className="font-mono text-xs">{r.llm_model ?? "—"}</td>
            <td className="font-mono text-xs">{r.asr_model ?? "—"}</td>
            <td>
              <StatusBadge status={r.status} />
            </td>
            <td>
              <ProgressLabel done={r.done} total={r.total} />
            </td>
            <td className="text-right font-mono font-semibold">{fmtScore(r.score)}</td>
            <td className="text-right font-mono text-xs">{r.hash_ok != null ? fmtPct(r.hash_ok) : "—"}</td>
            <td className="text-right font-mono text-xs">{fmtSec(r.p95)}</td>
            <td className="text-right font-mono text-xs">{r.wer != null ? fmtPct(r.wer, 2) : "—"}</td>
            <td className="text-right font-mono text-xs">{fmtCost(r.cost)}</td>
            <td className="whitespace-nowrap text-xs text-slate-500">{fmtTime(r.created)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
