import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, CompareResult, Json, RunMetrics } from "../api";
import { MultiSelect } from "../components/MultiSelect";
import { Badge, Card, Empty, ErrorBox, Loading, PageHeader, Select } from "../components/ui";
import { fmtCost, fmtPct, fmtSampleScore, fmtScore, fmtSec } from "../lib/format";
import { useRuns } from "../lib/hooks";

/** Làm phẳng cấu hình thành {đường.dẫn: giá trị} để so sánh. */
function flatten(o: Json, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (o && typeof o === "object" && !Array.isArray(o)) {
    for (const [k, v] of Object.entries(o)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix] = JSON.stringify(o);
  return out;
}

type MRow = { label: string; get: (m: RunMetrics | null) => string; num?: (m: RunMetrics | null) => number | null; higher?: boolean };

const METRIC_ROWS: MRow[] = [
  { label: "Điểm", get: (m) => fmtScore(m?.score), num: (m) => m?.score ?? null, higher: true },
  { label: "Hash OK", get: (m) => fmtPct(m?.hash_ok), num: (m) => m?.hash_ok ?? null, higher: true },
  { label: "Precision", get: (m) => m?.P?.toFixed(4) ?? "—", num: (m) => m?.P ?? null, higher: true },
  { label: "Recall", get: (m) => m?.R?.toFixed(4) ?? "—", num: (m) => m?.R ?? null, higher: true },
  { label: "Đúng hoàn toàn", get: (m) => String(m?.perfect ?? "—"), num: (m) => m?.perfect ?? null, higher: true },
  { label: "Độ trễ P50", get: (m) => fmtSec(m?.latency_p50), num: (m) => m?.latency_p50 ?? null, higher: false },
  { label: "Độ trễ P95", get: (m) => fmtSec(m?.latency_p95), num: (m) => m?.latency_p95 ?? null, higher: false },
  { label: "Chi phí", get: (m) => fmtCost(m?.cost), num: (m) => m?.cost ?? null, higher: false },
  { label: "Bước TB", get: (m) => String(m?.steps_mean ?? "—") },
  { label: "WER", get: (m) => (m?.asr ? fmtPct(m.asr.wer, 2) : "—"), num: (m) => m?.asr?.wer ?? null, higher: false },
  { label: "Recall thực thể", get: (m) => (m?.asr ? fmtPct(m.asr.entity_recall, 2) : "—"), num: (m) => m?.asr?.entity_recall ?? null, higher: true },
];

function MetricsTable({ data }: { data: CompareResult }) {
  const scen = Array.from(new Set(data.runs.flatMap((r) => Object.keys(r.metrics?.by_scenario ?? {}))));
  const rows: MRow[] = [
    ...METRIC_ROWS,
    ...scen.map<MRow>((s) => ({
      label: `Kịch bản: ${s}`,
      get: (m) => {
        const g = m?.by_scenario?.[s];
        return g ? `${fmtScore(g.score)} (n=${g.n})` : "—";
      },
      num: (m) => m?.by_scenario?.[s]?.score ?? null,
      higher: true,
    })),
  ];
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Chỉ số</th>
          {data.runs.map((r) => (
            <th key={r.id} className="text-right normal-case">
              <Link className="link" to={`/runs/${r.id}`}>
                {r.name}
              </Link>
              <div className="font-mono text-[10px] font-normal">{r.id}</div>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const nums = data.runs.map((r) => row.num?.(r.metrics) ?? null);
          const valid = nums.filter((x): x is number => x !== null);
          const best = valid.length > 1 && row.higher !== undefined ? (row.higher ? Math.max(...valid) : Math.min(...valid)) : null;
          return (
            <tr key={row.label}>
              <td className="text-xs">{row.label}</td>
              {data.runs.map((r, i) => (
                <td key={r.id} className={clsx("text-right font-mono text-xs", best !== null && nums[i] === best && "font-semibold text-emerald-600 dark:text-emerald-400")}>
                  {row.get(r.metrics)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ConfigDiff({ data, onlyDiff }: { data: CompareResult; onlyDiff: boolean }) {
  const flats = data.runs.map((r) => flatten(r.config));
  const keys = Array.from(new Set(flats.flatMap((f) => Object.keys(f)))).sort();
  const rows = keys.map((k) => ({ k, vals: flats.map((f) => f[k] ?? "—"), diff: new Set(flats.map((f) => f[k] ?? "—")).size > 1 })).filter((r) => !onlyDiff || r.diff);
  if (!rows.length) return <Empty>Cấu hình giống hệt nhau.</Empty>;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Khoá</th>
          {data.runs.map((r) => (
            <th key={r.id} className="normal-case">
              {r.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.k} className={r.diff ? "bg-amber-50/70 dark:bg-amber-900/10" : ""}>
            <td className="font-mono text-xs">{r.k}</td>
            {r.vals.map((v, i) => (
              <td key={i} className={clsx("break-all font-mono text-xs", r.diff && "font-semibold")}>
                {v}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function Compare() {
  const [sp, setSp] = useSearchParams();
  const ids = (sp.get("ids") ?? "").split(",").filter(Boolean);
  const runs = useRuns();
  const [onlyDiff, setOnlyDiff] = useState(true);
  const [kind, setKind] = useState("");
  const q = useQuery({ queryKey: ["compare", ids.join(",")], queryFn: () => api.compare(ids), enabled: ids.length >= 2 });
  const rows = useMemo(() => (q.data?.rows ?? []).filter((r) => !kind || r.kind === kind), [q.data, kind]);
  return (
    <div className="space-y-4">
      <PageHeader title="So sánh run" subtitle="Run đầu tiên là mốc; delta = run cuối − run đầu" />
      <Card>
        <div className="label">Chọn 2–4 run</div>
        <MultiSelect
          ordered
          value={ids}
          onChange={(v) => setSp(v.length ? { ids: v.slice(0, 4).join(",") } : {})}
          options={(runs.data ?? []).filter((r) => r.score !== null).map((r) => ({ value: r.id, label: `${r.name} · ${fmtScore(r.score)}`, hint: `${r.id} · ${r.dataset_id} · ${r.llm_model}/${r.asr_model}` }))}
          placeholder="Tìm run…"
        />
      </Card>
      {ids.length < 2 ? (
        <Empty>Chọn ít nhất 2 run để so sánh.</Empty>
      ) : q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : q.data ? (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card title="Chỉ số" bodyClass="p-0 overflow-x-auto">
              <MetricsTable data={q.data} />
            </Card>
            <Card
              title="Khác biệt cấu hình"
              actions={
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} /> chỉ khoá khác nhau
                </label>
              }
              bodyClass="p-0 overflow-x-auto"
            >
              <ConfigDiff data={q.data} onlyDiff={onlyDiff} />
            </Card>
          </div>
          <Card
            title="Mẫu có điểm khác nhau"
            subtitle={`${q.data.common} mẫu chung · tốt hơn ${q.data.flips.better ?? 0} · kém hơn ${q.data.flips.worse ?? 0} · lẫn lộn ${q.data.flips.mixed ?? 0}`}
            actions={
              <Select
                className="!h-7 !w-40 !py-0 text-xs"
                value={kind}
                onChange={setKind}
                placeholder="Tất cả"
                options={[
                  { value: "better", label: "Tốt hơn" },
                  { value: "worse", label: "Kém hơn" },
                  { value: "mixed", label: "Lẫn lộn" },
                ]}
              />
            }
            bodyClass="p-0 max-h-[640px] overflow-auto"
          >
            {!rows.length ? (
              <div className="p-3">
                <Empty>Không có mẫu nào khác điểm.</Empty>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Mẫu</th>
                    <th className="text-right">Delta</th>
                    {q.data.runs.map((r) => (
                      <th key={r.id} className="normal-case">
                        {r.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.sample_id}>
                      <td className="font-mono text-xs">
                        {r.sample_id}
                        <div>
                          <Badge color={r.kind === "better" ? "green" : r.kind === "worse" ? "red" : "yellow"}>{r.kind === "better" ? "tốt hơn" : r.kind === "worse" ? "kém hơn" : "lẫn lộn"}</Badge>
                        </div>
                      </td>
                      <td className={clsx("text-right font-mono", r.delta > 0 ? "text-emerald-600" : r.delta < 0 ? "text-red-600" : "")}>
                        {r.delta > 0 ? "+" : ""}
                        {(r.delta * 100).toFixed(1)}
                      </td>
                      {q.data!.runs.map((run, i) => (
                        <td key={run.id}>
                          <Link className="link font-mono text-xs" to={`/runs/${run.id}/s/${r.sample_id}`}>
                            {fmtSampleScore(r.scores[i])}
                          </Link>
                          <div className="flex flex-wrap gap-0.5">
                            {(r.tags[i] ?? []).map((t) => (
                              <Badge key={t} color="red">
                                {t}
                              </Badge>
                            ))}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </>
      ) : null}
    </div>
  );
}
