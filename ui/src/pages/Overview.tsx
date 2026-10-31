import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Circle, FlaskConical, TerminalSquare, Wand2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api";
import { Badge, Button, Card, Empty, ErrorBox, Loading, PageHeader, ProgressLabel, Stat, StatusBadge } from "../components/ui";
import { fmtAgo, fmtCost, fmtScore } from "../lib/format";

export default function Overview() {
  const nav = useNavigate();
  const q = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 5000 });
  const models = useQuery({ queryKey: ["models"], queryFn: () => api.models() });
  const runs = useQuery({ queryKey: ["runs"], queryFn: api.runs });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorBox error={q.error} />;
  const o = q.data!;
  const hasKey = o.providers.some((p) => p.key !== "chưa có");
  const hasModel = (models.data ?? []).some((m) => m.source !== "builtin" && m.role === "llm");
  const ranTrain = (runs.data ?? []).some((r) => r.dataset_id === "train" && r.status === "done" && r.llm_model !== "oracle");
  const steps = [
    { ok: hasKey, label: "Nhập khoá API cho ít nhất một nhà cung cấp", to: "/models" },
    { ok: hasModel, label: "Thêm một model LLM vào registry", to: "/models" },
    { ok: ranTrain, label: "Chạy thử nghiệm trên tập train (gold-asr) với model đó", to: "/experiments/new" },
  ];
  return (
    <div className="space-y-4">
      <PageHeader
        title="Tổng quan"
        subtitle="Nền tảng phát triển cho bài LifeMate — Zalo AI Challenge 2026"
        actions={
          <>
            <Button variant="primary" icon={<FlaskConical className="h-4 w-4" />} onClick={() => nav("/experiments/new")}>
              Tạo thử nghiệm
            </Button>
            <Button icon={<Wand2 className="h-4 w-4" />} onClick={() => nav("/studio/recipe")}>
              Sinh dữ liệu
            </Button>
            <Button icon={<TerminalSquare className="h-4 w-4" />} onClick={() => nav("/playground")}>
              Playground
            </Button>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Tổng chi phí" value={fmtCost(o.cost_total)} />
        <Stat label="Chi phí 24 giờ qua" value={fmtCost(o.cost_24h)} />
        <Stat label="Số model" value={o.n_models} />
        <Stat label="Số dataset" value={o.n_datasets} />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Bắt đầu nhanh">
          <ol className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                {s.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />}
                <span className={s.ok ? "text-slate-500 line-through" : ""}>
                  {i + 1}.{" "}
                  <Link to={s.to} className="link">
                    {s.label}
                  </Link>
                </span>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Khoá API" actions={<Link to="/models" className="link text-xs">Quản lý</Link>}>
          <ul className="space-y-1.5 text-sm">
            {o.providers.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2">
                <span className="font-mono text-xs">{p.id}</span>
                {p.key === "chưa có" ? (
                  <Link to="/models">
                    <Badge color="yellow">chưa có</Badge>
                  </Link>
                ) : (
                  <Badge color="green">{p.key}</Badge>
                )}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Run tốt nhất">
          {o.best_runs.length === 0 ? (
            <Empty>Chưa có run nào được chấm điểm.</Empty>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {o.best_runs.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2">
                  <Link to={`/runs/${r.id}`} className="link min-w-0 truncate">
                    {r.name}
                  </Link>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-slate-500">{r.dataset_id}</span>
                    <span className="font-mono font-semibold">{fmtScore(r.score)}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Run gần đây" actions={<Link to="/runs" className="link text-xs">Tất cả</Link>} bodyClass="p-0">
          {o.runs.length === 0 ? (
            <div className="p-3">
              <Empty>Chưa có run.</Empty>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Tên</th>
                  <th>Trạng thái</th>
                  <th>Tiến độ</th>
                  <th className="text-right">Điểm</th>
                  <th className="text-right">Chi phí</th>
                </tr>
              </thead>
              <tbody>
                {o.runs.map((r) => (
                  <tr key={r.id} className="clickable" onClick={() => nav(`/runs/${r.id}`)}>
                    <td>
                      <div className="max-w-[220px] truncate">{r.name}</div>
                      <div className="text-[11px] text-slate-500">
                        {r.dataset_id} · {fmtAgo(r.created)}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={r.status} />
                    </td>
                    <td>
                      <ProgressLabel done={r.done} total={r.total} />
                    </td>
                    <td className="text-right font-mono">{fmtScore(r.score)}</td>
                    <td className="text-right font-mono text-xs">{fmtCost(r.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <Card title="Job gần đây" actions={<Link to="/jobs" className="link text-xs">Tất cả</Link>} bodyClass="p-0">
          {o.jobs.length === 0 ? (
            <div className="p-3">
              <Empty>Chưa có job (sinh dữ liệu, xuất, TTS, App Factory…).</Empty>
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Trạng thái</th>
                  <th>Tiến độ</th>
                  <th className="text-right">Chi phí</th>
                </tr>
              </thead>
              <tbody>
                {o.jobs.map((j) => (
                  <tr key={j.id} className="clickable" onClick={() => nav(`/jobs?id=${j.id}`)}>
                    <td>
                      <div className="font-mono text-xs">{j.id}</div>
                      <div className="text-[11px] text-slate-500">
                        {j.kind} · {fmtAgo(j.created)}
                      </div>
                    </td>
                    <td>
                      <StatusBadge status={j.status} />
                    </td>
                    <td>
                      <ProgressLabel done={j.progress} total={j.total} />
                    </td>
                    <td className="text-right font-mono text-xs">{fmtCost(j.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
