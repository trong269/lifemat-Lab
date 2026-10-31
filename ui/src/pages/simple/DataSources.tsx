/* Dữ liệu: khai báo đường dẫn tới dữ liệu BTC (nằm ngoài repo) + import file dự đoán ASR / LLM do thành viên khác gửi. */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileUp, FolderOpen, Mic, Bot, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useToast } from "../../components/Toast";
import { Badge, Button, Card, Checkbox, Empty, Field, Input, Loading, Notice, PageHeader, Select, StatusBadge } from "../../components/ui";
import { fmtAgo, fmtScore } from "../../lib/format";
import { useDatasets } from "../../lib/hooks";

/** Chọn file từ máy, hoặc nhập đường dẫn file trên máy chủ (file lớn / đã có sẵn trên máy). */
function FileOrPath({ file, setFile, path, setPath }: { file: File | null; setFile: (f: File | null) => void; path: string; setPath: (p: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <input ref={ref} type="file" accept=".jsonl,.json,.txt" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <Button icon={<FileUp className="h-4 w-4" />} onClick={() => ref.current?.click()}>
          Chọn file
        </Button>
        <span className="muted text-sm">{file ? `${file.name} (${(file.size / 1e6).toFixed(1)} MB)` : "chưa chọn file"}</span>
        {file && (
          <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
            bỏ chọn
          </Button>
        )}
      </div>
      <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="…hoặc đường dẫn file trên máy chạy platform, vd /home/me/train_pred.jsonl" disabled={!!file} />
    </div>
  );
}

function Sources() {
  const qc = useQueryClient();
  const toast = useToast();
  const src = useQuery({ queryKey: ["data-sources"], queryFn: api.dataSources });
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["data-sources"] });
    qc.invalidateQueries({ queryKey: ["datasets"] });
  };
  const add = async () => {
    if (!path.trim()) return toast.error("Hãy nhập đường dẫn");
    setBusy(true);
    try {
      const r = await api.addDataSource(path.trim());
      toast.success(
        `Đã thêm: ${r.splits.join(", ")}` + (r.added.length ? ` · mới: ${r.added.join(", ")}` : "") + (r.moved.length ? ` · cập nhật đường dẫn: ${r.moved.join(", ")}` : ""),
      );
      setPath("");
      refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    if (!confirm("Gỡ nguồn này? Dataset thuộc nguồn sẽ bị gỡ khỏi platform (file trên đĩa và kết quả các lần chạy vẫn giữ nguyên).")) return;
    try {
      await api.removeDataSource(id);
      refresh();
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><FolderOpen className="h-4 w-4" /> Nguồn dữ liệu</span>} bodyClass="p-4 space-y-3">
      <p className="muted text-sm">
        Dữ liệu BTC (train, public_test, private_test) nằm ngoài code. Nhập đường dẫn tới thư mục chứa các split (vd thư mục giải nén gói dữ liệu)
        hoặc tới chính một split. Dữ liệu chỉ được đọc tại chỗ, không sao chép vào platform.
      </p>
      <div className="flex gap-2">
        <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/đường/dẫn/tới/train+public_test" onKeyDown={(e) => e.key === "Enter" && add()} />
        <Button variant="primary" loading={busy} onClick={add}>
          Thêm
        </Button>
      </div>
      {src.isLoading ? (
        <Loading />
      ) : !src.data?.sources.length ? (
        <Notice color="yellow">Chưa có nguồn dữ liệu nào. Thêm đường dẫn tới dữ liệu BTC để bắt đầu.</Notice>
      ) : (
        <div className="divide-y divide-slate-100 rounded-md border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
          {src.data.sources.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="break-all font-mono text-xs">{s.path}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {!s.exists && <Badge color="red">không tìm thấy thư mục</Badge>}
                  {s.datasets.map((d) => (
                    <Badge key={d} color="blue">
                      {d}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => remove(s.id)}>
                Gỡ
              </Button>
            </div>
          ))}
        </div>
      )}
      {src.data && !src.data.train_root && <Notice color="yellow">Chưa thấy split <b>train</b>: phần Tạo dữ liệu và App Factory cần train làm dữ liệu mẫu.</Notice>}
    </Card>
  );
}

function ImportAsr() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Awaited<ReturnType<typeof api.importAsr>> | null>(null);
  const submit = async () => {
    if (!name.trim()) return toast.error("Hãy đặt tên cho bộ transcript (vd 'ASR đội — Whisper v3')");
    if (!file && !path.trim()) return toast.error("Hãy chọn file hoặc nhập đường dẫn");
    const fd = new FormData();
    fd.append("name", name.trim());
    if (file) fd.append("file", file);
    else fd.append("path", path.trim());
    setBusy(true);
    try {
      const r = await api.importAsr(fd);
      setRes(r);
      qc.invalidateQueries({ queryKey: ["models"] });
      qc.invalidateQueries({ queryKey: ["imports"] });
      toast.success(`Đã import ${r.records} bản ghi`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const measure = async (dataset: string) => {
    if (!res) return;
    try {
      const r = await api.startRun({
        config: { mode: "asr_only", dataset, asr_model: res.model_id, workers: 4, name: `WER — ${name}` } as never,
        name: `WER — ${name}`,
      });
      nav(`/evaluate/${r.id}`);
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><Mic className="h-4 w-4" /> Import dự đoán ASR</span>} bodyClass="p-4 space-y-3">
      <p className="muted text-sm">
        File JSONL, mỗi dòng một mẫu: <code className="text-xs">{`{"id": "train_0001", "asr_text": "...", "history": [{"role": "user", "asr_text": "..."}, ...]}`}</code>.
        Lượt user thứ k trong <code className="text-xs">history</code> ứng với audio history thứ k. Cũng nhận dạng mỗi dòng một file audio:{" "}
        <code className="text-xs">{`{"audio": "audio/<id>/<id>_u1.wav", "text": "..."}`}</code>. Sau khi import, bộ transcript xuất hiện như một model nhận dạng giọng
        nói trong mục Đánh giá.
      </p>
      <Field label="Tên">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="vd ASR đội — Whisper large v3 (train)" />
      </Field>
      <FileOrPath file={file} setFile={setFile} path={path} setPath={setPath} />
      <Button variant="primary" loading={busy} onClick={submit}>
        Import
      </Button>
      {res && (
        <Notice color="green">
          <div>
            Đã tạo model nhận dạng giọng nói <b>{res.model_id}</b> ({res.records} bản ghi).
          </div>
          <div className="mt-2 space-y-1">
            {res.coverage.map((c) => (
              <div key={c.dataset_id} className="flex flex-wrap items-center gap-2">
                <Badge color="blue">{c.dataset_id}</Badge>
                <span>
                  khớp {c.matched}/{c.n} mẫu, đủ mọi lượt {c.complete}/{c.n}
                </span>
                <Button size="sm" onClick={() => measure(c.dataset_id)}>
                  Đo WER trên {c.dataset_id}
                </Button>
              </div>
            ))}
          </div>
        </Notice>
      )}
    </Card>
  );
}

function ImportLlm() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const datasets = useDatasets();
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [ds, setDs] = useState("");
  const [zero, setZero] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name.trim()) return toast.error("Hãy đặt tên (vd 'Qwen3.5-4B SFT v2 — máy A')");
    if (!file && !path.trim()) return toast.error("Hãy chọn file hoặc nhập đường dẫn");
    const fd = new FormData();
    fd.append("name", name.trim());
    if (ds) fd.append("dataset_id", ds);
    fd.append("missing_as_zero", String(zero));
    if (file) fd.append("file", file);
    else fd.append("path", path.trim());
    setBusy(true);
    try {
      const r = await api.importLlm(fd);
      qc.invalidateQueries({ queryKey: ["imports"] });
      qc.invalidateQueries({ queryKey: ["runs"] });
      toast.success(`Đang chấm ${r.scored} mẫu của ${r.dataset_id}` + (r.missing && !zero ? ` (file thiếu ${r.missing} mẫu, không tính)` : ""));
      nav(`/evaluate/${r.run_id}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const opts = (datasets.data ?? []).filter((d) => d.kind !== "subset").map((d) => ({ value: d.id, label: `${d.name} (${d.n} mẫu)` }));
  return (
    <Card title={<span className="flex items-center gap-2"><Bot className="h-4 w-4" /> Import dự đoán LLM / kết quả nộp</span>} bodyClass="p-4 space-y-3">
      <p className="muted text-sm">
        File dạng submission của BTC, mỗi dòng <code className="text-xs">{`{"id", "tool_calls", "state_hash"}`}</code>. Platform chạy lại tool_calls trên bộ mô phỏng
        như BTC, tính state_hash rồi chấm điểm (nếu dataset có nhãn) — kết quả xem giống một lần đánh giá bình thường. Mẫu có state_hash trong file khác với
        lúc chạy lại được đánh dấu.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Tên">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="vd Qwen3.5-4B SFT v2 — máy A" />
        </Field>
        <Field label="Dataset" hint="Để trống: tự đoán theo id trong file">
          <Select value={ds} onChange={setDs} options={opts} placeholder="(tự đoán)" />
        </Field>
      </div>
      <FileOrPath file={file} setFile={setFile} path={path} setPath={setPath} />
      <Checkbox checked={zero} onChange={setZero} label="Mẫu không có trong file tính 0 điểm (kiểm tra một file nộp đầy đủ)" />
      <div>
        <Button variant="primary" loading={busy} onClick={submit}>
          Import & chấm
        </Button>
      </div>
    </Card>
  );
}

function ImportsList() {
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ["imports"], queryFn: api.imports, refetchInterval: 5000 });
  if (q.isLoading) return <Loading />;
  const d = q.data;
  const delAsr = async (id: string) => {
    if (!confirm(`Xoá bộ transcript ${id}? (các lần chạy đã dùng nó vẫn giữ kết quả)`)) return;
    try {
      await api.deleteAsrImport(id);
      qc.invalidateQueries({ queryKey: ["imports"] });
      qc.invalidateQueries({ queryKey: ["models"] });
    } catch (e) {
      toast.error(e);
    }
  };
  return (
    <Card title="Đã import" bodyClass="p-4 space-y-4">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Transcript ASR</div>
        {!d?.asr.length ? (
          <Empty>Chưa có.</Empty>
        ) : (
          d.asr.map((m) => (
            <div key={m.id} className="flex items-center gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0 dark:border-slate-800">
              <span className="font-medium">{m.name}</span>
              <span className="muted font-mono text-xs">{m.id}</span>
              <span className="muted flex-1 text-xs">{m.notes}</span>
              <Button size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} onClick={() => delAsr(m.id)} />
            </div>
          ))
        )}
      </div>
      <div>
        <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Kết quả LLM</div>
        {!d?.llm.length ? (
          <Empty>Chưa có.</Empty>
        ) : (
          d.llm.map((r) => (
            <Link
              key={r.id}
              to={`/evaluate/${r.id}`}
              className="flex items-center gap-2 border-b border-slate-100 py-1.5 text-sm last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-white/5"
            >
              <span className="font-medium">{r.name}</span>
              <Badge color="blue">{r.dataset_id}</Badge>
              <StatusBadge status={r.status} />
              <span className="flex-1 text-xs text-slate-500">
                {r.done}/{r.total} mẫu · {fmtAgo(r.created)}
              </span>
              <span className="font-semibold">{fmtScore(r.score)}</span>
            </Link>
          ))
        )}
      </div>
    </Card>
  );
}

export default function DataSources() {
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <PageHeader title="Dữ liệu" subtitle="Đường dẫn tới dữ liệu BTC, và kết quả dự đoán do thành viên khác chạy trên máy khác" />
      <Sources />
      <div className="grid gap-4 lg:grid-cols-2">
        <ImportAsr />
        <ImportLlm />
      </div>
      <ImportsList />
    </div>
  );
}
