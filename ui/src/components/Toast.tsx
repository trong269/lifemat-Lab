import clsx from "clsx";
import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { errorMessage } from "../api";

type Kind = "success" | "error" | "info";
interface T {
  id: number;
  kind: Kind;
  msg: string;
}

interface ToastApi {
  success: (msg: string) => void;
  error: (e: unknown) => void;
  info: (msg: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);
let seq = 0;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<T[]>([]);
  const remove = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (kind: Kind, msg: string) => {
      const id = ++seq;
      setItems((xs) => [...xs.slice(-4), { id, kind, msg }]);
      setTimeout(() => remove(id), kind === "error" ? 9000 : 3500);
    },
    [remove],
  );
  const api = useMemo<ToastApi>(
    () => ({ success: (m) => push("success", m), info: (m) => push("info", m), error: (e) => push("error", errorMessage(e)) }),
    [push],
  );
  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2">
        {items.map((t) => (
          <div
            key={t.id}
            className={clsx(
              "pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg",
              t.kind === "error" && "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-[#2a1416] dark:text-red-200",
              t.kind === "success" && "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-[#11241c] dark:text-emerald-200",
              t.kind === "info" && "border-slate-200 bg-white text-slate-800 dark:border-slate-700 dark:bg-[#1d1e22] dark:text-slate-200",
            )}
          >
            {t.kind === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : t.kind === "success" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" />}
            <div className="min-w-0 flex-1 whitespace-pre-wrap break-words">{t.msg}</div>
            <button onClick={() => remove(t.id)} className="opacity-60 hover:opacity-100" aria-label="Đóng">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error("ToastProvider missing");
  return c;
}
