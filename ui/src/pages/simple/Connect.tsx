/* Kết nối model: một form duy nhất (loại dịch vụ + địa chỉ + khoá + tên model) thay cho hai bảng nhà cung cấp / model. */
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, Pencil, Plug, Plus, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, type Model, type Provider } from "../../api";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, Collapsible, Empty, Field, Input, Loading, Modal, Notice, NumberInput, PageHeader, Textarea, Toggle } from "../../components/ui";
import { ROLE_FRIENDLY } from "../../lib/friendly";
import { useModels, useProviders } from "../../lib/hooks";

type ServiceId = "own" | "own_anthropic" | "anthropic" | "openai" | "gemini" | "openrouter";

const SERVICES: { id: ServiceId; label: string; hint: string; provider?: string; kind: string }[] = [
  { id: "own", label: "Server của tôi", hint: "vLLM, llama.cpp, server ASR/TTS… dạng OpenAI-compatible", kind: "openai_compat" },
  { id: "anthropic", label: "Claude (Anthropic)", hint: "api.anthropic.com", provider: "anthropic", kind: "anthropic" },
  { id: "openai", label: "OpenAI", hint: "api.openai.com", provider: "openai", kind: "openai_compat" },
  { id: "gemini", label: "Gemini (Google)", hint: "qua endpoint OpenAI-compatible", provider: "gemini", kind: "openai_compat" },
  { id: "openrouter", label: "OpenRouter", hint: "openrouter.ai", provider: "openrouter", kind: "openai_compat" },
  { id: "own_anthropic", label: "Server của tôi (kiểu Anthropic)", hint: "server tương thích Messages API của Anthropic", kind: "anthropic" },
];

const BUILTIN = new Set(["oracle", "gold-asr"]);

function slug(s: string): string {
  return (
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 50) || "model"
  );
}

function providerIdForUrl(url: string, kind: string): string {
  const s = url.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  return `${kind === "anthropic" ? "my_anthropic" : "my"}_${slug(s).replace(/[.-]/g, "_")}`;
}

interface FormState {
  editingId: string | null;
  service: ServiceId;
  role: "llm" | "asr" | "tts";
  baseUrl: string;
  key: string;
  modelName: string;
  displayName: string;
  priceIn: number | null;
  priceOut: number | null;
  priceAudio: number | null;
  priceChars: number | null;
  nParams: number | null;
  submitOk: boolean;
  extra: string;
}

const EMPTY: FormState = {
  editingId: null,
  service: "own",
  role: "llm",
  baseUrl: "",
  key: "",
  modelName: "",
  displayName: "",
  priceIn: null,
  priceOut: null,
  priceAudio: null,
  priceChars: null,
  nParams: null,
  submitOk: false,
  extra: "",
};

function fromModel(m: Model, providers: Provider[]): FormState {
  const p = providers.find((x) => x.id === m.provider_id);
  const svc = SERVICES.find((s) => s.provider === m.provider_id)?.id ?? (p?.kind === "anthropic" ? "own_anthropic" : "own");
  const { model, ...rest } = (m.config ?? {}) as Record<string, unknown>;
  return {
    editingId: m.id,
    service: svc,
    role: m.role,
    baseUrl: p?.base_url ?? "",
    key: "",
    modelName: String(model ?? ""),
    displayName: m.name ?? m.id,
    priceIn: m.price?.input ?? null,
    priceOut: m.price?.output ?? null,
    priceAudio: m.price?.audio_min ?? null,
    priceChars: m.price?.chars_1k ?? null,
    nParams: m.n_params_b,
    submitOk: !!m.submit_ok,
    extra: Object.keys(rest).length ? JSON.stringify(rest, null, 2) : "",
  };
}

function ConnectForm({ init, providers, models, onClose }: { init: FormState; providers: Provider[]; models: Model[]; onClose: () => void }) {
  const [f, setF] = useState<FormState>(init);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const toast = useToast();
  const qc = useQueryClient();
  const svc = SERVICES.find((s) => s.id === f.service)!;
  const own = f.service === "own" || f.service === "own_anthropic";
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((x) => ({ ...x, [k]: v }));
  const existingProvider = svc.provider ? providers.find((p) => p.id === svc.provider) : undefined;

  const save = async () => {
    setResult(null);
    if (!f.modelName.trim()) return toast.error("Hãy nhập tên model");
    if (own && !/^https?:\/\//.test(f.baseUrl.trim())) return toast.error("Địa chỉ server phải bắt đầu bằng http:// hoặc https://");
    let extra: Record<string, unknown> = {};
    if (f.extra.trim()) {
      try {
        extra = JSON.parse(f.extra);
      } catch {
        return toast.error("Tham số thêm phải là JSON hợp lệ");
      }
    }
    setBusy(true);
    try {
      let providerId = svc.provider as string;
      if (own) {
        providerId = providerIdForUrl(f.baseUrl.trim(), svc.kind);
        await api.saveProvider({ id: providerId, kind: svc.kind, base_url: f.baseUrl.trim(), api_key_env: null, notes: "Server của tôi" });
      }
      if (f.key.trim()) await api.setKey(providerId, f.key.trim());
      const display = f.displayName.trim() || f.modelName.trim();
      let id = f.editingId ?? slug(display);
      if (!f.editingId) {
        let k = 2;
        const base = id;
        while (models.some((m) => m.id === id)) id = `${base}-${k++}`;
      }
      const price: Record<string, number> = {};
      if (f.priceIn != null) price.input = f.priceIn;
      if (f.priceOut != null) price.output = f.priceOut;
      if (f.priceAudio != null) price.audio_min = f.priceAudio;
      if (f.priceChars != null) price.chars_1k = f.priceChars;
      const old = models.find((m) => m.id === id);
      await api.saveModel({
        ...(old ?? {}),
        id,
        name: display,
        role: f.role,
        provider_id: providerId,
        plugin: null,
        config: { ...extra, model: f.modelName.trim() },
        price,
        n_params_b: f.nParams,
        submit_ok: f.submitOk,
        source: own ? "server" : "api",
      });
      qc.invalidateQueries({ queryKey: ["models"] });
      qc.invalidateQueries({ queryKey: ["providers"] });
      try {
        const r = (await api.testModel(id)) as Record<string, unknown>;
        const out = (r.text as string) || (r.tool_calls ? JSON.stringify(r.tool_calls) : "") || (r.bytes ? `${r.bytes} byte audio` : "") || "OK";
        setResult({ ok: r.ok !== false, msg: `Kết nối được (${r.latency_s ?? "?"} giây). Phản hồi: ${String(out).slice(0, 200)}` });
        toast.success("Đã lưu và kiểm tra kết nối thành công");
      } catch (e) {
        setResult({ ok: false, msg: errorMessage(e) });
      }
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Field label="1. Model chạy ở đâu?">
        <div className="grid gap-2 sm:grid-cols-2">
          {SERVICES.map((s) => {
            // Anthropic chỉ có API cho LLM: không dùng được cho nhận dạng giọng nói / đọc văn bản
            const off = s.kind === "anthropic" && f.role !== "llm";
            return (
              <button
                key={s.id}
                type="button"
                disabled={off}
                title={off ? "Anthropic không có API nhận dạng giọng nói / đọc văn bản" : undefined}
                onClick={() => set("service", s.id)}
                className={clsx(
                  "rounded-md border p-2.5 text-left transition-colors",
                  off && "cursor-not-allowed opacity-40",
                  f.service === s.id
                    ? "border-accent-500 bg-accent-50 dark:border-accent-500 dark:bg-accent-950/30"
                    : "border-slate-200 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-white/5",
                )}
              >
                <div className="text-sm font-medium">{s.label}</div>
                <div className="muted text-xs">{off ? "Chỉ dùng cho LLM" : s.hint}</div>
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="2. Model dùng để làm gì?">
        <div className="flex flex-wrap gap-2">
          {(["llm", "asr", "tts"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                set("role", r);
                // đổi sang ASR/TTS khi đang chọn dịch vụ kiểu Anthropic -> chuyển về "Server của tôi" (OpenAI-compatible)
                if (r !== "llm" && SERVICES.find((x) => x.id === f.service)?.kind === "anthropic") set("service", "own");
              }}
              className={clsx(
                "rounded-md border px-3 py-1.5 text-sm",
                f.role === r ? "border-accent-500 bg-accent-50 font-medium dark:bg-accent-950/30" : "border-slate-200 dark:border-slate-700",
              )}
            >
              {ROLE_FRIENDLY[r]}
            </button>
          ))}
        </div>
      </Field>
      {own && (
        <Field label="3. Địa chỉ server" hint="Ví dụ http://10.0.0.5:8000/v1 (vLLM) hoặc http://10.0.0.5:9000/v1 (server ASR)">
          <Input value={f.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} placeholder="http://<địa chỉ máy>:<cổng>/v1" />
        </Field>
      )}
      <Field
        label={`${own ? "4" : "3"}. Khoá API ${own ? "(nếu server có yêu cầu)" : ""}`}
        hint={
          own
            ? "Bỏ trống nếu server không cần khoá."
            : existingProvider?.key_status && existingProvider.key_status !== "chưa có"
              ? `Đã có khoá (${existingProvider.key_status}). Bỏ trống để giữ nguyên. Khoá dùng chung cho mọi model của ${svc.label}.`
              : `Khoá dùng chung cho mọi model của ${svc.label}. Được lưu riêng trên máy, không ghi vào cấu hình hay log.`
        }
      >
        <Input type="password" value={f.key} onChange={(e) => set("key", e.target.value)} placeholder={own ? "(không bắt buộc)" : "sk-…"} autoComplete="off" />
      </Field>
      <Field label={`${own ? "5" : "4"}. Tên model`} hint="Đúng tên mà server đang phục vụ, ví dụ lifemate-llm, claude-opus-5-5, whisper-1…">
        <Input value={f.modelName} onChange={(e) => set("modelName", e.target.value)} placeholder="tên model" />
      </Field>
      <Field label="Tên hiển thị (tuỳ chọn)">
        <Input value={f.displayName} onChange={(e) => set("displayName", e.target.value)} placeholder={f.modelName || "vd: Qwen 4B bản SFT v1"} />
      </Field>
      <Collapsible title="Nâng cao (không bắt buộc): giá, tham số, thông tin nộp bài">
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {f.role === "llm" && (
              <>
                <Field label="Giá đầu vào (USD / 1 triệu token)">
                  <NumberInput value={f.priceIn} onChange={(v) => set("priceIn", v)} step={0.01} />
                </Field>
                <Field label="Giá đầu ra (USD / 1 triệu token)">
                  <NumberInput value={f.priceOut} onChange={(v) => set("priceOut", v)} step={0.01} />
                </Field>
              </>
            )}
            {f.role === "asr" && (
              <Field label="Giá (USD / phút audio)">
                <NumberInput value={f.priceAudio} onChange={(v) => set("priceAudio", v)} step={0.001} />
              </Field>
            )}
            {f.role === "tts" && (
              <Field label="Giá (USD / 1000 ký tự)">
                <NumberInput value={f.priceChars} onChange={(v) => set("priceChars", v)} step={0.001} />
              </Field>
            )}
            <Field label="Số tham số (tỉ)" hint="Để kiểm tra luật thi: LLM < 5B, tổng < 6B">
              <NumberInput value={f.nParams} onChange={(v) => set("nParams", v)} step={0.1} />
            </Field>
          </div>
          <Toggle checked={f.submitOk} onChange={(v) => set("submitOk", v)} label="Model này sẽ nằm trong bài nộp (chạy offline)" />
          <Field label="Tham số thêm (JSON)" hint='Ví dụ {"temperature": 0, "max_tokens": 1024} hoặc với Claude {"effort": "low"}'>
            <Textarea rows={3} value={f.extra} onChange={(e) => set("extra", e.target.value)} className="font-mono text-xs" placeholder="{}" />
          </Field>
        </div>
      </Collapsible>
      {result && <Notice color={result.ok ? "green" : "red"}>{result.ok ? "✓ " : "✗ "}{result.msg}</Notice>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>{result?.ok ? "Đóng" : "Huỷ"}</Button>
        <Button variant="primary" icon={<Plug className="h-4 w-4" />} loading={busy} onClick={save}>
          Lưu & kiểm tra kết nối
        </Button>
      </div>
    </div>
  );
}

export default function Connect() {
  const models = useModels();
  const providers = useProviders();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, { ok: boolean; msg: string }>>({});

  if (models.isLoading || providers.isLoading) return <Loading />;
  const list = (models.data ?? []).filter((m) => !BUILTIN.has(m.id));
  const provs = providers.data ?? [];

  const test = async (m: Model) => {
    setTesting(m.id);
    try {
      const r = (await api.testModel(m.id)) as Record<string, unknown>;
      setTested((x) => ({ ...x, [m.id]: { ok: r.ok !== false, msg: `Kết nối được (${r.latency_s ?? "?"} giây)` } }));
    } catch (e) {
      setTested((x) => ({ ...x, [m.id]: { ok: false, msg: errorMessage(e) } }));
    } finally {
      setTesting(null);
    }
  };
  const remove = async (m: Model) => {
    if (!confirm(`Xoá kết nối ${m.name || m.id}?`)) return;
    try {
      await api.deleteModel(m.id);
      qc.invalidateQueries({ queryKey: ["models"] });
    } catch (e) {
      toast.error(e);
    }
  };
  const where = (m: Model) => {
    const p = provs.find((x) => x.id === m.provider_id);
    const svc = SERVICES.find((s) => s.provider === m.provider_id);
    return svc ? svc.label : p?.base_url ?? m.provider_id;
  };

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Kết nối model"
        subtitle="Khai báo các model bạn đang phục vụ (LLM, nhận dạng giọng nói, đọc văn bản). Platform sẽ gọi chúng qua API."
        actions={
          <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setForm({ ...EMPTY })}>
            Thêm kết nối
          </Button>
        }
      />
      {list.length === 0 ? (
        <Empty>
          <div className="space-y-2">
            <div>Chưa có model nào. Bấm <b>Thêm kết nối</b> để khai báo model đầu tiên.</div>
            <div className="text-xs">Bạn cần ít nhất một model ngôn ngữ (LLM) để chạy đánh giá.</div>
          </div>
        </Empty>
      ) : (
        <div className="space-y-2">
          {list.map((m) => {
            const t = tested[m.id];
            return (
              <Card key={m.id} bodyClass="p-3">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{m.name || m.id}</span>
                      <Badge color={m.role === "llm" ? "blue" : m.role === "asr" ? "purple" : "orange"}>{ROLE_FRIENDLY[m.role]}</Badge>
                      {m.ready ? <Badge color="red">chưa sẵn sàng</Badge> : <Badge color="green">sẵn sàng</Badge>}
                    </div>
                    <div className="muted mt-0.5 text-xs">
                      {where(m)} · model <span className="font-mono">{String(m.config?.model ?? "")}</span>
                    </div>
                    {m.ready && <div className="mt-1 text-xs text-red-600 dark:text-red-400">{m.ready}</div>}
                    {t && (
                      <div className={clsx("mt-1 flex items-center gap-1 text-xs", t.ok ? "text-emerald-600" : "text-red-600 dark:text-red-400")}>
                        {t.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />} {t.msg}
                      </div>
                    )}
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" loading={testing === m.id} onClick={() => test(m)}>
                      Kiểm tra
                    </Button>
                    <Button size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setForm(fromModel(m, provs))}>
                      Sửa
                    </Button>
                    <Button size="sm" variant="danger" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => remove(m)} aria-label="Xoá" />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
      {list.length > 0 && (
        <div className="mt-4 text-sm">
          Đã có model? <Link className="text-accent-600 hover:underline" to="/evaluate">Chạy đánh giá →</Link>
        </div>
      )}
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.editingId ? "Sửa kết nối" : "Thêm kết nối"} width="max-w-2xl">
        {form && <ConnectForm init={form} providers={provs} models={models.data ?? []} onClose={() => setForm(null)} />}
      </Modal>
    </div>
  );
}
