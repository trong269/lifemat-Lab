/* Cây JSON thu gọn được. */
import clsx from "clsx";
import { ChevronDown, ChevronRight, Copy } from "lucide-react";
import { useState } from "react";

type V = unknown;

function Leaf({ v }: { v: V }) {
  if (v === null) return <span className="text-slate-400">null</span>;
  if (typeof v === "string") return <span className="break-all text-emerald-700 dark:text-emerald-400">"{v}"</span>;
  if (typeof v === "number") return <span className="text-blue-700 dark:text-blue-400">{v}</span>;
  if (typeof v === "boolean") return <span className="text-violet-700 dark:text-violet-400">{String(v)}</span>;
  return <span>{String(v)}</span>;
}

function Node({ k, v, depth, openDepth }: { k?: string; v: V; depth: number; openDepth: number }) {
  const isObj = v !== null && typeof v === "object";
  const [open, setOpen] = useState(depth < openDepth);
  const keyEl = k !== undefined ? <span className="text-slate-600 dark:text-slate-300">{k}: </span> : null;
  if (!isObj)
    return (
      <div className="pl-4">
        {keyEl}
        <Leaf v={v} />
      </div>
    );
  const arr = Array.isArray(v);
  const entries = arr ? (v as V[]).map((x, i) => [String(i), x] as const) : Object.entries(v as Record<string, V>);
  const summary = arr ? `[${entries.length}]` : `{${entries.length}}`;
  return (
    <div className={clsx(depth > 0 && "pl-4")}>
      <button className="inline-flex items-center text-left hover:text-accent-600" onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="-ml-4 h-3 w-4" /> : <ChevronRight className="-ml-4 h-3 w-4" />}
        {keyEl}
        <span className="text-slate-400">{summary}</span>
      </button>
      {open && entries.map(([kk, vv]) => <Node key={kk} k={arr ? kk : kk} v={vv} depth={depth + 1} openDepth={openDepth} />)}
    </div>
  );
}

export function JsonView({ data, openDepth = 1, className, maxH }: { data: V; openDepth?: number; className?: string; maxH?: string }) {
  const copy = () => {
    try {
      void navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    } catch {
      /* bỏ qua */
    }
  };
  return (
    <div className={clsx("group relative overflow-auto rounded-md bg-slate-50 p-2 pl-5 font-mono text-[12px] leading-5 dark:bg-black/20", className)} style={maxH ? { maxHeight: maxH } : undefined}>
      <button onClick={copy} title="Sao chép JSON" className="absolute right-1.5 top-1.5 hidden rounded p-1 text-slate-400 hover:bg-slate-200 group-hover:block dark:hover:bg-white/10">
        <Copy className="h-3 w-3" />
      </button>
      <Node v={data} depth={0} openDepth={openDepth} />
    </div>
  );
}

/** JSON một dòng, rút gọn. */
export function InlineJson({ v, max = 200, className }: { v: V; max?: number; className?: string }) {
  let s = "";
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  if (s && s.length > max) s = s.slice(0, max) + "…";
  return <code className={clsx("break-all font-mono text-[12px] text-slate-600 dark:text-slate-300", className)}>{s}</code>;
}

/** Hiển thị một tool call: tên + tham số. */
export function CallView({ call, className }: { call: { name: string; arguments?: unknown } | null | undefined; className?: string }) {
  if (!call) return <span className="muted">—</span>;
  return (
    <div className={clsx("font-mono text-[12px]", className)}>
      <span className="font-semibold text-accent-700 dark:text-accent-300">{call.name}</span>
      <span className="text-slate-500">(</span>
      <InlineJson v={call.arguments ?? {}} max={400} />
      <span className="text-slate-500">)</span>
    </div>
  );
}
