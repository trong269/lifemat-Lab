import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CopyPlus, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { CodeEditor } from "../components/CodeEditor";
import { useToast } from "../components/Toast";
import { Button, Card, Empty, ErrorBox, Field, Input, Loading, Modal, PageHeader } from "../components/ui";
import { usePrompts } from "../lib/hooks";

export default function Prompts() {
  const list = usePrompts();
  const [sel, setSel] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const qc = useQueryClient();
  useEffect(() => {
    if (!sel && list.data?.length) setSel(list.data[0].name);
  }, [list.data, sel]);
  const q = useQuery({ queryKey: ["prompt", sel], queryFn: () => api.prompt(sel!), enabled: !!sel });
  useEffect(() => {
    if (q.data) {
      setText(q.data.text);
      setDirty(false);
    }
  }, [q.data]);
  const save = async (name: string) => {
    setBusy(true);
    try {
      await api.savePrompt(name, text);
      toast.success(`Đã lưu bộ luật ${name}`);
      await qc.invalidateQueries({ queryKey: ["prompts"] });
      qc.invalidateQueries({ queryKey: ["meta"] });
      qc.invalidateQueries({ queryKey: ["prompt", name] });
      setSel(name);
      setDirty(false);
      setNewOpen(false);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };
  const pick = (n: string) => {
    if (dirty && !confirm("Bỏ các thay đổi chưa lưu?")) return;
    setSel(n);
  };
  return (
    <div className="space-y-4">
      <PageHeader title="Bộ luật (prompt)" subtitle="Các file agent_core/prompts/*.md — luật hành vi đưa vào system prompt của agent" />
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <Card title="Danh sách" bodyClass="p-1.5">
          {list.isLoading ? (
            <Loading />
          ) : list.error ? (
            <ErrorBox error={list.error} />
          ) : !list.data?.length ? (
            <Empty>Chưa có bộ luật.</Empty>
          ) : (
            list.data.map((p) => (
              <button
                key={p.name}
                onClick={() => pick(p.name)}
                className={clsx(
                  "flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm",
                  sel === p.name ? "bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-200" : "hover:bg-slate-100 dark:hover:bg-white/5",
                )}
              >
                <span className="font-mono text-xs">{p.name}</span>
                <span className="text-[11px] text-slate-500">{p.chars} ký tự</span>
              </button>
            ))
          )}
        </Card>
        <Card
          title={sel ? <span className="font-mono">{sel}.md</span> : "Chọn bộ luật"}
          subtitle={dirty ? "Có thay đổi chưa lưu" : undefined}
          actions={
            sel && (
              <>
                <Button size="xs" icon={<CopyPlus className="h-3.5 w-3.5" />} onClick={() => (setNewName(`${sel}_v2`), setNewOpen(true))}>
                  Lưu thành phiên bản mới
                </Button>
                <Button size="xs" variant="primary" icon={<Save className="h-3.5 w-3.5" />} onClick={() => sel && save(sel)} loading={busy} disabled={!dirty}>
                  Lưu
                </Button>
              </>
            )
          }
        >
          {q.isLoading ? (
            <Loading />
          ) : q.error ? (
            <ErrorBox error={q.error} />
          ) : sel ? (
            <CodeEditor value={text} onChange={(v) => (setText(v), setDirty(true))} lang="markdown" height="calc(100vh - 230px)" />
          ) : null}
        </Card>
      </div>
      <Modal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="Lưu thành phiên bản mới"
        width="max-w-md"
        footer={
          <Button variant="primary" onClick={() => save(newName)} loading={busy} disabled={!/^[a-zA-Z0-9_-]{1,60}$/.test(newName)}>
            Lưu
          </Button>
        }
      >
        <Field label="Tên bộ luật mới" hint="Chỉ gồm chữ, số, _ và - (tối đa 60 ký tự)">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </div>
  );
}
