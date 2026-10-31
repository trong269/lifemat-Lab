/* Chọn nhiều: danh sách chip + ô tìm kiếm. ordered=true thì giữ thứ tự và cho phép đổi thứ tự. */
import clsx from "clsx";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export interface Opt {
  value: string;
  label?: string;
  hint?: string;
}

export function MultiSelect({
  value,
  onChange,
  options,
  placeholder = "Chọn…",
  ordered,
  className,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: (string | Opt)[];
  placeholder?: string;
  ordered?: boolean;
  className?: string;
}) {
  const opts: Opt[] = options.map((o) => (typeof o === "string" ? { value: o } : o));
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const label = (v: string) => opts.find((o) => o.value === v)?.label ?? v;
  const avail = opts.filter((o) => !value.includes(o.value) && (!q || `${o.value} ${o.label ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const nv = [...value];
    [nv[i], nv[j]] = [nv[j], nv[i]];
    onChange(nv);
  };
  return (
    <div ref={ref} className={clsx("relative", className)}>
      <div
        className="input flex min-h-[32px] flex-wrap items-center gap-1 !py-1"
        onClick={() => setOpen(true)}
      >
        {value.map((v, i) => (
          <span key={v} className="inline-flex items-center gap-0.5 rounded bg-accent-50 px-1.5 py-0.5 text-xs text-accent-800 ring-1 ring-inset ring-accent-200 dark:bg-accent-900/40 dark:text-accent-200 dark:ring-accent-800">
            {ordered && <span className="mr-0.5 font-mono text-[10px] opacity-60">{i + 1}</span>}
            {label(v)}
            {ordered && (
              <>
                <button type="button" className="opacity-60 hover:opacity-100" onClick={(e) => (e.stopPropagation(), move(i, -1))} title="Lên">
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button type="button" className="opacity-60 hover:opacity-100" onClick={(e) => (e.stopPropagation(), move(i, 1))} title="Xuống">
                  <ArrowDown className="h-3 w-3" />
                </button>
              </>
            )}
            <button type="button" className="opacity-60 hover:opacity-100" onClick={(e) => (e.stopPropagation(), onChange(value.filter((x) => x !== v)))} title="Bỏ">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          className="min-w-[80px] flex-1 bg-transparent text-sm outline-none"
          placeholder={value.length ? "" : placeholder}
          value={q}
          onChange={(e) => (setQ(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && avail.length) {
              e.preventDefault();
              onChange([...value, avail[0].value]);
              setQ("");
            } else if (e.key === "Backspace" && !q && value.length) onChange(value.slice(0, -1));
          }}
        />
      </div>
      {open && avail.length > 0 && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-[#1d1e22]">
          {avail.map((o) => (
            <button
              type="button"
              key={o.value}
              className="block w-full px-2.5 py-1 text-left text-sm hover:bg-slate-100 dark:hover:bg-white/5"
              onClick={() => {
                onChange([...value, o.value]);
                setQ("");
              }}
            >
              <span>{o.label ?? o.value}</span>
              {o.label && o.label !== o.value && <span className="ml-1.5 font-mono text-[11px] text-slate-400">{o.value}</span>}
              {o.hint && <div className="truncate text-xs text-slate-500">{o.hint}</div>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
