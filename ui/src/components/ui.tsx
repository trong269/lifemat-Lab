/* Bộ component nhỏ dùng chung (Tailwind). */
import clsx from "clsx";
import { ChevronDown, ChevronRight, Loader2, X } from "lucide-react";
import React, { useEffect, useState } from "react";
import { statusVi } from "../lib/format";

// ---------- Button ----------
type BtnVariant = "primary" | "secondary" | "ghost" | "danger" | "success";
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: "xs" | "sm" | "md";
  loading?: boolean;
  icon?: React.ReactNode;
}

const BTN: Record<BtnVariant, string> = {
  primary: "bg-accent-600 text-white hover:bg-accent-700 border-transparent dark:bg-accent-500 dark:hover:bg-accent-600",
  secondary:
    "bg-white text-slate-700 border-slate-300 hover:bg-slate-50 dark:bg-[#1d1e22] dark:text-slate-200 dark:border-slate-700 dark:hover:bg-[#25272c]",
  ghost: "bg-transparent border-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5",
  danger: "bg-white text-red-600 border-red-300 hover:bg-red-50 dark:bg-transparent dark:text-red-400 dark:border-red-800 dark:hover:bg-red-950/40",
  success: "bg-emerald-600 text-white border-transparent hover:bg-emerald-700",
};

export function Button({ variant = "secondary", size = "sm", loading, icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "xs" && "h-6 px-1.5 text-xs",
        size === "sm" && "h-8 px-2.5 text-sm",
        size === "md" && "h-9 px-3.5 text-sm",
        BTN[variant],
        className,
      )}
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------- Card ----------
export function Card({
  title,
  actions,
  children,
  className,
  bodyClass,
  subtitle,
}: {
  title?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  bodyClass?: string;
  subtitle?: React.ReactNode;
}) {
  return (
    <section className={clsx("card", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-3.5 py-2.5 dark:border-slate-800">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold">{title}</h2>}
            {subtitle && <div className="muted mt-0.5 text-xs">{subtitle}</div>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={clsx(bodyClass ?? "p-3.5")}>{children}</div>
    </section>
  );
}

// ---------- Badge ----------
export type BadgeColor = "gray" | "blue" | "green" | "red" | "yellow" | "purple" | "orange";
const BADGE: Record<BadgeColor, string> = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700",
  blue: "bg-accent-50 text-accent-700 ring-accent-200 dark:bg-accent-900/40 dark:text-accent-300 dark:ring-accent-800",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800",
  red: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800",
  yellow: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800",
  purple: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:ring-violet-800",
  orange: "bg-orange-50 text-orange-700 ring-orange-200 dark:bg-orange-900/30 dark:text-orange-300 dark:ring-orange-800",
};

export function Badge({ color = "gray", children, className, title }: { color?: BadgeColor; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-inset", BADGE[color], className)}>
      {children}
    </span>
  );
}

const STATUS_COLOR: Record<string, BadgeColor> = {
  running: "blue",
  queued: "blue",
  cancelling: "yellow",
  paused: "yellow",
  interrupted: "yellow",
  stopped_budget: "orange",
  done: "green",
  approved: "green",
  error: "red",
  crash: "red",
  llm_error: "red",
  timeout: "orange",
  rejected: "red",
  cancelled: "gray",
  pending: "gray",
  needs_relabel: "purple",
  draft: "gray",
};

export function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status ?? "";
  return (
    <Badge color={STATUS_COLOR[s] ?? "gray"}>
      {(s === "running" || s === "queued") && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {statusVi(s)}
    </Badge>
  );
}

// ---------- Form ----------
export function Field({ label, hint, children, className }: { label?: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      {label && <label className="label">{label}</label>}
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} {...rest} className={clsx("input", className)} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} {...rest} className={clsx("input", className)} />;
});

export function Select({
  value,
  onChange,
  options,
  placeholder,
  className,
  disabled,
}: {
  value: string | null | undefined;
  onChange: (v: string) => void;
  options: (string | { value: string; label: string; disabled?: boolean })[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={clsx("input pr-7", className)} disabled={disabled}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => {
        const opt = typeof o === "string" ? { value: o, label: o } : o;
        return (
          <option key={opt.value} value={opt.value} disabled={opt.disabled}>
            {opt.label}
          </option>
        );
      })}
    </select>
  );
}

/** Ô số: rỗng -> null. */
export function NumberInput({
  value,
  onChange,
  step,
  min,
  max,
  placeholder,
  className,
  allowNull = true,
}: {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  step?: number | string;
  min?: number;
  max?: number;
  placeholder?: string;
  className?: string;
  allowNull?: boolean;
}) {
  const [text, setText] = useState(value === null || value === undefined ? "" : String(value));
  useEffect(() => {
    const cur = text === "" ? null : Number(text);
    if (cur !== value) setText(value === null || value === undefined ? "" : String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <input
      type="number"
      className={clsx("input", className)}
      value={text}
      step={step ?? "any"}
      min={min}
      max={max}
      placeholder={placeholder}
      onChange={(e) => {
        setText(e.target.value);
        if (e.target.value === "") onChange(allowNull ? null : 0);
        else if (!Number.isNaN(Number(e.target.value))) onChange(Number(e.target.value));
      }}
    />
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx("inline-flex cursor-pointer select-none items-center gap-2 text-sm", disabled && "cursor-not-allowed opacity-60")}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors",
          checked ? "bg-accent-600 dark:bg-accent-500" : "bg-slate-300 dark:bg-slate-600",
        )}
      >
        <span className={clsx("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-[18px]" : "translate-x-0.5")} />
      </button>
      {label}
    </label>
  );
}

export function Checkbox({ checked, onChange, label, className }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; className?: string }) {
  return (
    <label className={clsx("inline-flex cursor-pointer select-none items-center gap-1.5 text-sm", className)}>
      <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 accent-accent-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// ---------- Tabs ----------
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: React.ReactNode; count?: number }[];
  className?: string;
}) {
  return (
    <div className={clsx("flex gap-0.5 overflow-x-auto overflow-y-hidden border-b border-slate-200 dark:border-slate-800", className)}>
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={clsx(
            "-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors",
            value === it.value
              ? "border-accent-600 text-accent-700 dark:border-accent-400 dark:text-accent-300"
              : "border-transparent text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200",
          )}
        >
          {it.label}
          {it.count !== undefined && <span className="ml-1.5 rounded bg-slate-100 px-1 text-[11px] dark:bg-slate-800">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ---------- Modal / Drawer ----------
function useEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: string;
}) {
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[6vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" className={clsx("card w-full shadow-xl", width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5" aria-label="Đóng">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-4 py-2.5 dark:border-slate-800">{footer}</div>}
      </div>
    </div>
  );
}

export function Drawer({
  open,
  onClose,
  title,
  children,
  actions,
  width = "max-w-3xl",
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  actions?: React.ReactNode;
  width?: string;
}) {
  useEsc(open, onClose);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={clsx("flex h-full w-full flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-[#18191c]", width)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-2.5 dark:border-slate-800">
          <h3 className="min-w-0 truncate text-sm font-semibold">{title}</h3>
          <div className="flex items-center gap-1.5">
            {actions}
            <button onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5" aria-label="Đóng">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

// ---------- Progress, trạng thái ----------
export function Progress({ value, max = 100, className, color }: { value: number; max?: number; className?: string; color?: string }) {
  const p = max > 0 ? Math.min(100, Math.max(0, (100 * value) / max)) : 0;
  return (
    <div className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700", className)}>
      <div className={clsx("h-full rounded-full transition-all", color ?? "bg-accent-500")} style={{ width: `${p}%` }} />
    </div>
  );
}

export function ProgressLabel({ done, total }: { done: number; total: number }) {
  return (
    <div className="flex min-w-[110px] items-center gap-2">
      <Progress value={done} max={total} className="flex-1" />
      <span className="mono whitespace-nowrap text-xs text-slate-500">
        {done}/{total}
      </span>
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx("h-4 w-4 animate-spin text-slate-400", className)} />;
}

export function Loading({ label = "Đang tải…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
      <Spinner /> {label}
    </div>
  );
}

export function Empty({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={clsx("rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500 dark:border-slate-700", className)}>{children}</div>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{msg}</div>;
}

export function Notice({ children, color = "blue", className }: { children: React.ReactNode; color?: "blue" | "yellow" | "red" | "green"; className?: string }) {
  const c = {
    blue: "border-accent-200 bg-accent-50 text-accent-800 dark:border-accent-900 dark:bg-accent-950/30 dark:text-accent-200",
    yellow: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200",
    red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200",
  }[color];
  return <div className={clsx("rounded-md border px-3 py-2 text-sm", c, className)}>{children}</div>;
}

// ---------- Stat ----------
export function Stat({ label, value, sub, className, tone }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; className?: string; tone?: "good" | "bad" }) {
  return (
    <div className={clsx("card px-3 py-2.5", className)}>
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div
        className={clsx(
          "mt-0.5 text-xl font-semibold tabular-nums",
          tone === "good" && "text-emerald-600 dark:text-emerald-400",
          tone === "bad" && "text-red-600 dark:text-red-400",
        )}
      >
        {value}
      </div>
      {sub && <div className="muted mt-0.5 text-xs">{sub}</div>}
    </div>
  );
}

// ---------- Collapsible ----------
export function Collapsible({
  title,
  children,
  defaultOpen = false,
  right,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  right?: React.ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={clsx("rounded-md border border-slate-200 dark:border-slate-800", className)}>
      <div className="flex w-full items-center gap-1.5 px-2.5 py-1.5">
        <button className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm font-medium" onClick={() => setOpen(!open)}>
          {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{title}</span>
        </button>
        {right}
      </div>
      {open && <div className="border-t border-slate-200 p-2.5 dark:border-slate-800">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: React.ReactNode; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        {subtitle && <div className="muted mt-0.5 text-sm">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={clsx("font-mono text-[12px]", className)}>{children}</span>;
}

/** Bảng có cuộn ngang. */
export function TableWrap({ children, className, maxH }: { children: React.ReactNode; className?: string; maxH?: string }) {
  return (
    <div className={clsx("overflow-auto", className)} style={maxH ? { maxHeight: maxH } : undefined}>
      {children}
    </div>
  );
}

export function Pager({ offset, limit, total, onChange }: { offset: number; limit: number; total: number; onChange: (off: number) => void }) {
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <span>
        {total ? offset + 1 : 0}–{Math.min(total, offset + limit)} / {total}
      </span>
      <Button size="xs" disabled={offset <= 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        Trước
      </Button>
      <span>
        trang {page}/{pages}
      </span>
      <Button size="xs" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Sau
      </Button>
    </div>
  );
}
