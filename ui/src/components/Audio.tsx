import { useState } from "react";
import { api } from "../api";

/** Trình phát audio của dataset; ẩn khi không có file. */
export function AudioPlayer({ ds, path, label }: { ds: string; path: string; label?: string }) {
  const [err, setErr] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2">
      {label && <span className="w-20 shrink-0 truncate font-mono text-[11px] text-slate-500" title={path}>{label}</span>}
      {err ? (
        <span className="text-xs text-slate-400">không có file audio</span>
      ) : (
        <audio controls preload="none" className="h-8 w-full max-w-[340px]" src={api.audioUrl(ds, path)} onError={() => setErr(true)} />
      )}
    </div>
  );
}

export function audioLabel(path: string): string {
  const f = path.split("/").pop() ?? path;
  const m = f.match(/_(u\d+)\.wav$/);
  return m ? m[1] : "cuối";
}
