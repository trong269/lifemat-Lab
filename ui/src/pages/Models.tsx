import { useQueryClient } from "@tanstack/react-query";
import { BarChart3, KeyRound, Pencil, Plus, Stethoscope, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, Dict, Json, Model, Provider } from "../api";
import { JsonEditor } from "../components/CodeEditor";
import { JsonView } from "../components/JsonView";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, NumberInput, PageHeader, Select, Textarea } from "../components/ui";
import { fmtCost, fmtSec } from "../lib/format";
import { useMeta, useModels, usePlugins, useProviders } from "../lib/hooks";

const PLUGIN_BY_ROLE: Record<string, string> = {
  "llm|anthropic": "anthropic",
  "llm|openai_compat": "openai_compat",
  "asr|openai_compat": "openai_asr",
  "tts|openai_compat": "openai_tts",
};
const HIDDEN_PARAMS = new Set(["api_key", "api_key_env", "base_url", "model"]);

// ---------------- providers ----------------
function ProviderModal({ init, onClose }: { init: Partial<Provider> | null; onClose: () => void }) {
  const [p, setP] = useState<Partial<Provider>>(init ?? {});
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = !init?.id;
  const save = async () => {
    setBusy(true);
    try {
      await api.saveProvider({ id: p.id, kind: p.kind ?? "openai_compat", base_url: p.base_url || null, api_key_env: p.api_key_env || null, notes: p.notes ?? "" });
      toast.success("Đã lưu nhà cung cấp");
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["models"] });
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? "Thêm nhà cung cấp" : `Sửa nhà cung cấp ${init?.id}`}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" loading={busy} onClick={save} disabled={!p.id}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="ID">
          <Input value={p.id ?? ""} disabled={!isNew} onChange={(e) => setP({ ...p, id: e.target.value.trim() })} placeholder="vd: together" />
        </Field>
        <Field label="Loại (kind)">
          <Select value={p.kind ?? "openai_compat"} onChange={(v) => setP({ ...p, kind: v })} options={["openai_compat", "anthropic"]} />
        </Field>
        <Field label="Base URL" hint="Trống = endpoint mặc định của SDK" className="sm:col-span-2">
          <Input value={p.base_url ?? ""} onChange={(e) => setP({ ...p, base_url: e.target.value })} placeholder="https://…/v1" />
        </Field>
        <Field label="Biến môi trường chứa khoá (api_key_env)" hint="Trống + có base_url = server tự host không cần khoá" className="sm:col-span-2">
          <Input value={p.api_key_env ?? ""} onChange={(e) => setP({ ...p, api_key_env: e.target.value })} placeholder="OPENAI_API_KEY" />
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          <Input value={p.notes ?? ""} onChange={(e) => setP({ ...p, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function KeyModal({ provider, onClose }: { provider: Provider; onClose: () => void }) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const save = async (k: string) => {
    setBusy(true);
    try {
      const r = await api.setKey(provider.id, k);
      toast.success(`Khoá ${provider.id}: ${r.key_status}`);
      qc.invalidateQueries({ queryKey: ["providers"] });
      qc.invalidateQueries({ queryKey: ["models"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Khoá API — ${provider.id}`}
      width="max-w-md"
      footer={
        <>
          <Button variant="danger" onClick={() => save("")} loading={busy}>
            Xoá khoá đã lưu
          </Button>
          <Button variant="primary" onClick={() => save(key)} loading={busy} disabled={!key.trim()}>
            Lưu khoá
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="text-sm">
          Trạng thái hiện tại: <Badge color={provider.key_status === "chưa có" ? "yellow" : "green"}>{provider.key_status}</Badge>
        </div>
        <Field label="Khoá API" hint="Khoá được lưu ở lab_data/secrets.json (quyền 600), không bao giờ ghi vào cấu hình, trace hay log.">
          <Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

// ---------------- models ----------------
const EMPTY_MODEL: Dict = {
  id: "",
  name: "",
  role: "llm",
  provider_id: "",
  plugin: "",
  config: { model: "" },
  price: {},
  n_params_b: null,
  context_len: null,
  release_date: "",
  license: "",
  submit_ok: false,
  source: "api",
  base_model: "",
  train_dataset: "",
  train_script: "",
  notes: "",
};

function ModelModal({ init, onClose, providers }: { init: Model | null; onClose: () => void; providers: Provider[] }) {
  const meta = useMeta();
  const plugins = usePlugins();
  const [m, setM] = useState<Dict>(() => (init ? { ...init, submit_ok: !!init.submit_ok, plugin: init.plugin ?? "" } : { ...EMPTY_MODEL, provider_id: providers[0]?.id ?? "" }));
  const [cfgOk, setCfgOk] = useState(true);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  const isNew = !init;
  const prov = providers.find((p) => p.id === m.provider_id);
  const effPlugin: string = m.plugin || PLUGIN_BY_ROLE[`${m.role}|${prov?.kind}`] || "";
  const pluginList = plugins.data?.[m.role as string] ?? [];
  const pinfo = pluginList.find((p) => p.name === effPlugin);
  const params = Object.entries((pinfo?.schema?.properties ?? {}) as Dict).filter(([k]) => !HIDDEN_PARAMS.has(k));
  const set = (k: string, v: Json) => setM((x) => ({ ...x, [k]: v }));

  const insertDefaults = () => {
    const cfg = { ...(m.config ?? {}) };
    for (const [k, s] of params) if (!(k in cfg) && s && "default" in s && !s.secret) cfg[k] = s.default;
    set("config", cfg);
  };

  const save = async () => {
    const cfg = m.config ?? {};
    if (cfg && typeof cfg === "object" && "api_key" in cfg) {
      toast.error("Không lưu khoá API trong config — nhập ở mục Khoá API của nhà cung cấp");
      return;
    }
    if (prov?.kind !== "builtin" && !cfg.model) {
      toast.error("config phải có trường \"model\" (tên model phía nhà cung cấp)");
      return;
    }
    const price: Dict<number> = {};
    for (const [k, v] of Object.entries(m.price ?? {})) if (v !== null && v !== undefined && v !== "") price[k] = Number(v);
    setBusy(true);
    try {
      await api.saveModel({ ...m, price, config: cfg, plugin: m.plugin || null });
      toast.success("Đã lưu model");
      qc.invalidateQueries({ queryKey: ["models"] });
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width="max-w-4xl"
      title={isNew ? "Thêm model" : `Sửa model ${init?.id}`}
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" onClick={save} loading={busy} disabled={!m.id || !cfgOk}>
            Lưu
          </Button>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="ID">
              <Input value={m.id} disabled={!isNew} onChange={(e) => set("id", e.target.value.trim())} placeholder="vd: claude-sonnet" />
            </Field>
            <Field label="Tên hiển thị">
              <Input value={m.name ?? ""} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="Vai trò">
              <Select value={m.role} onChange={(v) => set("role", v)} options={[{ value: "llm", label: "LLM" }, { value: "asr", label: "ASR" }, { value: "tts", label: "TTS" }]} />
            </Field>
            <Field label="Nhà cung cấp">
              <Select value={m.provider_id} onChange={(v) => set("provider_id", v)} options={providers.map((p) => ({ value: p.id, label: `${p.id} (${p.kind})` }))} />
            </Field>
            <Field label="Plugin" hint={`Trống = tự chọn theo loại nhà cung cấp${effPlugin ? ` → ${effPlugin}` : ""}`} className="col-span-2">
              <Select value={m.plugin ?? ""} onChange={(v) => set("plugin", v)} placeholder="(tự động)" options={pluginList.map((p) => ({ value: p.name, label: `${p.name} — ${p.description}` }))} />
            </Field>
          </div>
          <Field label="Cấu hình (config, JSON)" hint='Phải có "model". Không đưa khoá API vào đây.'>
            <JsonEditor value={m.config} onChange={(v) => set("config", v ?? {})} onValidity={setCfgOk} height="150px" />
          </Field>
          {params.length > 0 && (
            <div className="rounded-md border border-slate-200 p-2.5 text-xs dark:border-slate-800">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="font-medium">Tham số của plugin {effPlugin}</span>
                <Button size="xs" onClick={insertDefaults}>
                  Chèn giá trị mặc định
                </Button>
              </div>
              <ul className="space-y-0.5">
                {params.map(([k, s]) => (
                  <li key={k}>
                    <code className="font-mono text-accent-700 dark:text-accent-300">{k}</code>
                    {s?.default !== undefined && <span className="text-slate-500"> = {JSON.stringify(s.default)}</span>}
                    {s?.description && <span className="text-slate-500"> — {s.description}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Field label="Ghi chú">
            <Textarea rows={2} value={m.notes ?? ""} onChange={(e) => set("notes", e.target.value)} />
          </Field>
        </div>
        <div className="space-y-3">
          <div>
            <div className="label">Giá (USD)</div>
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(meta.data?.price_fields ?? {}).map(([k, lbl]) => (
                <Field key={k} label={<span title={lbl}>{k} <span className="font-normal text-slate-400">({lbl})</span></span>}>
                  <NumberInput value={m.price?.[k] ?? null} onChange={(v) => set("price", { ...(m.price ?? {}), [k]: v })} />
                </Field>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Số tham số (tỷ, n_params_b)">
              <NumberInput value={m.n_params_b} onChange={(v) => set("n_params_b", v)} />
            </Field>
            <Field label="Context (token)">
              <NumberInput value={m.context_len} onChange={(v) => set("context_len", v === null ? null : Math.round(v))} step={1} />
            </Field>
            <Field label="Ngày phát hành">
              <Input type="date" value={m.release_date ?? ""} onChange={(e) => set("release_date", e.target.value)} />
            </Field>
            <Field label="Giấy phép">
              <Input value={m.license ?? ""} onChange={(e) => set("license", e.target.value)} />
            </Field>
            <Field label="Nguồn (source)">
              <Select value={m.source ?? "api"} onChange={(v) => set("source", v)} options={["api", "self_hosted", "self_trained", "builtin"]} />
            </Field>
            <div className="flex items-end pb-1.5">
              <Checkbox checked={!!m.submit_ok} onChange={(v) => set("submit_ok", v)} label="Dùng được khi nộp (offline)" />
            </div>
          </div>
          <div className="rounded-md border border-slate-200 p-2.5 dark:border-slate-800">
            <div className="label">Checkpoint tự huấn luyện (tuỳ chọn)</div>
            <div className="grid gap-2">
              <Input placeholder="base_model" value={m.base_model ?? ""} onChange={(e) => set("base_model", e.target.value)} />
              <Input placeholder="train_dataset (ID bản xuất)" value={m.train_dataset ?? ""} onChange={(e) => set("train_dataset", e.target.value)} />
              <Input placeholder="train_script" value={m.train_script ?? ""} onChange={(e) => set("train_script", e.target.value)} />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function TestResult({ data }: { data: Json }) {
  return (
    <div className="space-y-2 text-sm">
      <div className="flex flex-wrap gap-3">
        <Badge color={data.ok === false ? "red" : "green"}>{data.ok === false ? "lỗi" : "thành công"}</Badge>
        {data.latency_s !== undefined && <span>Độ trễ: {fmtSec(data.latency_s)}</span>}
        {data.cost !== undefined && <span>Chi phí: {fmtCost(data.cost)}</span>}
        {data.bytes !== undefined && <span>{data.bytes} byte audio</span>}
      </div>
      {data.output && <div>{data.output}</div>}
      {data.text && (
        <div>
          <div className="label">Văn bản</div>
          <div className="rounded bg-slate-50 p-2 dark:bg-black/20">{data.text}</div>
        </div>
      )}
      {data.error && <ErrorBox error={data.error} />}
      <JsonView data={data} openDepth={1} />
    </div>
  );
}

export default function Models() {
  const providers = useProviders();
  const models = useModels();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const [editProv, setEditProv] = useState<Partial<Provider> | null | undefined>(undefined);
  const [keyProv, setKeyProv] = useState<Provider | null>(null);
  const [editModel, setEditModel] = useState<Model | null | undefined>(undefined);
  const [testing, setTesting] = useState<string | null>(null);
  const [testRes, setTestRes] = useState<{ id: string; data: Json } | null>(null);
  const [roleFilter, setRoleFilter] = useState("");

  const delProv = async (id: string) => {
    if (!confirm(`Xoá nhà cung cấp ${id}?`)) return;
    try {
      await api.deleteProvider(id);
      toast.success("Đã xoá");
      qc.invalidateQueries({ queryKey: ["providers"] });
    } catch (e) {
      toast.error(e);
    }
  };
  const delModel = async (id: string) => {
    if (!confirm(`Xoá model ${id}?`)) return;
    try {
      await api.deleteModel(id);
      toast.success("Đã xoá");
      qc.invalidateQueries({ queryKey: ["models"] });
    } catch (e) {
      toast.error(e);
    }
  };
  const test = async (id: string) => {
    setTesting(id);
    try {
      setTestRes({ id, data: await api.testModel(id) });
    } catch (e) {
      toast.error(e);
    } finally {
      setTesting(null);
    }
  };
  const rows = useMemo(() => (models.data ?? []).filter((m) => !roleFilter || m.role === roleFilter), [models.data, roleFilter]);
  const provList = providers.data ?? [];

  return (
    <div className="space-y-4">
      <PageHeader title="Mô hình & Khoá API" subtitle="Nhà cung cấp, khoá API và registry model (LLM / ASR / TTS)" />
      <Card
        title="Nhà cung cấp"
        actions={
          <Button size="xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditProv(null)}>
            Thêm nhà cung cấp
          </Button>
        }
        bodyClass="p-0 overflow-x-auto"
      >
        {providers.isLoading ? (
          <Loading />
        ) : providers.error ? (
          <ErrorBox error={providers.error} />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>ID</th>
                <th>Loại</th>
                <th>Base URL</th>
                <th>Biến môi trường</th>
                <th>Khoá</th>
                <th>Ghi chú</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {provList.map((p) => (
                <tr key={p.id}>
                  <td className="font-mono text-xs">{p.id}</td>
                  <td className="text-xs">{p.kind}</td>
                  <td className="max-w-[260px] truncate font-mono text-xs" title={p.base_url ?? ""}>
                    {p.base_url ?? <span className="text-slate-400">mặc định</span>}
                  </td>
                  <td className="font-mono text-xs">{p.api_key_env ?? "—"}</td>
                  <td>
                    {p.kind === "builtin" ? (
                      <span className="text-xs text-slate-400">không cần</span>
                    ) : !p.api_key_env && p.key_status === "chưa có" ? (
                      <Badge title="Không khai báo biến môi trường — server tự host thường không cần khoá">không bắt buộc</Badge>
                    ) : (
                      <Badge color={p.key_status === "chưa có" ? "yellow" : "green"}>{p.key_status}</Badge>
                    )}
                  </td>
                  <td className="max-w-[240px] truncate text-xs text-slate-500" title={p.notes}>
                    {p.notes}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {p.kind !== "builtin" && (
                      <>
                        <Button size="xs" variant="ghost" icon={<KeyRound className="h-3.5 w-3.5" />} onClick={() => setKeyProv(p)}>
                          Nhập khoá
                        </Button>
                        <Button size="xs" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditProv(p)}>
                          Sửa
                        </Button>
                        <Button size="xs" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => delProv(p.id)} title="Xoá" />
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card
        title="Model"
        actions={
          <>
            <Select
              className="!h-7 !w-32 !py-0 text-xs"
              value={roleFilter}
              onChange={setRoleFilter}
              placeholder="Mọi vai trò"
              options={[
                { value: "llm", label: "LLM" },
                { value: "asr", label: "ASR" },
                { value: "tts", label: "TTS" },
              ]}
            />
            <Button size="xs" variant="primary" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setEditModel(null)} disabled={!provList.length}>
              Thêm model
            </Button>
          </>
        }
        bodyClass="p-0 overflow-x-auto"
      >
        {models.isLoading ? (
          <Loading />
        ) : models.error ? (
          <ErrorBox error={models.error} />
        ) : rows.length === 0 ? (
          <div className="p-3">
            <Empty>Chưa có model.</Empty>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>ID / Tên</th>
                <th>Vai trò</th>
                <th>Nhà cung cấp</th>
                <th>config.model</th>
                <th>Giá</th>
                <th className="text-right">Tham số</th>
                <th className="text-right">Context</th>
                <th>Nộp bài</th>
                <th>Sẵn sàng</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="font-mono text-xs">{m.id}</div>
                    <div className="max-w-[200px] truncate text-[11px] text-slate-500">{m.name}</div>
                  </td>
                  <td>
                    <Badge color={m.role === "llm" ? "blue" : m.role === "asr" ? "purple" : "orange"}>{m.role.toUpperCase()}</Badge>
                  </td>
                  <td className="text-xs">
                    {m.provider_id}
                    {m.plugin && <div className="text-[11px] text-slate-500">plugin: {m.plugin}</div>}
                  </td>
                  <td className="font-mono text-xs">{m.config?.model ?? "—"}</td>
                  <td className="text-[11px] text-slate-600 dark:text-slate-300">
                    {Object.entries(m.price ?? {}).length
                      ? Object.entries(m.price)
                          .map(([k, v]) => `${k}: ${v}`)
                          .join(", ")
                      : "—"}
                  </td>
                  <td className="text-right font-mono text-xs">{m.n_params_b != null ? `${m.n_params_b}B` : "—"}</td>
                  <td className="text-right font-mono text-xs">{m.context_len ?? "—"}</td>
                  <td>{m.submit_ok ? <Badge color="green">dùng được khi nộp</Badge> : <span className="text-xs text-slate-400">—</span>}</td>
                  <td className="max-w-[260px]">
                    {m.ready === null ? <Badge color="green">sẵn sàng</Badge> : <span className="text-xs text-red-600 dark:text-red-400">{m.ready}</span>}
                  </td>
                  <td className="whitespace-nowrap text-right">
                    {(m.role === "llm" || m.role === "asr") && (
                      <Button
                        size="xs"
                        variant="ghost"
                        icon={<BarChart3 className="h-3.5 w-3.5" />}
                        onClick={() => nav(`/experiments/new?${m.role === "llm" ? "llm_model" : "asr_model"}=${encodeURIComponent(m.id)}`)}
                        title="Mở trình soạn thử nghiệm với model này"
                      >
                        Đánh giá
                      </Button>
                    )}
                    <Button size="xs" variant="ghost" icon={<Stethoscope className="h-3.5 w-3.5" />} loading={testing === m.id} onClick={() => test(m.id)}>
                      Kiểm tra
                    </Button>
                    <Button size="xs" variant="ghost" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => setEditModel(m)}>
                      Sửa
                    </Button>
                    <Button size="xs" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => delModel(m.id)} title="Xoá" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {editProv !== undefined && <ProviderModal init={editProv} onClose={() => setEditProv(undefined)} />}
      {keyProv && <KeyModal provider={keyProv} onClose={() => setKeyProv(null)} />}
      {editModel !== undefined && <ModelModal init={editModel} providers={provList} onClose={() => setEditModel(undefined)} />}
      {testRes && (
        <Modal open onClose={() => setTestRes(null)} title={`Kết quả kiểm tra — ${testRes.id}`}>
          <TestResult data={testRes.data} />
        </Modal>
      )}
    </div>
  );
}
