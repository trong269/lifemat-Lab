import { useQuery, useQueryClient } from "@tanstack/react-query";
import yaml from "js-yaml";
import { Calculator, CheckCircle2, Copy, Play, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, Dict, ExperimentConfig, Json } from "../api";
import { CodeEditor, JsonEditor } from "../components/CodeEditor";
import { MultiSelect } from "../components/MultiSelect";
import { useToast } from "../components/Toast";
import { Button, Card, Checkbox, ErrorBox, Field, Input, Loading, Notice, NumberInput, PageHeader, Select, Tabs, Textarea, Toggle } from "../components/ui";
import { fmtCost, fmtInt } from "../lib/format";
import { useDatasets, useMeta, useModels, usePlugins } from "../lib/hooks";

type Item = Dict | string;
const nameOf = (x: Item) => (typeof x === "string" ? x : String(x.plugin ?? x.name ?? ""));

/** Đổi danh sách tên -> danh sách mục, giữ nguyên mục dạng dict (có tham số) nếu tên vẫn còn. */
function rebuild(names: string[], old: Item[]): Item[] {
  return names.map((n) => old.find((o) => nameOf(o) === n) ?? n);
}

function asDict(v: Dict | string | undefined, key = "plugin"): Dict {
  if (v === undefined || v === null) return {};
  return typeof v === "string" ? { [key]: v } : { ...v };
}

export function ExperimentForm({ cfg, onChange }: { cfg: ExperimentConfig; onChange: (c: ExperimentConfig) => void }) {
  const meta = useMeta();
  const plugins = usePlugins();
  const models = useModels();
  const datasets = useDatasets();
  const set = <K extends keyof ExperimentConfig>(k: K, v: ExperimentConfig[K]) => onChange({ ...cfg, [k]: v });
  const llms = (models.data ?? []).filter((m) => m.role === "llm");
  const asrs = (models.data ?? []).filter((m) => m.role === "asr");
  const prompt = asDict(cfg.prompt);
  const agent = asDict(cfg.agent);
  const renderer = asDict(cfg.renderer);
  const score = cfg.score ?? {};
  const [sidText, setSidText] = useState((cfg.sample_ids ?? []).join("\n"));
  useEffect(() => {
    const cur = sidText.split(/[\s,]+/).filter(Boolean);
    if (JSON.stringify(cur) !== JSON.stringify(cfg.sample_ids ?? [])) setSidText((cfg.sample_ids ?? []).join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.sample_ids]);
  const modelOpt = (m: { id: string; name: string; ready: string | null }) => ({ value: m.id, label: `${m.id}${m.name && m.name !== m.id ? ` — ${m.name}` : ""}${m.ready ? " (chưa sẵn sàng)" : ""}` });
  const selLlm = llms.find((m) => m.id === cfg.llm_model);
  const selAsr = asrs.find((m) => m.id === cfg.asr_model);

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Dữ liệu & chế độ">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tên run" className="sm:col-span-2">
            <Input value={cfg.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label="Chế độ">
            <Select
              value={cfg.mode}
              onChange={(v) => set("mode", v)}
              options={[
                { value: "full", label: "full — ASR + agent" },
                { value: "asr_only", label: "asr_only — chỉ đo WER" },
              ]}
            />
          </Field>
          <Field label="Dataset">
            <Select value={cfg.dataset} onChange={(v) => set("dataset", v)} options={(datasets.data ?? []).map((d) => ({ value: d.id, label: `${d.id} (${d.n} mẫu)` }))} />
          </Field>
          <Field label="Giới hạn số mẫu" hint="0 = tất cả">
            <NumberInput value={cfg.limit} onChange={(v) => set("limit", Math.max(0, Math.round(v ?? 0)))} allowNull={false} step={1} min={0} />
          </Field>
          <Field label="Chỉ chạy các mẫu (sample_ids)" hint="Mỗi dòng / dấu phẩy một ID; trống = theo dataset" className="sm:col-span-2">
            <Textarea
              rows={2}
              className="font-mono text-xs"
              value={sidText}
              onChange={(e) => {
                setSidText(e.target.value);
                const ids = e.target.value.split(/[\s,]+/).filter(Boolean);
                set("sample_ids", ids.length ? ids : null);
              }}
              placeholder="train_0001, train_0002…"
            />
          </Field>
        </div>
      </Card>

      <Card title="ASR">
        <div className="grid gap-3">
          <Field label="Model ASR" hint={selAsr?.ready ? <span className="text-red-600">{selAsr.ready}</span> : "gold-asr = dùng transcript gốc (chỉ có ở train / dữ liệu tổng hợp)"}>
            <Select value={cfg.asr_model} onChange={(v) => set("asr_model", v)} options={asrs.map(modelOpt)} />
          </Field>
          <Field label="Hậu xử lý transcript (theo thứ tự)">
            <MultiSelect
              ordered
              value={(cfg.postprocess ?? []).map(nameOf)}
              onChange={(v) => set("postprocess", rebuild(v, cfg.postprocess ?? []))}
              options={(plugins.data?.postprocess ?? []).map((p) => ({ value: p.name, hint: p.description }))}
              placeholder="Không dùng"
            />
          </Field>
          <Field label="Hậu xử lý — JSON đầy đủ (có tham số, vd replace.pairs)">
            <JsonEditor value={cfg.postprocess ?? []} onChange={(v) => set("postprocess", Array.isArray(v) ? v : [])} height="90px" />
          </Field>
          <Field label="Ghi đè tham số ASR (asr_overrides)">
            <JsonEditor value={cfg.asr_overrides ?? {}} onChange={(v) => set("asr_overrides", (v as Dict) ?? {})} height="70px" />
          </Field>
        </div>
      </Card>

      <Card title="LLM agent">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Model LLM" className="sm:col-span-2" hint={selLlm?.ready ? <span className="text-red-600">{selLlm.ready}</span> : undefined}>
            <Select value={cfg.llm_model} onChange={(v) => set("llm_model", v)} options={llms.map(modelOpt)} />
          </Field>
          <Field label="Ghi đè tham số model (llm_overrides)" hint='vd {"temperature": 0, "max_tokens": 1024}' className="sm:col-span-2">
            <JsonEditor value={cfg.llm_overrides ?? {}} onChange={(v) => set("llm_overrides", (v as Dict) ?? {})} height="70px" />
          </Field>
          <Field label="Renderer (mô tả tool)">
            <Select
              value={String(renderer.plugin ?? "compact")}
              onChange={(v) => set("renderer", typeof cfg.renderer === "string" ? v : { ...renderer, plugin: v })}
              options={(plugins.data?.renderer ?? [{ name: "compact", description: "" }]).map((p) => ({ value: p.name, label: `${p.name} — ${p.description}` }))}
            />
          </Field>
          <Field label="Bộ luật (prompt)">
            <Select
              value={String(prompt.rules ?? "rules_v2")}
              onChange={(v) => set("prompt", { plugin: "rules", ...prompt, rules: v })}
              options={(meta.data?.rules ?? ["rules_v2"]).map((r) => ({ value: r, label: r }))}
            />
          </Field>
          <Field label="File few-shot (JSONL, tuỳ chọn)">
            <Input
              value={prompt.few_shot_file ?? ""}
              onChange={(e) => set("prompt", { plugin: "rules", ...prompt, few_shot_file: e.target.value || null })}
              placeholder="đường dẫn .jsonl"
            />
          </Field>
          <Field label="Số ví dụ few-shot">
            <NumberInput value={prompt.few_shot_n ?? 0} onChange={(v) => set("prompt", { plugin: "rules", ...prompt, few_shot_n: Math.round(v ?? 0) })} allowNull={false} step={1} min={0} />
          </Field>
          <Field label="Số bước LLM tối đa (agent.max_steps)">
            <NumberInput value={agent.max_steps ?? 10} onChange={(v) => set("agent", { plugin: "react", ...agent, max_steps: Math.round(v ?? 10) })} allowNull={false} step={1} min={1} />
          </Field>
          <Field label="Số tool call tối đa (agent.max_calls)">
            <NumberInput value={agent.max_calls ?? 16} onChange={(v) => set("agent", { plugin: "react", ...agent, max_calls: Math.round(v ?? 16) })} allowNull={false} step={1} min={1} />
          </Field>
          <Field label="Guard (theo thứ tự áp dụng)" className="sm:col-span-2" hint="Mặc định: validate_repair, iso_time, ask_params_order, dedupe_reads, ask_last">
            <MultiSelect
              ordered
              value={(cfg.guards ?? []).map(nameOf)}
              onChange={(v) => set("guards", rebuild(v, cfg.guards ?? []))}
              options={(plugins.data?.guard ?? []).map((p) => ({ value: p.name, hint: p.description }))}
              placeholder="Không dùng guard"
            />
          </Field>
        </div>
      </Card>

      <Card title="Thực thi & chấm điểm">
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Thời gian mỗi mẫu (giây)" hint="Luật thi: 30s">
            <NumberInput value={cfg.timeout_s} onChange={(v) => set("timeout_s", v ?? 30)} allowNull={false} min={1} />
          </Field>
          <Field label="Số worker song song">
            <NumberInput value={cfg.workers} onChange={(v) => set("workers", Math.min(64, Math.max(1, Math.round(v ?? 4))))} allowNull={false} step={1} min={1} max={64} />
          </Field>
          <Field label="Hạn mức chi phí (USD)" hint="Trống = không giới hạn">
            <NumberInput value={cfg.budget_usd} onChange={(v) => set("budget_usd", v)} min={0} />
          </Field>
          <div className="sm:col-span-3">
            <Toggle checked={cfg.use_cache} onChange={(v) => set("use_cache", v)} label="Dùng cache kết quả LLM/ASR (chạy lại cùng cấu hình không tốn tiền)" />
          </div>
          <div className="space-y-2 rounded-md border border-slate-200 p-2.5 dark:border-slate-800 sm:col-span-3">
            <div className="label">Tuỳ chọn chấm điểm</div>
            <div className="flex flex-wrap gap-4">
              <Checkbox checked={score.strict_keys ?? true} onChange={(v) => set("score", { ...score, strict_keys: v })} label="strict_keys (thừa/thiếu tham số = sai)" />
              <Checkbox checked={score.list_as_set ?? false} onChange={(v) => set("score", { ...score, list_as_set: v })} label="list_as_set (list không theo thứ tự)" />
              <Checkbox checked={score.token_regex ?? false} onChange={(v) => set("score", { ...score, token_regex: v })} label="token_regex (tách token chữ/số)" />
            </div>
            <Field label="Ngưỡng fuzzy (fuzzy_threshold)" className="max-w-[200px]">
              <NumberInput value={score.fuzzy_threshold ?? 0.6} onChange={(v) => set("score", { ...score, fuzzy_threshold: v ?? 0.6 })} step={0.05} min={0} max={1} allowNull={false} />
            </Field>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function ExperimentEditor() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const loc = useLocation();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const meta = useMeta();
  const exp = useQuery({ queryKey: ["experiment", id], queryFn: () => api.experiment(id as string), enabled: !!id, retry: false });
  const [cfg, setCfg] = useState<ExperimentConfig | null>(null);
  const [expName, setExpName] = useState("");
  const [mode, setMode] = useState<"form" | "yaml">("form");
  const [yamlText, setYamlText] = useState("");
  const [estimate, setEstimate] = useState<Dict | null>(null);
  const [valid, setValid] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // khởi tạo cấu hình
  useEffect(() => {
    if (cfg || !meta.data) return;
    const state = loc.state as { config?: ExperimentConfig; name?: string } | null;
    if (id) {
      const e = exp.data;
      if (!e) return;
      setCfg({ ...meta.data.experiment_default, ...e.config });
      setExpName(e.name);
      return;
    }
    const base: ExperimentConfig = { ...meta.data.experiment_default, ...(state?.config ?? {}) };
    const llm = sp.get("llm_model");
    const asr = sp.get("asr_model");
    const ds = sp.get("dataset");
    const limit = sp.get("limit");
    if (llm) base.llm_model = llm;
    if (asr) base.asr_model = asr;
    if (ds) base.dataset = ds;
    if (limit) base.limit = Number(limit) || 0;
    if (llm || asr) base.name = `Đánh giá ${llm ?? asr}`;
    if (state?.name) base.name = state.name;
    setCfg(base);
    setExpName(state?.name ?? base.name);
  }, [meta.data, exp.data, id, cfg, loc.state, sp]);

  const notFound = id && exp.error;

  const toYaml = (c: ExperimentConfig) => yaml.dump(c, { lineWidth: 120, noRefs: true });
  const switchMode = (m: "form" | "yaml") => {
    if (m === mode || !cfg) return;
    if (m === "yaml") {
      setYamlText(toYaml(cfg));
      setMode("yaml");
    } else {
      const parsed = parseYaml();
      if (parsed) {
        setCfg(parsed);
        setMode("form");
      }
    }
  };
  const parseYaml = (): ExperimentConfig | null => {
    try {
      const v = yaml.load(yamlText) as Json;
      if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("YAML phải là một object");
      return { ...(meta.data?.experiment_default as ExperimentConfig), ...v };
    } catch (e) {
      toast.error(`YAML không hợp lệ: ${(e as Error).message}`);
      return null;
    }
  };
  const current = (): ExperimentConfig | null => (mode === "yaml" ? parseYaml() : cfg);

  const act = async (what: string, fn: (c: ExperimentConfig) => Promise<void>) => {
    const c = current();
    if (!c) return;
    if (mode === "yaml") setCfg(c);
    setBusy(what);
    try {
      await fn(c);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const doEstimate = () => act("est", async (c) => setEstimate(await api.estimate(c)));
  const doValidate = () =>
    act("val", async (c) => {
      const r = await api.validateExperiment(c);
      setValid(`Cấu hình hợp lệ — ${r.n} mẫu sẽ được chạy`);
      toast.success(`Hợp lệ: ${r.n} mẫu`);
    });
  const doSave = () =>
    act("save", async (c) => {
      const r = await api.saveExperiment({ id: id || undefined, name: expName || c.name, config: c });
      toast.success("Đã lưu thử nghiệm");
      qc.invalidateQueries({ queryKey: ["experiments"] });
      qc.invalidateQueries({ queryKey: ["experiment", r.id] });
      if (!id) nav(`/experiments/${r.id}`, { replace: true });
    });
  const doRun = () =>
    act("run", async (c) => {
      const r = await api.startRun({ config: c, experiment_id: id || null, name: c.name || expName });
      qc.invalidateQueries({ queryKey: ["runs"] });
      toast.success("Đã bắt đầu run");
      nav(`/runs/${r.id}`);
    });
  const doClone = () => {
    const c = current();
    if (!c) return;
    nav("/experiments/new", { state: { config: c, name: `${expName || c.name} (bản sao)` } });
  };

  const estRows = useMemo(
    () =>
      estimate
        ? [
            ["Số mẫu", fmtInt(estimate.n)],
            ["Token vào", fmtInt(estimate.input_tokens)],
            ["Token ra", fmtInt(estimate.output_tokens)],
            ["Phút audio", estimate.audio_minutes ?? "—"],
            ["Chi phí LLM", fmtCost(estimate.llm_usd)],
            ["Chi phí ASR", fmtCost(estimate.asr_usd)],
            ["Tổng", fmtCost(estimate.usd)],
          ]
        : [],
    [estimate],
  );

  if (notFound) return <ErrorBox error={exp.error} />;
  if (!cfg) return <Loading />;
  return (
    <div className="space-y-4">
      <PageHeader
        title={id ? `Thử nghiệm: ${expName}` : "Thử nghiệm mới"}
        subtitle={id ? <span className="font-mono">{id}</span> : "Cấu hình pipeline rồi chạy trên một dataset"}
        actions={
          <>
            <Button icon={<Calculator className="h-4 w-4" />} onClick={doEstimate} loading={busy === "est"}>
              Ước tính chi phí
            </Button>
            <Button icon={<CheckCircle2 className="h-4 w-4" />} onClick={doValidate} loading={busy === "val"}>
              Kiểm tra
            </Button>
            <Button icon={<Copy className="h-4 w-4" />} onClick={doClone}>
              Clone
            </Button>
            <Button icon={<Save className="h-4 w-4" />} onClick={doSave} loading={busy === "save"}>
              Lưu
            </Button>
            <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={doRun} loading={busy === "run"}>
              Chạy
            </Button>
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Tên thử nghiệm (khi lưu)" className="w-full max-w-sm">
          <Input value={expName} onChange={(e) => setExpName(e.target.value)} />
        </Field>
        <Tabs
          value={mode}
          onChange={switchMode}
          items={[
            { value: "form", label: "Biểu mẫu" },
            { value: "yaml", label: "YAML" },
          ]}
        />
      </div>
      {valid && <Notice color="green">{valid}</Notice>}
      {estimate && (
        <Card title="Ước tính chi phí" subtitle={estimate.note}>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 lg:grid-cols-7">
            {estRows.map(([k, v]) => (
              <div key={k as string}>
                <div className="text-xs text-slate-500">{k}</div>
                <div className="font-mono font-semibold">{v}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      {mode === "form" ? (
        <ExperimentForm cfg={cfg} onChange={setCfg} />
      ) : (
        <Card title="Cấu hình YAML" subtitle="Chuyển về Biểu mẫu để kiểm tra cú pháp; các nút phía trên dùng trực tiếp nội dung YAML này.">
          <CodeEditor value={yamlText} onChange={setYamlText} lang="yaml" height="560px" />
        </Card>
      )}
    </div>
  );
}
