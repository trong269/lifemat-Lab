/* Bắt đầu: 3 bước hướng dẫn + việc đang chạy + kết quả gần đây + chi phí. */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { CheckCircle2, ChevronRight, Circle, ClipboardCheck, FolderOpen, Plug, Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { Card, Empty, Loading, Progress, StatusBadge } from "../../components/ui";
import { fmtAgo, fmtCost, fmtScore } from "../../lib/format";
import { useDatasets, useModels } from "../../lib/hooks";

const JOB_VI: Record<string, string> = { generate: "Tạo dữ liệu", relabel: "Gán nhãn lại", export: "Xuất file", tts: "Tạo audio", app_factory: "Tạo app" };

export default function Home() {
  const ov = useQuery({ queryKey: ["overview"], queryFn: api.overview, refetchInterval: 4000 });
  const models = useModels();
  const datasets = useDatasets();
  if (ov.isLoading || models.isLoading) return <Loading />;
  const o = ov.data;
  const hasModel = (models.data ?? []).some((m) => m.role === "llm" && m.id !== "oracle" && !m.ready);
  const hasRun = (o?.runs ?? []).length > 0;
  const hasData = (datasets.data ?? []).some((d) => d.kind === "synthetic");
  const hasSource = (datasets.data ?? []).some((d) => d.kind === "official");
  const steps = [
    { done: hasSource, to: "/sources", icon: FolderOpen, title: "Thêm dữ liệu", desc: "Nhập đường dẫn tới dữ liệu BTC (train, public_test) nằm ngoài code." },
    { done: hasModel, to: "/connect", icon: Plug, title: "Kết nối model", desc: "Khai báo địa chỉ server và tên model bạn đang phục vụ (LLM, ASR)." },
    { done: hasRun, to: "/evaluate", icon: ClipboardCheck, title: "Đánh giá", desc: "Chạy model trên tập train để xem điểm và các lỗi hay gặp." },
    { done: hasData, to: "/data", icon: Sparkles, title: "Tạo dữ liệu", desc: "Sinh thêm dữ liệu huấn luyện, duyệt lại, xuất file để fine-tune." },
  ];
  const nextIdx = steps.findIndex((s) => !s.done);
  const runningRuns = (o?.runs ?? []).filter((r) => r.status === "running");
  const runningJobs = (o?.jobs ?? []).filter((j) => j.status === "running" || j.status === "cancelling");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Chào mừng đến LifeMate Lab</h1>
        <p className="muted mt-1 text-sm">Nơi thử nghiệm và đánh giá agent cho bài LifeMate — Zalo AI Challenge 2026. Làm theo các bước:</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <Link
            key={s.to}
            to={s.to}
            className={clsx(
              "card group flex flex-col gap-2 p-4 transition-colors hover:border-accent-400",
              i === nextIdx && "border-accent-500 ring-1 ring-accent-500",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-slate-500">Bước {i + 1}</span>
              {s.done ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <Circle className="h-5 w-5 text-slate-300" />}
            </div>
            <div className="flex items-center gap-2 text-base font-semibold">
              <s.icon className="h-5 w-5 text-accent-600" /> {s.title}
            </div>
            <div className="muted flex-1 text-sm">{s.desc}</div>
            <div className="flex items-center text-sm font-medium text-accent-600">
              {i === nextIdx ? "Làm bước này" : "Mở"} <ChevronRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </div>
          </Link>
        ))}
      </div>

      {(runningRuns.length > 0 || runningJobs.length > 0) && (
        <Card title="Đang chạy">
          <div className="space-y-2">
            {runningRuns.map((r) => (
              <Link key={r.id} to={`/evaluate/${r.id}`} className="block">
                <div className="flex justify-between text-sm">
                  <span>Đánh giá: {r.name}</span>
                  <span className="muted">
                    {r.done}/{r.total}
                  </span>
                </div>
                <Progress value={r.done} max={Math.max(r.total, 1)} />
              </Link>
            ))}
            {runningJobs.map((j) => (
              <Link key={j.id} to="/data" className="block">
                <div className="flex justify-between text-sm">
                  <span>{JOB_VI[j.kind] ?? j.kind}</span>
                  <span className="muted">
                    {j.progress}/{j.total || "?"}
                  </span>
                </div>
                <Progress value={j.progress} max={Math.max(j.total, 1)} />
              </Link>
            ))}
          </div>
        </Card>
      )}

      <div className="grid gap-3 md:grid-cols-[1fr_220px]">
        <Card title="Kết quả gần đây" bodyClass="p-0" actions={<Link to="/evaluate" className="text-xs text-accent-600 hover:underline">Tất cả →</Link>}>
          {(o?.runs ?? []).length === 0 ? (
            <Empty className="m-3">Chưa có lần chạy nào.</Empty>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {(o?.runs ?? []).slice(0, 6).map((r) => (
                <Link key={r.id} to={`/evaluate/${r.id}`} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-white/5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{r.name}</div>
                    <div className="muted text-xs">{fmtAgo(r.created)}</div>
                  </div>
                  {r.score != null ? (
                    <span className="text-lg font-semibold tabular-nums">{fmtScore(r.score)}</span>
                  ) : (
                    <StatusBadge status={r.status} />
                  )}
                </Link>
              ))}
            </div>
          )}
        </Card>
        <Card title="Chi phí API">
          <div className="text-2xl font-semibold tabular-nums">{fmtCost(o?.cost_total)}</div>
          <div className="muted text-xs">tổng cộng</div>
          <div className="mt-2 text-sm">{fmtCost(o?.cost_24h)} <span className="muted text-xs">trong 24 giờ qua</span></div>
          <div className="muted mt-2 text-[11px]">Tính theo giá bạn khai báo cho từng model.</div>
        </Card>
      </div>
    </div>
  );
}
