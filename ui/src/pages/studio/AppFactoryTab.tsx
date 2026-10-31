import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, FilePlus2, FlaskConical, Sparkles, Trash2, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { api, Json } from "../../api";
import { CodeEditor, JsonEditor } from "../../components/CodeEditor";
import { JobProgress } from "../../components/JobProgress";
import { CallView, JsonView } from "../../components/JsonView";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, Collapsible, Empty, ErrorBox, Field, Input, Loading, Modal, Notice, Select, StatusBadge, Tabs } from "../../components/ui";
import { fmtTime } from "../../lib/format";
import { useMeta, useModels } from "../../lib/hooks";

function Report({ report }: { report: Json }) {
  if (!report) return <div className="text-xs text-slate-500">Chưa kiểm thử.</div>;
  const val: string[] = report.validation ?? [];
  const errs: string[] = report.errors ?? [];
  return (
    <div className="space-y-2">
      <div>{!val.length && report.passed ? <Badge color="green">đạt kiểm thử</Badge> : <Badge color="red">chưa đạt</Badge>}</div>
      {val.length > 0 && (
        <div>
          <div className="text-xs font-semibold">Lỗi kiểm tra cấu trúc</div>
          <ul className="list-disc pl-5 text-xs text-red-600 dark:text-red-400">
            {val.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {errs.length > 0 && (
        <div>
          <div className="text-xs font-semibold">Lỗi chạy thử</div>
          <ul className="list-disc pl-5 text-xs text-red-600 dark:text-red-400">
            {errs.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {(report.calls ?? []).length > 0 && (
        <div className="space-y-1">
          {report.calls.map((c: Json, i: number) => (
            <div key={i} className={clsx("rounded border p-1.5", c.ok ? "border-emerald-200 dark:border-emerald-900" : "border-red-300 dark:border-red-900")}>
              <div className="flex items-start gap-1.5">
                {c.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />}
                <CallView call={c.call} />
              </div>
              <JsonView data={c.result} openDepth={0} className="mt-1" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AppEditor({ rid, onChanged }: { rid: string; onChanged: () => void }) {
  const q = useQuery({ queryKey: ["gen-app", rid], queryFn: () => api.app(rid) });
  const toast = useToast();
  const [appId, setAppId] = useState("");
  const [spec, setSpec] = useState<Json>({});
  const [code, setCode] = useState("");
  const [example, setExample] = useState<Json>({});
  const [tests, setTests] = useState<Json>([]);
  const [valid, setValid] = useState<Record<string, boolean>>({});
  const [report, setReport] = useState<Json>(null);
  const [tab, setTab] = useState<"spec" | "code" | "state" | "tests">("spec");
  const [busy, setBusy] = useState<string | null>(null);
  const a = q.data;
  useEffect(() => {
    if (!a) return;
    const full = a.spec ?? {};
    setAppId(full.app_id ?? a.app_id ?? "");
    setSpec(full.spec ?? {});
    setCode(full.code ?? a.code ?? "");
    setExample(full.example_state ?? a.example_state ?? {});
    setTests(full.test_calls ?? []);
    setReport(a.test_report);
    setValid({});
  }, [a]);
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  if (!a) return null;
  const approved = a.status === "approved";
  const save = async () => {
    setBusy("save");
    try {
      const r = await api.saveApp(rid, { app_id: appId, spec, code, example_state: example, test_calls: tests });
      setReport(r);
      toast[!(r.validation ?? []).length && r.passed ? "success" : "info"](!(r.validation ?? []).length && r.passed ? "Đã lưu — đạt kiểm thử" : "Đã lưu — chưa đạt kiểm thử");
      await q.refetch();
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const approve = async (v: boolean) => {
    setBusy("approve");
    try {
      await api.approveApp(rid, v);
      toast.success(v ? "Đã duyệt app — có thể dùng trong công thức (extra_apps)" : "Đã bỏ duyệt");
      await q.refetch();
      onChanged();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };
  const del = async () => {
    if (!confirm("Xoá app này?")) return;
    try {
      await api.deleteApp(rid);
      toast.success("Đã xoá");
      onChanged();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label="app_id" className="w-56">
          <Input value={appId} onChange={(e) => setAppId(e.target.value)} className="font-mono" />
        </Field>
        <StatusBadge status={a.status} />
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button variant="primary" icon={<FlaskConical className="h-4 w-4" />} onClick={save} loading={busy === "save"} disabled={!Object.values(valid).every(Boolean) || approved} title={approved ? "Bỏ duyệt trước khi sửa" : undefined}>
            Lưu & kiểm thử
          </Button>
          {approved ? (
            <Button onClick={() => approve(false)} loading={busy === "approve"}>
              Bỏ duyệt
            </Button>
          ) : (
            <Button variant="success" onClick={() => approve(true)} loading={busy === "approve"}>
              Duyệt
            </Button>
          )}
          <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={del} disabled={approved} title="Xoá" />
        </div>
      </div>
      {a.notes && <div className="text-xs text-slate-500">Ý tưởng: {a.notes}</div>}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: "spec", label: "Spec (catalog)" },
          { value: "code", label: "Code Python" },
          { value: "state", label: "State mẫu" },
          { value: "tests", label: "Call kiểm thử", count: Array.isArray(tests) ? tests.length : undefined },
        ]}
      />
      <div className={tab === "spec" ? "" : "hidden"}>
        <JsonEditor value={spec} onChange={setSpec} onValidity={(ok) => setValid((v) => ({ ...v, spec: ok }))} height="420px" resetKey={a} />
      </div>
      <div className={tab === "code" ? "" : "hidden"}>
        <CodeEditor value={code} onChange={setCode} lang="python" height="420px" />
      </div>
      <div className={tab === "state" ? "" : "hidden"}>
        <JsonEditor value={example} onChange={setExample} onValidity={(ok) => setValid((v) => ({ ...v, state: ok }))} height="420px" resetKey={a} />
      </div>
      <div className={tab === "tests" ? "" : "hidden"}>
        <JsonEditor value={tests} onChange={setTests} onValidity={(ok) => setValid((v) => ({ ...v, tests: ok }))} height="420px" resetKey={a} />
      </div>
      <Collapsible title="Báo cáo kiểm thử" defaultOpen>
        <Report report={report} />
      </Collapsible>
    </div>
  );
}

const TEMPLATE_CODE = `from .base import App, read, write


class MyApp(App):
    name = "my_app"

    @read
    def list_items(self, **_):
        return self.read("items")

    @write
    def add_item(self, name=None, **_):
        return self.create("items", "item", name=name)
`;

function ManualCreate({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [appId, setAppId] = useState("my_app");
  const [notes, setNotes] = useState("");
  const [spec, setSpec] = useState<Json>({
    id: "my_app",
    name_vi: "App của tôi",
    group: "other",
    description: "",
    tools: [
      { name: "my_app.list_items", kind: "read", description: "Danh sách", parameters: { type: "object", properties: {}, required: [] }, returns: "", app: "my_app" },
      {
        name: "my_app.add_item",
        kind: "write",
        description: "Thêm",
        parameters: { type: "object", properties: { name: { type: "string", "x-match": "fuzzy" } }, required: ["name"] },
        returns: "",
        app: "my_app",
      },
    ],
  });
  const [code, setCode] = useState(TEMPLATE_CODE);
  const [example, setExample] = useState<Json>({ items: [{ id: "item_01", name: "Ví dụ" }] });
  const [tests, setTests] = useState<Json>([
    { name: "my_app.list_items", arguments: {} },
    { name: "my_app.add_item", arguments: { name: "Mới" } },
  ]);
  const [valid, setValid] = useState<Record<string, boolean>>({});
  const [tab, setTab] = useState<"spec" | "code" | "state" | "tests">("spec");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createApp({ app_id: appId, spec, code, example_state: example, test_calls: tests }, notes);
      const rep = r.report ?? {};
      const ok = !(rep.validation ?? []).length && rep.passed;
      toast[ok ? "success" : "info"](ok ? "Đã tạo app nháp — đạt kiểm thử" : "Đã tạo app nháp — chưa đạt kiểm thử");
      onCreated(r.id);
      onClose();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Tạo app thủ công"
      width="max-w-4xl"
      footer={
        <>
          <Button onClick={onClose}>Huỷ</Button>
          <Button variant="primary" icon={<FlaskConical className="h-4 w-4" />} onClick={create} loading={busy} disabled={!appId || !Object.values(valid).every(Boolean)}>
            Tạo & kiểm thử
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="app_id" hint="snake_case; không trùng app train / public_test">
            <Input value={appId} onChange={(e) => setAppId(e.target.value.trim())} className="font-mono" />
          </Field>
          <Field label="Ghi chú / ý tưởng">
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "spec", label: "Spec (catalog)" },
            { value: "code", label: "Code Python" },
            { value: "state", label: "State mẫu" },
            { value: "tests", label: "Call kiểm thử" },
          ]}
        />
        <div className={tab === "spec" ? "" : "hidden"}>
          <JsonEditor value={spec} onChange={setSpec} onValidity={(ok) => setValid((v) => ({ ...v, spec: ok }))} height="360px" />
        </div>
        <div className={tab === "code" ? "" : "hidden"}>
          <CodeEditor value={code} onChange={setCode} lang="python" height="360px" />
        </div>
        <div className={tab === "state" ? "" : "hidden"}>
          <JsonEditor value={example} onChange={setExample} onValidity={(ok) => setValid((v) => ({ ...v, state: ok }))} height="360px" />
        </div>
        <div className={tab === "tests" ? "" : "hidden"}>
          <JsonEditor value={tests} onChange={setTests} onValidity={(ok) => setValid((v) => ({ ...v, tests: ok }))} height="360px" />
        </div>
      </div>
    </Modal>
  );
}

export default function AppFactoryTab() {
  const meta = useMeta();
  const models = useModels();
  const toast = useToast();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["gen-apps"], queryFn: api.apps });
  const [idea, setIdea] = useState("");
  const [model, setModel] = useState("");
  const [job, setJob] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (sel && list.data && !list.data.find((a) => a.id === sel)) setSel(null);
  }, [list.data, sel]);
  const generate = async () => {
    try {
      const r = await api.generateApp(idea, model);
      setJob(r.job_id);
      toast.success("Teacher đang thiết kế app…");
    } catch (e) {
      toast.error(e);
    }
  };
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["gen-apps"] });
    qc.invalidateQueries({ queryKey: ["catalog-apps"] });
  };
  return (
    <div className="space-y-4">
      <Card title="Tạo app mới bằng teacher" subtitle="Teacher viết spec catalog + code Python trên base.App + state mẫu + call kiểm thử, sau đó tự chạy kiểm thử">
        <div className="space-y-3">
          <Notice color="yellow">11 app chỉ có ở public_test và các app đã có trong train đều bị chặn (không được tạo lại / dùng để sinh dữ liệu).</Notice>
          <div className="grid gap-2 md:grid-cols-[2fr_1fr_auto]">
            <Field label="Ý tưởng app">
              <Input list="app-ideas" value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="vd: đặt phòng khách sạn" />
              <datalist id="app-ideas">
                {(meta.data?.app_ideas ?? []).map((x) => (
                  <option key={x} value={x} />
                ))}
              </datalist>
            </Field>
            <Field label="Model teacher">
              <Select value={model} onChange={setModel} placeholder="Chọn model…" options={(models.data ?? []).filter((m) => m.role === "llm" && m.id !== "oracle").map((m) => m.id)} />
            </Field>
            <div className="flex items-end">
              <Button variant="primary" icon={<Sparkles className="h-4 w-4" />} onClick={generate} disabled={!idea || !model}>
                Tạo app
              </Button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {(meta.data?.app_ideas ?? []).map((x) => (
              <button key={x} onClick={() => setIdea(x)} className="rounded-full border border-slate-200 px-2 py-0.5 text-xs hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-white/5">
                {x}
              </button>
            ))}
          </div>
          {job && (
            <div className="space-y-1">
              <JobProgress id={job} />
              <Button size="xs" onClick={refresh}>
                Tải lại danh sách app
              </Button>
            </div>
          )}
        </div>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card
          title="App đã tạo"
          actions={
            <Button size="xs" icon={<FilePlus2 className="h-3.5 w-3.5" />} onClick={() => setManual(true)}>
              Tạo thủ công
            </Button>
          }
          bodyClass="p-0"
        >
          {list.isLoading ? (
            <Loading />
          ) : list.error ? (
            <ErrorBox error={list.error} />
          ) : !list.data?.length ? (
            <div className="p-3">
              <Empty>Chưa có app nào.</Empty>
            </div>
          ) : (
            <div className="max-h-[700px] overflow-y-auto">
              {list.data.map((a) => {
                const rep = a.test_report ?? {};
                const ok = !(rep.validation ?? []).length && rep.passed;
                return (
                  <button
                    key={a.id}
                    onClick={() => setSel(a.id)}
                    className={clsx(
                      "flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left dark:border-slate-800/70",
                      sel === a.id ? "bg-accent-50 dark:bg-accent-900/30" : "hover:bg-slate-50 dark:hover:bg-white/[0.03]",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm">{a.app_id ?? "(chưa có app_id)"}</div>
                      <div className="truncate text-[11px] text-slate-500">
                        {a.notes ? `${a.notes} · ` : ""}
                        {fmtTime(a.updated)}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <StatusBadge status={a.status} />
                      {ok ? <Badge color="green">đạt</Badge> : <Badge color="red">{((rep.validation ?? []).length + (rep.errors ?? []).length) || "chưa"} lỗi</Badge>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </Card>
        <Card title="Chi tiết app">{sel ? <AppEditor key={sel} rid={sel} onChanged={refresh} /> : <Empty>Chọn một app để xem / sửa.</Empty>}</Card>
      </div>
      {manual && (
        <ManualCreate
          open
          onClose={() => setManual(false)}
          onCreated={(id) => {
            refresh();
            setSel(id);
          }}
        />
      )}
    </div>
  );
}
