/* Biểu đồ dùng chung (recharts). Một chuỗi = màu slot 1; hai chuỗi = slot 1 + slot 2, luôn có chú thích. */
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useTheme } from "./theme";

export function useChartColors() {
  const { dark } = useTheme();
  return dark
    ? { s1: "#3987e5", s2: "#d95926", grid: "#2b2d33", axis: "#8b8e96", text: "#c3c2b7", muted: "#3a3d44", surface: "#18191c", red: "#e66767" }
    : { s1: "#2a78d6", s2: "#eb6834", grid: "#ececec", axis: "#8a8984", text: "#52514e", muted: "#c9d3df", surface: "#ffffff", red: "#e34948" };
}

export function tooltipStyle(c: ReturnType<typeof useChartColors>) {
  return {
    contentStyle: { background: c.surface, border: `1px solid ${c.grid}`, borderRadius: 6, fontSize: 12, color: c.text },
    itemStyle: { color: c.text },
    labelStyle: { color: c.text, fontWeight: 600 },
    cursor: { fill: c.grid, opacity: 0.5 },
  };
}

/** Biểu đồ cột đếm từ Dict<number>. horizontal = cột nằm ngang (nhãn dài). */
export function CountBars({
  data,
  horizontal,
  height,
  top,
  onClick,
  active,
  valueLabel = "Số mẫu",
  labels,
}: {
  data: Record<string, number> | null | undefined;
  horizontal?: boolean;
  height?: number;
  top?: number;
  onClick?: (key: string) => void;
  active?: string | null;
  valueLabel?: string;
  labels?: Record<string, string>;
}) {
  const c = useChartColors();
  let rows = Object.entries(data ?? {}).map(([k, v]) => ({ k, label: labels?.[k] ?? k, v }));
  if (top) rows = rows.sort((a, b) => b.v - a.v).slice(0, top);
  if (!rows.length) return <div className="p-4 text-center text-xs text-slate-500">Không có dữ liệu</div>;
  const h = height ?? (horizontal ? Math.max(120, rows.length * 22 + 30) : 200);
  const tt = tooltipStyle(c);
  return (
    <ResponsiveContainer width="100%" height={h}>
      {horizontal ? (
        <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }} barCategoryGap={2}>
          <CartesianGrid horizontal={false} stroke={c.grid} />
          <XAxis type="number" stroke={c.axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <YAxis type="category" dataKey="label" width={150} stroke={c.axis} tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11, fill: c.text }} />
          <Tooltip {...tt} formatter={(v: number) => [v, valueLabel]} />
          <Bar dataKey="v" maxBarSize={24} radius={[0, 4, 4, 0]} onClick={(d: { k?: string }) => onClick && d.k && onClick(d.k)} cursor={onClick ? "pointer" : undefined}>
            {rows.map((r) => (
              <Cell key={r.k} fill={active && active !== r.k ? c.muted : c.s1} />
            ))}
          </Bar>
        </BarChart>
      ) : (
        <BarChart data={rows} margin={{ left: -16, right: 8, top: 8, bottom: 4 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke={c.grid} />
          <XAxis dataKey="label" stroke={c.axis} tickLine={false} interval={0} tick={{ fontSize: 11, fill: c.text }} />
          <YAxis stroke={c.axis} tickLine={false} axisLine={false} allowDecimals={false} />
          <Tooltip {...tt} formatter={(v: number) => [v, valueLabel]} />
          <Bar dataKey="v" maxBarSize={48} radius={[4, 4, 0, 0]} onClick={(d: { k?: string }) => onClick && d.k && onClick(d.k)} cursor={onClick ? "pointer" : undefined}>
            {rows.map((r) => (
              <Cell key={r.k} fill={active && active !== r.k ? c.muted : c.s1} />
            ))}
          </Bar>
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}

/** Hai chuỗi cạnh nhau (vd thực tế vs mục tiêu), cột nằm ngang. */
export function PairBars({
  rows,
  aLabel,
  bLabel,
  fmt = (v: number) => String(v),
}: {
  rows: { label: string; a: number | null; b: number | null }[];
  aLabel: string;
  bLabel: string;
  fmt?: (v: number) => string;
}) {
  const c = useChartColors();
  if (!rows.length) return <div className="p-4 text-center text-xs text-slate-500">Không có dữ liệu</div>;
  const tt = tooltipStyle(c);
  return (
    <ResponsiveContainer width="100%" height={Math.max(140, rows.length * 34 + 50)}>
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 16, top: 4, bottom: 4 }} barGap={2} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={c.grid} />
        <XAxis type="number" stroke={c.axis} tickLine={false} axisLine={false} tickFormatter={fmt} />
        <YAxis type="category" dataKey="label" width={150} stroke={c.axis} tickLine={false} axisLine={false} interval={0} tick={{ fontSize: 11, fill: c.text }} />
        <Tooltip {...tt} formatter={(v: number, n: string) => [fmt(v), n]} />
        <Legend wrapperStyle={{ fontSize: 12, color: c.text }} />
        <Bar dataKey="a" name={aLabel} fill={c.s1} radius={[0, 4, 4, 0]} />
        <Bar dataKey="b" name={bLabel} fill={c.s2} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
