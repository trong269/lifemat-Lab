import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Plus, Save, Sparkles, Trash2, X } from "lucide-react";
import { ReactNode, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, GenStart, Recipe } from "../../api";
import { JobProgress } from "../../components/JobProgress";
import { MultiSelect } from "../../components/MultiSelect";
import { useToast } from "../../components/Toast";
import { Button, Card, Field, Input, Loading, Notice, NumberInput, Select } from "../../components/ui";
import { useCatalogApps, useDatasets, useMeta, useModels } from "../../lib/hooks";
import { CalibrationNote, CalibrationStatus } from "./Calibration";

function WeightRow({ label, hint, value, total, onChange, max = 30, step = 1 }: { label: ReactNode; hint?: string; value: number; total: number; onChange: (v: number) => void; max?: number; step?: number }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_120px_70px_44px] items-center gap-2 py-0.5" title={hint}>
      <div className="min-w-0 truncate text-xs">{label}</div>
      <input type="range" min={0} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-accent-600" />
      <NumberInput className="!h-7 !py-0 text-xs" value={value} onChange={(v) => onChange(v ?? 0)} allowNull={false} min={0} step={step} />
      <span className="text-right font-mono text-[11px] text-slate-500">{total > 0 ? `${((100 * value) / total).toFixed(0)}%` : "—"}</span>
    </div>
  );
}

function DistEditor({ value, onChange, keyLabel, max = 1, step = 0.01 }: { value: Record<string, number>; onChange: (v: Record<string, number>) => void; keyLabel: (k: string) => string; max?: number; step?: number }) {
  const total = Object.values(value).reduce((a, b) => a + b, 0);
  const [nk, setNk] = useState("");
  return (
    <div>
      {Object.entries(value).map(([k, v]) => (
        <div key={k} className="flex items-center gap-1">
          <div className="flex-1">
            <WeightRow label={keyLabel(k)} value={v} total={total} max={max} step={step} onChange={(x) => onChange({ ...value, [k]: x })} />
          </div>
          <button
            className="text-slate-400 hover:text-red-500"
            title="Bỏ"
            onClick={() => {
              const o = { ...value };
              delete o[k];
              onChange(o);
            }}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <div className="mt-1 flex gap-1">
        <Input className="!h-7 !w-24 !py-0 text-xs" value={nk} onChange={(e) => setNk(e.target.value)} placeholder="khoá mới" />
        <Button size="xs" icon={<Plus className="h-3 w-3" />} disabled={!nk || nk in value} onClick={() => (onChange({ ...value, [nk]: 0 }), setNk(""))}>
          Thêm
        </Button>
      </div>
    </div>
  );
}

const REGION_VI: Record<string, string> = { bac: "Bắc", trung: "Trung", nam: "Nam" };

export default function RecipeTab() {
  const meta = useMeta();
  const models = useModels();
  const apps = useCatalogApps();
  const datasets = useDatasets();
  const toast = useToast();
  const qc = useQueryClient();
  const recipes = useQuery({ queryKey: ["recipes"], queryFn: api.recipes });
  const [r, setR] = useState<Recipe | null>(null);
  const [rid, setRid] = useState<string>("");
  const [rname, setRname] = useState("Công thức mới");
  const [genName, setGenName] = useState("");
  const [appendTo, setAppendTo] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [started, setStarted] = useState<(GenStart & { preview: boolean }) | null>(null);

  useEffect(() => {
    if (!r && meta.data) setR({ ...meta.data.recipe_default });
  }, [meta.data, r]);
  if (!r || !meta.data) return <Loading />;
  const set = <K extends keyof Recipe>(k: K, v: Recipe[K]) => setR({ ...r, [k]: v });
  const llms = (models.data ?? []).filter((m) => m.role === "llm" && m.id !== "oracle").map((m) => ({ value: m.id, label: `${m.id}${m.ready ? " (chưa sẵn sàng)" : ""}` }));
  const scen = meta.data.scenarios;
  const wTotal = Object.values(r.weights).reduce((a, b) => a + b, 0);
  const synth = (datasets.data ?? []).filter((d) => d.kind === "synthetic");

  const load = (id: string) => {
    setRid(id);
    const x = recipes.data?.find((y) => y.id === id);
    if (x) {
      setR({ ...meta.data!.recipe_default, ...x.config });
      setRname(x.name);
    } else {
      setR({ ...meta.data!.recipe_default });
      setRname("Công thức mới");
    }
  };
  const save = async () => {
    setBusy("save");
    try {
      const out = await api.saveRecipe({ id: rid || undefined, name: rname, config: r });
      setRid(out.id);
      qc.invalidateQueries({ queryKey: ["recipes"] });
      toast.success("Đã lưu công thức");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const del = async () => {
    if (!rid || !confirm("Xoá công thức này?")) return;
    try {
      await api.deleteRecipe(rid);
      qc.invalidateQueries({ queryKey: ["recipes"] });
      load("");
    } catch (e) {
      toast.error(e);
    }
  };
  const preview = async () => {
    setBusy("preview");
    try {
      const out = await api.synthPreview(r, 5, `Xem trước ${rname}`);
      setStarted({ ...out, preview: true });
      qc.invalidateQueries({ queryKey: ["datasets"] });
      toast.success("Đã bắt đầu sinh 5 mẫu xem trước");
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const generate = async () => {
    setBusy("gen");
    try {
      const out = await api.synthGenerate({ recipe: r, name: genName || rname, dataset_id: appendTo || null });
      setStarted({ ...out, preview: false });
      qc.invalidateQueries({ queryKey: ["datasets"] });
      toast.success(`Đã bắt đầu sinh ${r.n_samples} mẫu`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Công thức đã lưu" className="w-64">
            <Select value={rid} onChange={load} placeholder="(mới)" options={(recipes.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
          </Field>
          <Field label="Tên công thức" className="w-64">
            <Input value={rname} onChange={(e) => setRname(e.target.value)} />
          </Field>
          <Button icon={<Save className="h-4 w-4" />} onClick={save} loading={busy === "save"}>
            Lưu
          </Button>
          {rid && <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={del} title="Xoá công thức" />}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Model" subtitle="Writer viết câu yêu cầu; teacher (labeler) chạy thật trên mô phỏng để gán nhãn">
          <div className="grid gap-3">
            <Field label="Writer (viết câu)">
              <Select value={r.writer_model} onChange={(v) => set("writer_model", v)} placeholder="Chọn model…" options={llms} />
            </Field>
            <Field label="Teacher gán nhãn (labeler)">
              <Select value={r.labeler_model} onChange={(v) => set("labeler_model", v)} placeholder="Chọn model…" options={llms} />
            </Field>
            <CalibrationStatus model={r.labeler_model} />
            <Field label="Teacher thứ hai để đối chiếu (tuỳ chọn)" hint="Mẫu mà hai teacher không đồng ý sẽ được đánh dấu để duyệt kỹ">
              <Select value={r.labeler2_model ?? ""} onChange={(v) => set("labeler2_model", v || null)} placeholder="(không dùng)" options={llms} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bộ luật">
                <Select value={r.rules} onChange={(v) => set("rules", v)} options={meta.data.rules} />
              </Field>
              <Field label="Chế độ state">
                <Select
                  value={r.state_mode}
                  onChange={(v) => set("state_mode", v)}
                  options={[
                    { value: "perturb", label: "perturb — biến đổi state train (miễn phí)" },
                    { value: "llm", label: "llm — teacher viết lại state" },
                  ]}
                />
              </Field>
            </div>
          </div>
        </Card>
        <Card title="Quy mô & thực thi">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Field label="Số mẫu">
              <NumberInput value={r.n_samples} onChange={(v) => set("n_samples", Math.max(1, Math.round(v ?? 1)))} allowNull={false} step={1} min={1} max={20000} />
            </Field>
            <Field label="Song song">
              <NumberInput value={r.parallel} onChange={(v) => set("parallel", Math.max(1, Math.min(32, Math.round(v ?? 4))))} allowNull={false} step={1} min={1} max={32} />
            </Field>
            <Field label="Seed">
              <NumberInput value={r.seed} onChange={(v) => set("seed", Math.round(v ?? 0))} allowNull={false} step={1} />
            </Field>
            <Field label="Hạn mức chi phí (USD)" hint="Trống = không giới hạn">
              <NumberInput value={r.budget_usd} onChange={(v) => set("budget_usd", v)} min={0} />
            </Field>
            <Field label="Tỉ lệ kiểm tra ngẫu nhiên">
              <NumberInput value={r.spot_check_rate} onChange={(v) => set("spot_check_rate", v ?? 0)} allowNull={false} step={0.05} min={0} max={1} />
            </Field>
            <div />
            <Field label="Số app đã cài tối thiểu">
              <NumberInput value={r.installed_min} onChange={(v) => set("installed_min", Math.round(v ?? 4))} allowNull={false} step={1} min={1} />
            </Field>
            <Field label="Số app đã cài tối đa">
              <NumberInput value={r.installed_max} onChange={(v) => set("installed_max", Math.round(v ?? 12))} allowNull={false} step={1} min={1} />
            </Field>
          </div>
        </Card>
        <Card title="Tỷ trọng kịch bản" subtitle={`Tổng ${wTotal} — phần trăm tính tự động`}>
          {Object.keys({ ...scen, ...r.weights }).map((k) => (
            <WeightRow
              key={k}
              label={
                <span>
                  {scen[k]?.name ?? k} <span className="font-mono text-[10px] text-slate-400">{k}</span>
                </span>
              }
              hint={scen[k] ? `${scen[k].desc} (kỳ vọng: ${scen[k].expect})` : undefined}
              value={r.weights[k] ?? 0}
              total={wTotal}
              onChange={(v) => set("weights", { ...r.weights, [k]: v })}
            />
          ))}
        </Card>
        <div className="space-y-4">
          <Card title="App">
            <div className="grid gap-3">
              <Field label="App trọng tâm (apps_pool)" hint="Trống = mọi app train + app tự tạo đã duyệt. 11 app chỉ có ở public_test bị chặn.">
                <MultiSelect
                  value={r.apps_pool}
                  onChange={(v) => set("apps_pool", v)}
                  options={(apps.data ?? []).map((a) => ({ value: a.id, label: a.name_vi ? `${a.name_vi}` : a.id, hint: `${a.source === "generated" ? "app tự tạo · " : ""}${a.group ?? ""} · ${a.n_tools} tool` }))}
                  placeholder="Tất cả app"
                />
              </Field>
              <Field label="App tự tạo đưa vào split (extra_apps)" hint="Chỉ app đã duyệt trong App Factory">
                <MultiSelect
                  value={r.extra_apps}
                  onChange={(v) => set("extra_apps", v)}
                  options={(apps.data ?? []).filter((a) => a.source === "generated").map((a) => ({ value: a.id, label: a.name_vi ?? a.id }))}
                  placeholder="Không có"
                />
              </Field>
            </div>
          </Card>
          <Card title="Phân bố số lượt history">
            <DistEditor value={r.history_dist} onChange={(v) => set("history_dist", v)} keyLabel={(k) => `${k} lượt`} />
          </Card>
          <Card title="Vùng miền (giọng / cách nói)">
            {Object.keys({ bac: 0, trung: 0, nam: 0, ...r.region_weights }).map((k) => (
              <WeightRow
                key={k}
                label={REGION_VI[k] ?? k}
                value={r.region_weights[k] ?? 0}
                total={Object.values(r.region_weights).reduce((a, b) => a + b, 0)}
                max={1}
                step={0.05}
                onChange={(v) => set("region_weights", { ...r.region_weights, [k]: v })}
              />
            ))}
          </Card>
        </div>
      </div>

      <Card title="Sinh dữ liệu">
        <div className="flex flex-wrap items-end gap-2">
          <Button icon={<Eye className="h-4 w-4" />} onClick={preview} loading={busy === "preview"} disabled={!r.writer_model || !r.labeler_model}>
            Xem trước 5 mẫu
          </Button>
          <div className="mx-2 h-8 w-px bg-slate-200 dark:bg-slate-700" />
          <Field label="Tên đợt / dataset" className="w-56">
            <Input value={genName} onChange={(e) => setGenName(e.target.value)} placeholder={rname} />
          </Field>
          <Field label="Nối thêm vào dataset tổng hợp" className="w-56">
            <Select value={appendTo} onChange={setAppendTo} placeholder="(tạo dataset mới)" options={synth.map((d) => ({ value: d.id, label: `${d.name} (${d.n})` }))} />
          </Field>
          <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} onClick={generate} loading={busy === "gen"} disabled={!r.writer_model || !r.labeler_model}>
            Sinh {r.n_samples} mẫu
          </Button>
        </div>
        {(!r.writer_model || !r.labeler_model) && <div className="hint">Cần chọn writer và teacher.</div>}
        {started && (
          <div className="mt-3 space-y-2">
            {started.calibration && <CalibrationNote cal={started.calibration} />}
            <Notice color="blue">
              {started.preview ? "Đang sinh 5 mẫu xem trước" : "Đang sinh dữ liệu"} vào dataset <span className="font-mono">{started.dataset_id}</span> (đợt{" "}
              <span className="font-mono">{started.batch_id}</span>).{" "}
              <Link className="underline" to={`/studio/review/${started.dataset_id}`}>
                Mở trang duyệt
              </Link>{" "}
              ·{" "}
              <Link className="underline" to={`/datasets/${started.dataset_id}`}>
                Xem dataset
              </Link>
            </Notice>
            <JobProgress id={started.job_id} />
          </div>
        )}
      </Card>
    </div>
  );
}
