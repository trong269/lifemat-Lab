import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, PackagePlus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api, Json } from "../../api";
import { JobProgress } from "../../components/JobProgress";
import { JsonView } from "../../components/JsonView";
import { MultiSelect } from "../../components/MultiSelect";
import { useToast } from "../../components/Toast";
import { Button, Card, Checkbox, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, NumberInput, Select } from "../../components/ui";
import { fmtTime, statusVi } from "../../lib/format";
import { useDatasets, useMeta, usePlugins } from "../../lib/hooks";

interface Comp {
  dataset_id: string;
  weight: number;
  statuses: string[];
}

export default function ExportTab() {
  const datasets = useDatasets();
  const plugins = usePlugins();
  const meta = useMeta();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["exports"], queryFn: api.exports });
  const [name, setName] = useState("sft_v1");
  const [comps, setComps] = useState<Comp[]>([{ dataset_id: "train", weight: 1, statuses: ["approved"] }]);
  const [kind, setKind] = useState("sft");
  const [renderer, setRenderer] = useState("compact");
  const [rules, setRules] = useState("rules_v2");
  const [finalText, setFinalText] = useState("Đã xong.");
  const [mutate, setMutate] = useState<number | null>(0);
  const [shuffle, setShuffle] = useState(true);
  const [seed, setSeed] = useState<number | null>(0);
  const [job, setJob] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; data: Json[] } | null>(null);

  const dsList = datasets.data ?? [];
  const isSynth = (id: string) => {
    const d = dsList.find((x) => x.id === id);
    if (!d) return false;
    if (d.kind === "synthetic") return true;
    if (d.kind === "subset") return dsList.find((x) => x.id === d.parent_id)?.kind === "synthetic";
    return false;
  };
  const setComp = (i: number, c: Partial<Comp>) => setComps(comps.map((x, j) => (j === i ? { ...x, ...c } : x)));

  const start = async () => {
    try {
      const r = await api.startExport({
        name,
        components: comps.map((c) => ({ dataset_id: c.dataset_id, weight: c.weight, statuses: c.statuses })),
        options: { kind, renderer, prompt: { plugin: "rules", rules }, final_text: finalText, mutate_ratio: mutate ?? 0, shuffle, seed: seed ?? 0 },
      });
      setJob(r.job_id);
      toast.success("Đã bắt đầu xuất dữ liệu");
    } catch (e) {
      toast.error(e);
    }
  };
  const showPreview = async (id: string) => {
    try {
      setPreview({ id, data: await api.exportPreview(id, 3) });
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="space-y-4">
      <Card title="Xuất dữ liệu huấn luyện" subtitle="SFT (OpenAI messages + tools, dựng bằng chính renderer/prompt của agent) hoặc manifest ASR">
        <div className="space-y-3">
          <Notice color="yellow">Dataset public_test không bao giờ được xuất (luật thi) — backend sẽ từ chối.</Notice>
          <Field label="Tên bản xuất" className="max-w-sm">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div>
            <div className="label">Thành phần</div>
            <div className="space-y-2">
              {comps.map((c, i) => (
                <div key={i} className="grid items-end gap-2 rounded-md border border-slate-200 p-2 dark:border-slate-800 md:grid-cols-[2fr_100px_2fr_auto]">
                  <Field label="Dataset">
                    <Select
                      value={c.dataset_id}
                      onChange={(v) => setComp(i, { dataset_id: v })}
                      options={dsList.map((d) => ({ value: d.id, label: `${d.name} · ${d.kind} (${d.n})`, disabled: d.id === "public_test" }))}
                    />
                  </Field>
                  <Field label="Trọng số">
                    <NumberInput value={c.weight} onChange={(v) => setComp(i, { weight: v ?? 1 })} allowNull={false} step={0.1} min={0} />
                  </Field>
                  <Field label="Trạng thái (chỉ dữ liệu tổng hợp)">
                    <MultiSelect
                      value={c.statuses}
                      onChange={(v) => setComp(i, { statuses: v })}
                      options={["approved", "pending", "needs_relabel", "rejected"].map((x) => ({ value: x, label: statusVi(x) }))}
                      className={isSynth(c.dataset_id) ? "" : "pointer-events-none opacity-50"}
                    />
                  </Field>
                  <Button variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => setComps(comps.filter((_, j) => j !== i))} disabled={comps.length <= 1} title="Bỏ" />
                </div>
              ))}
              <Button size="xs" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setComps([...comps, { dataset_id: dsList.find((d) => d.kind === "synthetic")?.id ?? "train", weight: 1, statuses: ["approved"] }])}>
                Thêm thành phần
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Field label="Loại">
              <Select
                value={kind}
                onChange={setKind}
                options={[
                  { value: "sft", label: "SFT (sft.jsonl)" },
                  { value: "asr_manifest", label: "ASR manifest" },
                ]}
              />
            </Field>
            <Field label="Renderer">
              <Select value={renderer} onChange={setRenderer} options={(plugins.data?.renderer ?? []).map((p) => p.name)} />
            </Field>
            <Field label="Bộ luật">
              <Select value={rules} onChange={setRules} options={meta.data?.rules ?? ["rules_v2"]} />
            </Field>
            <Field label="Câu trả lời cuối">
              <Input value={finalText} onChange={(e) => setFinalText(e.target.value)} />
            </Field>
            <Field label="Tỉ lệ đổi tên app/tool" hint="Chống học thuộc tên">
              <NumberInput value={mutate} onChange={setMutate} step={0.05} min={0} max={1} />
            </Field>
            <Field label="Seed">
              <NumberInput value={seed} onChange={setSeed} step={1} />
            </Field>
            <div className="flex items-end pb-1.5">
              <Checkbox checked={shuffle} onChange={setShuffle} label="Xáo trộn" />
            </div>
          </div>
          <div>
            <Button variant="primary" icon={<PackagePlus className="h-4 w-4" />} onClick={start} disabled={!name || !comps.length}>
              Xuất
            </Button>
          </div>
          {job && <JobProgress id={job} />}
        </div>
      </Card>
      <Card
        title="Các bản đã xuất"
        actions={
          <Button size="xs" onClick={() => qc.invalidateQueries({ queryKey: ["exports"] })}>
            Làm mới
          </Button>
        }
        bodyClass="p-0 overflow-x-auto"
      >
        {list.isLoading ? (
          <Loading />
        ) : list.error ? (
          <ErrorBox error={list.error} />
        ) : !list.data?.length ? (
          <div className="p-3">
            <Empty>Chưa có bản xuất nào.</Empty>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Bản xuất</th>
                <th>Loại</th>
                <th className="text-right">Số ví dụ</th>
                <th>Theo dataset</th>
                <th>Tạo lúc</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.data.map((v) => {
                const k = v.options?.kind ?? "sft";
                const file = k === "sft" ? "sft.jsonl" : "asr_manifest.jsonl";
                return (
                  <tr key={v.id}>
                    <td>
                      <div>{v.name}</div>
                      <div className="font-mono text-[11px] text-slate-500">{v.id}</div>
                    </td>
                    <td className="text-xs">{k}</td>
                    <td className="text-right font-mono">{v.stats?.n ?? "—"}</td>
                    <td className="text-xs">
                      {Object.entries(v.stats?.by_dataset ?? {})
                        .map(([a, b]) => `${a}: ${b}`)
                        .join(", ")}
                      {v.stats?.mutated ? <span className="text-slate-500"> · đổi tên {v.stats.mutated}</span> : null}
                    </td>
                    <td className="whitespace-nowrap text-xs text-slate-500">{fmtTime(v.created)}</td>
                    <td className="whitespace-nowrap text-right">
                      <Button size="xs" variant="ghost" icon={<Eye className="h-3.5 w-3.5" />} onClick={() => showPreview(v.id)}>
                        Xem trước
                      </Button>
                      <a href={api.exportDownloadUrl(v.id, file)} download>
                        <Button size="xs" variant="ghost" icon={<Download className="h-3.5 w-3.5" />}>
                          {file}
                        </Button>
                      </a>
                      <a href={api.exportDownloadUrl(v.id, "stats.json")} download>
                        <Button size="xs" variant="ghost">
                          stats.json
                        </Button>
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>
      <Modal open={!!preview} onClose={() => setPreview(null)} title={`Ví dụ đầu tiên — ${preview?.id}`} width="max-w-4xl">
        {preview && (preview.data.length ? preview.data.map((x, i) => <JsonView key={i} data={x} openDepth={2} className="mb-2" />) : <Empty>Trống.</Empty>)}
      </Modal>
    </div>
  );
}
