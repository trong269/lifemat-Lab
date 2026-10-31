import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api";
import { tooltipStyle, useChartColors } from "../components/Charts";
import { Card, Empty, ErrorBox, Loading, PageHeader, Select, Stat } from "../components/ui";
import { fmtCost, fmtInt, fmtNum, fmtTime } from "../lib/format";

export default function Costs() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["costs", days], queryFn: () => api.costs(days) });
  const c = useChartColors();
  const d = q.data;
  const periodTotal = (d?.by_day ?? []).reduce((a, b) => a + (b.cost || 0), 0);
  return (
    <div className="space-y-4">
      <PageHeader
        title="Chi phí"
        subtitle="Tổng hợp từ nhật ký sử dụng (run, job, playground, kiểm tra model)"
        actions={
          <Select
            className="!w-40"
            value={String(days)}
            onChange={(v) => setDays(Number(v))}
            options={[
              { value: "1", label: "24 giờ" },
              { value: "7", label: "7 ngày" },
              { value: "30", label: "30 ngày" },
              { value: "90", label: "90 ngày" },
              { value: "365", label: "1 năm" },
            ]}
          />
        }
      />
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : d ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Tổng chi phí (mọi lúc)" value={fmtCost(d.total)} />
            <Stat label={`Trong ${days} ngày`} value={fmtCost(periodTotal)} />
            <Stat label="Số lần gọi" value={fmtInt(d.by_model.reduce((a, b) => a + b.calls, 0))} />
            <Stat label="Lượt trúng cache" value={fmtInt(d.by_model.reduce((a, b) => a + (b.cached || 0), 0))} />
          </div>
          <Card title="Chi phí theo ngày (USD)">
            {!d.by_day.length ? (
              <Empty>Chưa có chi phí trong khoảng này.</Empty>
            ) : (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={d.by_day} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} stroke={c.grid} />
                  <XAxis dataKey="day" stroke={c.axis} tickLine={false} tick={{ fontSize: 11, fill: c.text }} />
                  <YAxis stroke={c.axis} tickLine={false} axisLine={false} tickFormatter={(v: number) => `$${v.toFixed(2)}`} width={60} />
                  <Tooltip {...tooltipStyle(c)} formatter={(v: number) => [fmtCost(v), "Chi phí"]} />
                  <Bar dataKey="cost" fill={c.s1} radius={[4, 4, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
          <Card title="Theo model" bodyClass="p-0 overflow-x-auto">
            {!d.by_model.length ? (
              <div className="p-3">
                <Empty>Không có dữ liệu.</Empty>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>Loại</th>
                    <th className="text-right">Lần gọi</th>
                    <th className="text-right">Token vào</th>
                    <th className="text-right">Token ra</th>
                    <th className="text-right">Giây audio</th>
                    <th className="text-right">Ký tự</th>
                    <th className="text-right">Cache</th>
                    <th className="text-right">Chi phí</th>
                  </tr>
                </thead>
                <tbody>
                  {d.by_model.map((m) => (
                    <tr key={`${m.model_id}-${m.kind}`}>
                      <td className="font-mono text-xs">{m.model_id}</td>
                      <td className="text-xs">{m.kind}</td>
                      <td className="text-right font-mono text-xs">{fmtInt(m.calls)}</td>
                      <td className="text-right font-mono text-xs">{fmtInt(m.input_tokens)}</td>
                      <td className="text-right font-mono text-xs">{fmtInt(m.output_tokens)}</td>
                      <td className="text-right font-mono text-xs">{fmtNum(m.audio_seconds, 1)}</td>
                      <td className="text-right font-mono text-xs">{fmtInt(m.chars)}</td>
                      <td className="text-right font-mono text-xs">{fmtInt(m.cached)}</td>
                      <td className="text-right font-mono text-xs font-semibold">{fmtCost(m.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
          <Card title="Theo nguồn (run / job / khác)" bodyClass="p-0 max-h-[500px] overflow-auto">
            {!d.by_owner.length ? (
              <div className="p-3">
                <Empty>Không có dữ liệu.</Empty>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Nguồn</th>
                    <th className="text-right">Lần gọi</th>
                    <th className="text-right">Chi phí</th>
                    <th>Lần đầu</th>
                  </tr>
                </thead>
                <tbody>
                  {d.by_owner.map((o) => (
                    <tr key={o.owner}>
                      <td className="font-mono text-xs">
                        {o.owner.startsWith("run_") ? (
                          <Link className="link" to={`/runs/${o.owner}`}>
                            {o.owner}
                          </Link>
                        ) : o.owner.startsWith("job_") ? (
                          <Link className="link" to={`/jobs?id=${o.owner}`}>
                            {o.owner}
                          </Link>
                        ) : (
                          o.owner
                        )}
                      </td>
                      <td className="text-right font-mono text-xs">{fmtInt(o.calls)}</td>
                      <td className="text-right font-mono text-xs">{fmtCost(o.cost)}</td>
                      <td className="text-xs text-slate-500">{fmtTime(o.first)}</td>
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
