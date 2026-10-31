import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Bot, Hand, Play, Power, RefreshCw, Send, User } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, Json, PgOpen, PgResp } from "../api";
import { JsonEditor } from "../components/CodeEditor";
import { CallView, JsonView } from "../components/JsonView";
import { MultiSelect } from "../components/MultiSelect";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, Checkbox, Collapsible, Empty, Field, Input, Notice, PageHeader, Select, Textarea, Toggle } from "../components/ui";
import { fmtCost } from "../lib/format";
import { useDatasets, useMeta, useModels, usePlugins } from "../lib/hooks";

const DEFAULT_GUARDS = ["validate_repair", "iso_time", "ask_params_order", "dedupe_reads", "ask_last"];
const same = (a: Json, b: Json) => JSON.stringify(a) === JSON.stringify(b);

function closeSession(id: string) {
  try {
    void fetch(`/api/playground/${encodeURIComponent(id)}`, { method: "DELETE", keepalive: true });
  } catch {
    /* bỏ qua */
  }
}

function Message({ m }: { m: Json }) {
  if (m.role === "user")
    return (
      <div className="flex gap-2">
        <User className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
        <div className="rounded-md bg-accent-50 px-2.5 py-1.5 text-sm dark:bg-accent-950/40">{typeof m.content === "string" ? m.content : JSON.stringify(m.content)}</div>
      </div>
    );
  if (m.role === "assistant")
    return (
      <div className="flex gap-2">
        <Bot className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
        <div className="min-w-0 space-y-1 rounded-md border border-slate-200 px-2.5 py-1.5 dark:border-slate-800">
          {m.content && <div className="whitespace-pre-wrap text-sm">{typeof m.content === "string" ? m.content : JSON.stringify(m.content)}</div>}
          {(m.tool_calls ?? []).map((c: Json, i: number) => (
            <CallView key={i} call={c} />
          ))}
        </div>
      </div>
    );
  if (m.role === "tool") {
    let parsed: Json = m.content;
    try {
      parsed = JSON.parse(m.content);
    } catch {
      /* giữ nguyên */
    }
    return (
      <div className="ml-6">
        <Collapsible title={<span className="font-mono text-xs">↳ {m.name}</span>} right={parsed?.ok === false ? <Badge color="red">ok=false</Badge> : undefined}>
          <JsonView data={parsed} openDepth={1} />
        </Collapsible>
      </div>
    );
  }
  return <JsonView data={m} />;
}

function PendingCall({ call, onRun }: { call: { id: string; name: string; arguments: Json }; onRun: (args: Json, guards: boolean) => Promise<void> }) {
  const [args, setArgs] = useState<Json>(call.arguments ?? {});
  const [guards, setGuards] = useState(true);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-1.5 rounded-md border border-amber-300 bg-amber-50/60 p-2 dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs font-semibold">{call.name}</span>
        <div className="flex items-center gap-2">
          <Checkbox checked={guards} onChange={setGuards} label={<span className="text-xs">qua guard</span>} />
          <Button
            size="xs"
            variant="primary"
            loading={busy}
            icon={<Play className="h-3 w-3" />}
            onClick={async () => {
              setBusy(true);
              await onRun(args, guards);
              setBusy(false);
            }}
          >
            Thực thi
          </Button>
        </div>
      </div>
      <JsonEditor value={args} onChange={setArgs} height="80px" />
    </div>
  );
}

export default function Playground() {
  const [sp] = useSearchParams();
  const toast = useToast();
  const datasets = useDatasets();
  const models = useModels();
  const plugins = usePlugins();
  const meta = useMeta();
  const [ds, setDs] = useState(sp.get("ds") ?? "train");
  const [sid, setSid] = useState(sp.get("sid") ?? "");
  const [search, setSearch] = useState("");
  const [llm, setLlm] = useState("");
  const [renderer, setRenderer] = useState("compact");
  const [rules, setRules] = useState("rules_v2");
  const [guards, setGuards] = useState<string[]>(DEFAULT_GUARDS);
  const [text, setText] = useState("");
  const [useText, setUseText] = useState(false);
  const [sess, setSess] = useState<PgOpen | null>(null);
  const [st, setSt] = useState<PgResp | null>(null);
  const [lastOut, setLastOut] = useState<Json>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [autoExec, setAutoExec] = useState(false);
  const [userMsg, setUserMsg] = useState("");
  const [manualTool, setManualTool] = useState("");
  const [manualArgs, setManualArgs] = useState<Json>({});
  const [manualGuards, setManualGuards] = useState(false);
  const [totalCost, setTotalCost] = useState(0);
  const sessRef = useRef<string | null>(null);

  useEffect(() => {
    const onUnload = () => sessRef.current && closeSession(sessRef.current);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      if (sessRef.current) closeSession(sessRef.current);
    };
  }, []);

  const samples = useQuery({
    queryKey: ["pg-samples", ds, search],
    queryFn: () => api.datasetSamples(ds, { filter: search ? { text: search } : {}, limit: 40 }),
    enabled: !!ds,
  });
  const sampleOpts = useMemo(() => {
    const rows = samples.data?.rows ?? [];
    const opts = rows.map((r) => ({ value: r.id, label: `${r.id} — ${(r.text ?? "(chỉ audio)").slice(0, 80)}` }));
    if (sid && !opts.find((o) => o.value === sid)) opts.unshift({ value: sid, label: sid });
    return opts;
  }, [samples.data, sid]);

  const open = async () => {
    if (!sid) return toast.error("Chọn mẫu trước");
    setBusy("open");
    try {
      if (sessRef.current) {
        await api.pgClose(sessRef.current).catch(() => undefined);
        sessRef.current = null;
      }
      const r = await api.pgOpen({
        dataset_id: ds,
        sample_id: sid,
        llm_model: llm || null,
        renderer,
        prompt: { plugin: "rules", rules },
        guards,
        text: useText ? text : null,
      });
      sessRef.current = r.session;
      setSess(r);
      setLastOut(null);
      setTotalCost(0);
      if (!useText) setText(r.text ?? "");
      const s = await api.pgCmd(r.session, { op: "state" });
      setSt(s);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const close = async () => {
    if (sessRef.current) await api.pgClose(sessRef.current).catch(() => undefined);
    sessRef.current = null;
    setSess(null);
    setSt(null);
  };
  const cmd = async (what: string, body: Json) => {
    if (!sess) return;
    setBusy(what);
    try {
      const r = await api.pgCmd(sess.session, body);
      setSt(r);
      const skip = new Set(["calls", "state", "messages", "pending", "state_hash", "ok"]);
      const rest = Object.fromEntries(Object.entries(r).filter(([k]) => !skip.has(k)));
      setLastOut(Object.keys(rest).length ? rest : null);
      if (typeof r.cost === "number") setTotalCost((x) => x + (r.cost ?? 0));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const tools = sess?.tools ?? [];
  const mt = tools.find((t) => t.name === manualTool);
  const label = sess?.label;
  const goldCalls: Json[] | null = label ? label.tool_calls ?? [] : null;
  const calls = st?.calls ?? [];
  const allMatch = goldCalls !== null && same(calls, goldCalls);
  const messages = st?.messages ?? sess?.messages ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="Playground" subtitle="Chạy từng bước agent trên một mẫu: model đề xuất call, bạn sửa / thực thi / tự gọi tool, so với nhãn." />
      <Card
        title="Thiết lập phiên"
        actions={
          sess ? (
            <Button size="xs" variant="danger" icon={<Power className="h-3.5 w-3.5" />} onClick={close}>
              Đóng phiên
            </Button>
          ) : null
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Dataset">
            <Select value={ds} onChange={(v) => (setDs(v), setSid(""))} options={(datasets.data ?? []).map((d) => ({ value: d.id, label: `${d.id} (${d.n})` }))} />
          </Field>
          <Field label="Tìm mẫu (văn bản / ID)">
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="vd: báo thức" />
          </Field>
          <Field label="Mẫu" className="xl:col-span-2">
            <Select value={sid} onChange={setSid} placeholder="Chọn mẫu…" options={sampleOpts} />
          </Field>
          <Field label="Model LLM (tuỳ chọn)" hint="Trống = chỉ gọi tool thủ công">
            <Select
              value={llm}
              onChange={setLlm}
              placeholder="(không dùng LLM)"
              options={(models.data ?? []).filter((m) => m.role === "llm").map((m) => ({ value: m.id, label: `${m.id}${m.ready ? " (chưa sẵn sàng)" : ""}` }))}
            />
          </Field>
          <Field label="Renderer">
            <Select value={renderer} onChange={setRenderer} options={(plugins.data?.renderer ?? []).map((p) => p.name)} />
          </Field>
          <Field label="Bộ luật">
            <Select value={rules} onChange={setRules} options={meta.data?.rules ?? ["rules_v2"]} />
          </Field>
          <Field label="Guard">
            <MultiSelect ordered value={guards} onChange={setGuards} options={(plugins.data?.guard ?? []).map((p) => ({ value: p.name, hint: p.description }))} />
          </Field>
          <Field label="Ghi đè câu yêu cầu cuối" className="md:col-span-2 xl:col-span-3">
            <div className="flex items-start gap-2">
              <Toggle checked={useText} onChange={setUseText} />
              <Textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} disabled={!useText} placeholder="Để trống ghi đè để dùng transcript gốc" />
            </div>
          </Field>
          <div className="flex items-end">
            <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={open} loading={busy === "open"} disabled={!sid}>
              {sess ? "Mở lại phiên" : "Mở phiên"}
            </Button>
          </div>
        </div>
      </Card>

      {!sess ? (
        <Empty>Chọn mẫu rồi bấm “Mở phiên”. Phiên chạy trong tiến trình riêng và tự đóng khi rời trang.</Empty>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <Card
              title="Hội thoại"
              subtitle={
                <span>
                  phiên <span className="font-mono">{sess.session}</span> · chi phí {fmtCost(totalCost)}
                </span>
              }
              actions={
                <>
                  <Toggle checked={autoExec} onChange={setAutoExec} label={<span className="text-xs">tự thực thi</span>} />
                  <Button size="xs" variant="primary" icon={<Bot className="h-3.5 w-3.5" />} loading={busy === "llm"} disabled={!llm} onClick={() => cmd("llm", { op: "llm_step", auto_execute: autoExec })}>
                    LLM bước tiếp
                  </Button>
                  <Button size="xs" icon={<RefreshCw className="h-3.5 w-3.5" />} loading={busy === "state"} onClick={() => cmd("state", { op: "state" })}>
                    Làm mới
                  </Button>
                </>
              }
            >
              <div className="space-y-3">
                <Collapsible title={`System prompt (${sess.system.length} ký tự)`}>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs">{sess.system}</pre>
                </Collapsible>
                <div className="space-y-2">
                  {messages.map((m, i) => (
                    <Message key={i} m={m} />
                  ))}
                </div>
                {(st?.pending ?? []).length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold uppercase text-amber-700 dark:text-amber-400">Call đang chờ thực thi</div>
                    {st!.pending.map((c, i) => (
                      <PendingCall key={c.id} call={c} onRun={(args, g) => cmd("exec", { op: "execute", index: i, arguments: args, guards: g })} />
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <Input value={userMsg} onChange={(e) => setUserMsg(e.target.value)} placeholder="Thêm lượt người dùng…" onKeyDown={(e) => e.key === "Enter" && userMsg && (cmd("user", { op: "user", text: userMsg }), setUserMsg(""))} />
                  <Button
                    icon={<Send className="h-4 w-4" />}
                    disabled={!userMsg}
                    loading={busy === "user"}
                    onClick={() => {
                      cmd("user", { op: "user", text: userMsg });
                      setUserMsg("");
                    }}
                  >
                    Gửi
                  </Button>
                </div>
                {lastOut && (
                  <Collapsible title="Phản hồi lệnh gần nhất" defaultOpen>
                    <JsonView data={lastOut} openDepth={2} />
                  </Collapsible>
                )}
              </div>
            </Card>
            <Card title="Gọi tool thủ công">
              <div className="space-y-2">
                <Select
                  value={manualTool}
                  onChange={(v) => {
                    setManualTool(v);
                    setManualArgs({});
                  }}
                  placeholder="Chọn tool…"
                  options={tools.map((t) => ({ value: t.name, label: `${t.name}  (${t.api_name})` }))}
                />
                {mt && (
                  <>
                    <div className="text-xs text-slate-600 dark:text-slate-300">{mt.description}</div>
                    <Collapsible title="Schema tham số" defaultOpen>
                      <JsonView data={mt.parameters} openDepth={3} />
                    </Collapsible>
                    <JsonEditor value={manualArgs} onChange={setManualArgs} height="100px" />
                    <div className="flex items-center justify-end gap-2">
                      <Checkbox checked={manualGuards} onChange={setManualGuards} label={<span className="text-xs">qua guard</span>} />
                      <Button variant="primary" size="sm" icon={<Hand className="h-3.5 w-3.5" />} loading={busy === "manual"} onClick={() => cmd("manual", { op: "manual", name: manualTool, arguments: manualArgs ?? {}, guards: manualGuards })}>
                        Gọi
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          </div>
          <div className="space-y-4">
            <Card
              title="Call đã thực thi so với nhãn"
              actions={goldCalls !== null ? allMatch ? <Badge color="green">khớp nhãn</Badge> : <Badge color="yellow">chưa khớp</Badge> : <Badge>không có nhãn</Badge>}
            >
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Đã thực thi ({calls.length})</div>
                  {calls.length === 0 ? (
                    <div className="text-xs text-slate-500">Chưa có call nào.</div>
                  ) : (
                    <ol className="space-y-1">
                      {calls.map((c, i) => (
                        <li
                          key={i}
                          className={clsx(
                            "rounded border p-1.5",
                            goldCalls === null
                              ? "border-slate-200 dark:border-slate-800"
                              : goldCalls.some((g) => same(g, c))
                                ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30"
                                : "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30",
                          )}
                        >
                          <CallView call={c} />
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Nhãn ({goldCalls?.length ?? "—"})</div>
                  {goldCalls === null ? (
                    <div className="text-xs text-slate-500">Mẫu không có nhãn.</div>
                  ) : goldCalls.length === 0 ? (
                    <div className="text-xs text-slate-500">[] — không gọi tool</div>
                  ) : (
                    <ol className="space-y-1">
                      {goldCalls.map((c, i) => (
                        <li
                          key={i}
                          className={clsx(
                            "rounded border p-1.5",
                            calls.some((x) => same(x, c)) ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/30" : "border-slate-200 dark:border-slate-800",
                          )}
                        >
                          <CallView call={c} />
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
              {goldCalls !== null && (
                <Notice className="mt-3 text-xs" color={allMatch ? "green" : "blue"}>
                  So khớp ở đây là so sánh chính xác (tên + tham số, đúng thứ tự). Điểm chính thức còn dùng fuzzy cho văn bản tự do và state hash.
                </Notice>
              )}
            </Card>
            <Card title="State hiện tại" subtitle={st ? <span className="break-all font-mono text-[11px]">hash {st.state_hash}</span> : undefined}>
              {st ? <JsonView data={st.state} openDepth={1} maxH="560px" /> : <div className="text-xs text-slate-500">Đang tải…</div>}
            </Card>
            <Collapsible title={`Tool có trong phiên (${tools.length})`}>
              <div className="flex flex-wrap gap-1">
                {tools.map((t) => (
                  <code key={t.name} className="rounded bg-slate-100 px-1 font-mono text-[11px] dark:bg-slate-800" title={t.description}>
                    {t.name}
                  </code>
                ))}
              </div>
            </Collapsible>
          </div>
        </div>
      )}
    </div>
  );
}
