import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, EyeOff, Filter, Scissors, TerminalSquare } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, DuplicatePair, SampleFilter } from "../api";
import { CountBars } from "../components/Charts";
import { JsonView } from "../components/JsonView";
import { MultiSelect } from "../components/MultiSelect";
import { AudioList, ContextView, HistoryView, LabelView } from "../components/SampleView";
import { useToast } from "../components/Toast";
import { Badge, Button, Card, Collapsible, Drawer, Empty, ErrorBox, Field, Input, Loading, Modal, NumberInput, PageHeader, Pager, Select } from "../components/ui";
import { useDatasets } from "../lib/hooks";

const LIMIT = 50;

function SampleDrawer({ ds, sid, onClose }: { ds: string; sid: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ["ds-sample", ds, sid], queryFn: () => api.datasetSample(ds, sid) });
  const nav = useNavigate();
  const s = q.data?.sample;
  return (
    <Drawer
      open
      onClose={onClose}
      title={<span className="font-mono">{sid}</span>}
      actions={
        <Button size="xs" icon={<TerminalSquare className="h-3.5 w-3.5" />} onClick={() => nav(`/playground?ds=${encodeURIComponent(ds)}&sid=${encodeURIComponent(sid)}`)}>
          Mở trong Playground
        </Button>
      }
    >
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : s ? (
        <div className="space-y-4">
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">Câu yêu cầu cuối</h4>
            <div className="rounded-md border border-accent-200 bg-accent-50 p-2.5 text-[15px] dark:border-accent-900 dark:bg-accent-950/30">
              {s.audio_text ?? <span className="italic text-slate-500">(không có transcript — chỉ có audio)</span>}
            </div>
          </section>
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">Audio</h4>
            <AudioList ds={ds} files={q.data!.audio_files} />
          </section>
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">Ngữ cảnh</h4>
            <ContextView ctx={s.context} />
          </section>
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">History ({(s.history ?? []).length} lượt)</h4>
            <HistoryView history={s.history} ds={ds} />
          </section>
          <section>
            <h4 className="mb-1 text-xs font-semibold uppercase text-slate-500">Nhãn</h4>
            <LabelView label={s.label} />
          </section>
          {q.data!.state && (
            <Collapsible title="state.json (state trước lượt cuối)">
              <JsonView data={q.data!.state} openDepth={1} />
            </Collapsible>
          )}
          <Collapsible title="Dữ liệu thô của mẫu">
            <JsonView data={s} openDepth={1} />
          </Collapsible>
        </div>
      ) : null}
    </Drawer>
  );
}

function Duplicates({ ds, onOpen }: { ds: string; onOpen: (sid: string) => void }) {
  const [th, setTh] = useState<number | null>(0.8);
  const [data, setData] = useState<DuplicatePair[] | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = async () => {
    setBusy(true);
    try {
      setData(await api.duplicates(ds, th ?? 0.8));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card
      title="Mẫu gần trùng"
      subtitle="Cặp mẫu có câu yêu cầu gần giống nhau (Jaccard trên 3-gram từ)"
      actions={
        <>
          <span className="text-xs text-slate-500">Ngưỡng</span>
          <NumberInput className="!h-7 !w-20 !py-0 text-xs" value={th} onChange={setTh} step={0.05} min={0} max={1} />
          <Button size="xs" icon={<Copy className="h-3.5 w-3.5" />} onClick={load} loading={busy}>
            {data ? "Tải lại" : "Tìm mẫu gần trùng"}
          </Button>
        </>
      }
      bodyClass={data?.length ? "p-0" : "p-3.5"}
    >
      {!data ? (
        <div className="text-xs text-slate-500">Bấm “Tìm mẫu gần trùng” để quét (có thể mất vài giây với dataset lớn).</div>
      ) : data.length === 0 ? (
        <Empty>Không có cặp nào vượt ngưỡng.</Empty>
      ) : (
        <div className="max-h-[420px] overflow-auto">
          <table className="tbl">
            <thead>
              <tr>
                <th className="text-right">Jaccard</th>
                <th>Mẫu A</th>
                <th>Mẫu B</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={`${d.a}-${d.b}`}>
                  <td className="text-right font-mono">{d.jaccard.toFixed(3)}</td>
                  <td>
                    <button className="link font-mono text-xs" onClick={() => onOpen(d.a)}>
                      {d.a}
                    </button>
                    <div className="text-xs">{d.text_a}</div>
                  </td>
                  <td>
                    <button className="link font-mono text-xs" onClick={() => onOpen(d.b)}>
                      {d.b}
                    </button>
                    <div className="text-xs">{d.text_b}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function DatasetDetail() {
  const { id = "" } = useParams();
  const toast = useToast();
  const qc = useQueryClient();
  const nav = useNavigate();
  const datasets = useDatasets();
  const ds = datasets.data?.find((d) => d.id === id);
  const stats = useQuery({ queryKey: ["ds-stats", id], queryFn: () => api.datasetStats(id) });
  const [draft, setDraft] = useState<SampleFilter>({});
  const [filter, setFilter] = useState<SampleFilter>({});
  const [offset, setOffset] = useState(0);
  const samples = useQuery({
    queryKey: ["ds-samples", id, filter, offset],
    queryFn: () => api.datasetSamples(id, { filter, offset, limit: LIMIT }),
    placeholderData: (p) => p,
  });
  const [open, setOpen] = useState<string | null>(null);
  const [subsetOpen, setSubsetOpen] = useState(false);
  const [subsetName, setSubsetName] = useState("");
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdApps, setHoldApps] = useState<string[]>([]);
  const [holdName, setHoldName] = useState("Giấu app");
  const [busy, setBusy] = useState(false);

  const st = stats.data;
  const apply = () => {
    setFilter(clean(draft));
    setOffset(0);
  };
  const clickFacet = (key: "scenario" | "apps" | "city", v: string) => {
    const nf = { ...draft, [key]: [v] };
    setDraft(nf);
    setFilter(clean(nf));
    setOffset(0);
  };

  const makeSubset = async () => {
    setBusy(true);
    try {
      const r = await api.createSubset(id, { name: subsetName || "Tập con", filter });
      toast.success(`Đã tạo tập con ${r.id} (${r.n} mẫu)`);
      qc.invalidateQueries({ queryKey: ["datasets"] });
      setSubsetOpen(false);
      nav(`/datasets/${r.id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const makeHoldout = async () => {
    setBusy(true);
    try {
      const r = await api.createHoldout(id, { apps: holdApps, name: holdName });
      toast.success(`Đã tạo: tập giấu app ${r.holdout} và phần còn lại ${r.rest}`);
      qc.invalidateQueries({ queryKey: ["datasets"] });
      setHoldOpen(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  const appOpts = Object.keys(st?.label_apps ?? {});
  const allApps = Array.from(new Set([...appOpts, ...Object.keys(st?.installed_apps ?? {})]));
  return (
    <div className="space-y-4">
      <PageHeader
        title={
          <span>
            Dataset <span className="font-mono">{id}</span>
          </span>
        }
        subtitle={ds ? `${ds.name} · ${ds.kind}${ds.parent_id ? ` · từ ${ds.parent_id}` : ""}${ds.notes ? ` · ${ds.notes}` : ""}` : undefined}
        actions={
          <>
            {ds?.kind === "synthetic" && (
              <Link to={`/studio/review/${id}`}>
                <Button>Duyệt dữ liệu</Button>
              </Link>
            )}
            <Button icon={<Scissors className="h-4 w-4" />} onClick={() => setSubsetOpen(true)}>
              Tạo tập con từ bộ lọc
            </Button>
            <Button icon={<EyeOff className="h-4 w-4" />} onClick={() => setHoldOpen(true)}>
              Tạo tập giấu app
            </Button>
          </>
        }
      />
      {stats.isLoading ? (
        <Loading />
      ) : stats.error ? (
        <ErrorBox error={stats.error} />
      ) : st ? (
        <>
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge color="blue">{st.n} mẫu</Badge>
            <Badge color="green">{st.labeled} có nhãn</Badge>
            {st.new_app > 0 && <Badge color="purple">{st.new_app} có app mới</Badge>}
            {st.public_only_app > 0 && <Badge color="orange">{st.public_only_app} có app chỉ ở public_test</Badge>}
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Kịch bản" subtitle="Bấm cột để lọc">
              <CountBars data={st.scenario} horizontal onClick={(k) => clickFacet("scenario", k)} />
            </Card>
            <Card title="Số lượt history">
              <CountBars data={st.hist_turns} />
            </Card>
            <Card title="Số tool call trong nhãn">
              <CountBars data={st.n_calls} />
            </Card>
            <Card title="App trong nhãn (top 20)" subtitle="Bấm cột để lọc">
              <CountBars data={st.label_apps} horizontal top={20} onClick={(k) => clickFacet("apps", k)} />
            </Card>
            <Card title="App đã cài (top 20)">
              <CountBars data={st.installed_apps} horizontal top={20} />
            </Card>
            <Card title="Thành phố" subtitle="Bấm cột để lọc">
              <CountBars data={st.city} horizontal onClick={(k) => clickFacet("city", k)} />
            </Card>
          </div>
        </>
      ) : null}

      <Card title="Mẫu" bodyClass="p-0">
        <div className="grid gap-2 border-b border-slate-200 p-3 dark:border-slate-800 md:grid-cols-2 xl:grid-cols-6">
          <Field label="Kịch bản" className="xl:col-span-1">
            <MultiSelect value={draft.scenario ?? []} onChange={(v) => setDraft({ ...draft, scenario: v })} options={Object.keys(st?.scenario ?? {})} placeholder="Tất cả" />
          </Field>
          <Field label="App (nhãn hoặc đã cài)" className="xl:col-span-2">
            <MultiSelect value={draft.apps ?? []} onChange={(v) => setDraft({ ...draft, apps: v })} options={allApps} placeholder="Tất cả" />
          </Field>
          <Field label="Lượt history">
            <div className="flex gap-1">
              <NumberInput value={draft.hist_min ?? null} onChange={(v) => setDraft({ ...draft, hist_min: v })} placeholder="từ" />
              <NumberInput value={draft.hist_max ?? null} onChange={(v) => setDraft({ ...draft, hist_max: v })} placeholder="đến" />
            </div>
          </Field>
          <Field label="App mới">
            <Select
              value={draft.new_app === undefined || draft.new_app === null ? "" : String(draft.new_app)}
              onChange={(v) => setDraft({ ...draft, new_app: v === "" ? null : v === "true" })}
              placeholder="Tất cả"
              options={[
                { value: "true", label: "Có app mới" },
                { value: "false", label: "Không" },
              ]}
            />
          </Field>
          <Field label="Tìm văn bản / ID">
            <Input value={draft.text ?? ""} onChange={(e) => setDraft({ ...draft, text: e.target.value })} onKeyDown={(e) => e.key === "Enter" && apply()} placeholder="vd: báo thức" />
          </Field>
          <div className="flex items-end gap-2 xl:col-span-6">
            <Button variant="primary" icon={<Filter className="h-3.5 w-3.5" />} onClick={apply}>
              Lọc
            </Button>
            <Button
              onClick={() => {
                setDraft({});
                setFilter({});
                setOffset(0);
              }}
            >
              Xoá lọc
            </Button>
            {(filter.city?.length ?? 0) > 0 && <Badge>thành phố: {filter.city!.join(", ")}</Badge>}
            <div className="ml-auto">{samples.data && <Pager offset={offset} limit={LIMIT} total={samples.data.total} onChange={setOffset} />}</div>
          </div>
        </div>
        {samples.isLoading ? (
          <Loading />
        ) : samples.error ? (
          <ErrorBox error={samples.error} />
        ) : !samples.data?.rows.length ? (
          <div className="p-3">
            <Empty>Không có mẫu khớp bộ lọc.</Empty>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Câu yêu cầu</th>
                  <th>Kịch bản</th>
                  <th>App trong nhãn</th>
                  <th className="text-right">History</th>
                  <th className="text-right">Số call</th>
                </tr>
              </thead>
              <tbody>
                {samples.data.rows.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => setOpen(r.id)}>
                    <td className="whitespace-nowrap font-mono text-xs">{r.id}</td>
                    <td className="min-w-[300px]">{r.text ?? <span className="italic text-slate-400">(chỉ có audio)</span>}</td>
                    <td className="text-xs">{r.scenario ?? "—"}</td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        {(r.label_apps ?? []).map((a) => (
                          <Badge key={a}>{a}</Badge>
                        ))}
                        {r.new_app && <Badge color="purple">app mới</Badge>}
                      </div>
                    </td>
                    <td className="text-right font-mono">{r.hist_turns}</td>
                    <td className="text-right font-mono">{r.n_calls ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Duplicates ds={id} onOpen={setOpen} />

      {open && <SampleDrawer ds={id} sid={open} onClose={() => setOpen(null)} />}
      <Modal
        open={subsetOpen}
        onClose={() => setSubsetOpen(false)}
        title="Tạo tập con từ bộ lọc hiện tại"
        width="max-w-md"
        footer={
          <Button variant="primary" onClick={makeSubset} loading={busy}>
            Tạo ({samples.data?.total ?? 0} mẫu)
          </Button>
        }
      >
        <div className="space-y-3">
          <Field label="Tên tập con">
            <Input value={subsetName} onChange={(e) => setSubsetName(e.target.value)} placeholder="vd: train — đọc rồi ghi" autoFocus />
          </Field>
          <div className="text-xs text-slate-500">Bộ lọc đang áp dụng:</div>
          <JsonView data={filter} openDepth={2} />
        </div>
      </Modal>
      <Modal
        open={holdOpen}
        onClose={() => setHoldOpen(false)}
        title="Tạo tập giấu app"
        footer={
          <Button variant="primary" onClick={makeHoldout} loading={busy} disabled={!holdApps.length}>
            Tạo
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="text-sm text-slate-600 dark:text-slate-300">
            Tách dataset thành hai tập con: các mẫu có dùng những app được chọn (để đánh giá khả năng tổng quát với app “mới”) và phần còn lại (để
            huấn luyện / chỉnh prompt).
          </div>
          <Field label="App cần giấu">
            <MultiSelect value={holdApps} onChange={setHoldApps} options={appOpts} />
          </Field>
          <Field label="Tên">
            <Input value={holdName} onChange={(e) => setHoldName(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}

function clean(f: SampleFilter): SampleFilter {
  const o: SampleFilter = {};
  if (f.scenario?.length) o.scenario = f.scenario;
  if (f.apps?.length) o.apps = f.apps;
  if (f.city?.length) o.city = f.city;
  if (f.hist_min !== undefined && f.hist_min !== null) o.hist_min = f.hist_min;
  if (f.hist_max !== undefined && f.hist_max !== null) o.hist_max = f.hist_max;
  if (f.new_app !== undefined && f.new_app !== null) o.new_app = f.new_app;
  if (f.text?.trim()) o.text = f.text.trim();
  return o;
}
