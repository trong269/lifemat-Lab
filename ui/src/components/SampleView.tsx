/* Hiển thị một mẫu: ngữ cảnh, audio, history, câu cuối, nhãn, state. */
import { Json } from "../api";
import { AudioPlayer, audioLabel } from "./Audio";
import { CallView, JsonView } from "./JsonView";
import { Badge, Collapsible } from "./ui";

export function ContextView({ ctx }: { ctx: Json }) {
  if (!ctx) return null;
  const prof = ctx.user_profile ?? {};
  const apps = Object.keys(ctx.installed_apps ?? {});
  return (
    <div className="space-y-2 text-sm">
      <div className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-0.5 text-xs">
        <span className="text-slate-500">Thời điểm</span>
        <span className="font-mono">{ctx.current_time}</span>
        {prof.name && (
          <>
            <span className="text-slate-500">Người dùng</span>
            <span>{prof.name}</span>
          </>
        )}
        {prof.city && (
          <>
            <span className="text-slate-500">Thành phố</span>
            <span>{prof.city}</span>
          </>
        )}
        {prof.home_address && (
          <>
            <span className="text-slate-500">Nhà</span>
            <span>{prof.home_address}</span>
          </>
        )}
        {prof.work_address && (
          <>
            <span className="text-slate-500">Cơ quan</span>
            <span>{prof.work_address}</span>
          </>
        )}
      </div>
      {apps.length > 0 && (
        <div>
          <div className="mb-1 text-xs text-slate-500">App đã cài ({apps.length})</div>
          <div className="flex flex-wrap gap-1">
            {apps.map((a) => (
              <Badge key={a} title={(ctx.installed_apps[a]?.tools ?? []).join(", ")}>
                {a}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function HistoryView({ history, ds }: { history: Json[] | null | undefined; ds?: string }) {
  if (!history?.length) return <div className="text-xs text-slate-500">Không có history.</div>;
  return (
    <div className="space-y-1.5">
      {history.map((t: Json, i: number) =>
        t.role === "user" ? (
          <div key={i} className="rounded-md border border-slate-200 p-2 dark:border-slate-800">
            <div className="mb-0.5 text-[11px] font-semibold uppercase text-slate-500">Người dùng</div>
            <div className="text-sm">{t.audio_text ?? t.text ?? <span className="italic text-slate-400">(không có transcript)</span>}</div>
            {ds && t.audio && (
              <div className="mt-1">
                <AudioPlayer ds={ds} path={t.audio} />
              </div>
            )}
          </div>
        ) : (
          <div key={i} className="rounded-md border border-slate-200 bg-slate-50 p-2 dark:border-slate-800 dark:bg-white/[0.02]">
            <div className="mb-0.5 text-[11px] font-semibold uppercase text-slate-500">Trợ lý</div>
            {t.text && <div className="text-sm">{t.text}</div>}
            {t.tool_calls?.length > 0 && (
              <Collapsible title={`${t.tool_calls.length} tool call`} className="mt-1.5">
                <div className="space-y-1.5">
                  {t.tool_calls.map((c: Json, j: number) => (
                    <div key={j}>
                      <CallView call={c} />
                      {t.tool_results?.[j] !== undefined && <JsonView data={t.tool_results[j]} openDepth={0} className="mt-0.5" />}
                    </div>
                  ))}
                </div>
              </Collapsible>
            )}
          </div>
        ),
      )}
    </div>
  );
}

export function LabelView({ label }: { label: Json }) {
  if (label === null || label === undefined) return <div className="text-xs text-slate-500">Mẫu không có nhãn.</div>;
  const calls: Json[] = label.tool_calls ?? [];
  return (
    <div className="space-y-2">
      {calls.length === 0 ? (
        <div className="text-sm text-slate-500">[] — không gọi tool nào</div>
      ) : (
        <ol className="space-y-1">
          {calls.map((c, i) => (
            <li key={i} className="flex gap-2">
              <span className="font-mono text-xs text-slate-400">{i + 1}.</span>
              <CallView call={c} />
            </li>
          ))}
        </ol>
      )}
      {label.tool_results && (
        <Collapsible title="tool_results">
          <JsonView data={label.tool_results} openDepth={1} />
        </Collapsible>
      )}
      {label.final_state && (
        <Collapsible title="final_state">
          <JsonView data={label.final_state} openDepth={1} />
        </Collapsible>
      )}
    </div>
  );
}

export function AudioList({ ds, files }: { ds: string; files: string[] }) {
  if (!files.length) return null;
  return (
    <div className="space-y-1">
      {files.map((f) => (
        <AudioPlayer key={f} ds={ds} path={f} label={audioLabel(f)} />
      ))}
    </div>
  );
}
