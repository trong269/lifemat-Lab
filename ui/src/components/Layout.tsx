import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Activity, CircleDollarSign, ClipboardCheck, Database, FlaskConical, FolderOpen, GitCompare, Home, KeyRound, LayoutDashboard, ListChecks, Menu, Mic, Moon, PlayCircle, Plug, ScrollText, Send, Sparkles, Sun, TerminalSquare, Wand2 } from "lucide-react";
import React, { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../api";
import { useAdvanced } from "../lib/advanced";
import { useTheme } from "./theme";
import { Toggle } from "./ui";

type NavItem = { to: string; label: string; icon: React.ElementType; end?: boolean };

const NAV_MAIN: NavItem[] = [
  { to: "/", label: "Bắt đầu", icon: Home, end: true },
  { to: "/sources", label: "Dữ liệu", icon: FolderOpen },
  { to: "/connect", label: "Kết nối model", icon: Plug },
  { to: "/evaluate", label: "Đánh giá", icon: ClipboardCheck },
  { to: "/data", label: "Tạo dữ liệu", icon: Sparkles },
];

// công cụ chi tiết — chỉ hiện khi bật Chế độ nâng cao
const NAV_ADVANCED: NavItem[] = [
  { to: "/adv/overview", label: "Tổng quan chi tiết", icon: LayoutDashboard },
  { to: "/adv/models", label: "Mô hình & Khoá", icon: KeyRound },
  { to: "/datasets", label: "Datasets", icon: Database },
  { to: "/experiments", label: "Thử nghiệm", icon: FlaskConical },
  { to: "/runs", label: "Runs", icon: PlayCircle },
  { to: "/compare", label: "So sánh", icon: GitCompare },
  { to: "/asr", label: "ASR Lab", icon: Mic },
  { to: "/studio", label: "Data Studio", icon: Wand2 },
  { to: "/playground", label: "Playground", icon: TerminalSquare },
  { to: "/prompts", label: "Bộ luật", icon: ScrollText },
  { to: "/costs", label: "Chi phí", icon: CircleDollarSign },
  { to: "/submission", label: "Nộp bài", icon: Send },
  { to: "/jobs", label: "Jobs", icon: ListChecks },
];

function NavList({ items, small }: { items: NavItem[]; small?: boolean }) {
  return (
    <>
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          className={({ isActive }) =>
            clsx(
              "flex items-center gap-2.5 rounded-md px-2.5 transition-colors",
              small ? "py-1 text-[13px]" : "py-2 text-sm",
              isActive
                ? "bg-accent-50 font-medium text-accent-700 dark:bg-accent-900/40 dark:text-accent-200"
                : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5",
            )
          }
        >
          <n.icon className={clsx("shrink-0", small ? "h-3.5 w-3.5" : "h-4 w-4")} />
          {n.label}
        </NavLink>
      ))}
    </>
  );
}

function ActivityIndicator() {
  const runs = useQuery({ queryKey: ["runs"], queryFn: api.runs, refetchInterval: 5000 });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: () => api.jobs(), refetchInterval: 5000 });
  const nr = (runs.data ?? []).filter((r) => r.active || r.status === "running").length;
  const nj = (jobs.data ?? []).filter((j) => j.status === "running" || j.status === "cancelling").length;
  const busy = nr + nj > 0;
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <Link
        to="/evaluate"
        className={clsx(
          "inline-flex items-center gap-1 rounded-md px-2 py-1",
          nr ? "bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5",
        )}
        title="Lần đánh giá đang chạy"
      >
        <Activity className={clsx("h-3.5 w-3.5", nr && "animate-pulse")} /> {nr} đánh giá
      </Link>
      <Link
        to="/data"
        className={clsx(
          "inline-flex items-center gap-1 rounded-md px-2 py-1",
          nj ? "bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300" : "text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5",
        )}
        title="Việc nền đang chạy (tạo dữ liệu, xuất file…)"
      >
        <ListChecks className="h-3.5 w-3.5" /> {nj} việc nền
      </Link>
      {!busy && <span className="hidden text-slate-400 sm:inline">không có việc đang chạy</span>}
    </div>
  );
}

export function Layout() {
  const { dark, toggle } = useTheme();
  const { advanced, setAdvanced } = useAdvanced();
  const [mobileOpen, setMobileOpen] = useState(false);
  const loc = useLocation();
  React.useEffect(() => setMobileOpen(false), [loc.pathname]);
  return (
    <div className="flex min-h-screen">
      <aside
        className={clsx(
          "fixed inset-y-0 left-0 z-40 w-56 shrink-0 border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-[#15161a] lg:sticky lg:top-0 lg:h-screen lg:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Link to="/" className="flex h-12 items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-800">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-accent-600 text-xs font-bold text-white">LM</span>
          <div className="leading-tight">
            <div className="text-sm font-semibold">LifeMate Lab</div>
            <div className="text-[10px] text-slate-500">Zalo AI Challenge 2026</div>
          </div>
        </Link>
        <nav className="flex h-[calc(100vh-3rem)] flex-col overflow-y-auto p-2">
          <div className="space-y-0.5">
            <NavList items={NAV_MAIN} />
          </div>
          {advanced && (
            <div className="mt-4 space-y-0.5">
              <div className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">Công cụ nâng cao</div>
              <NavList items={NAV_ADVANCED} small />
            </div>
          )}
          <div className="mt-auto border-t border-slate-200 px-1 pt-3 dark:border-slate-800">
            <Toggle checked={advanced} onChange={setAdvanced} label={<span className="text-xs">Chế độ nâng cao</span>} />
            <div className="mt-1 px-0.5 text-[10px] leading-snug text-slate-400">Hiện thêm các công cụ chi tiết cho người dùng thành thạo.</div>
          </div>
        </nav>
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setMobileOpen(false)} />}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-12 items-center justify-between gap-2 border-b border-slate-200 bg-white/90 px-4 backdrop-blur dark:border-slate-800 dark:bg-[#15161a]/90">
          <div className="flex items-center gap-2">
            <button className="rounded p-1 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Menu">
              <Menu className="h-5 w-5" />
            </button>
            <ActivityIndicator />
          </div>
          <button
            onClick={toggle}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"
            title="Đổi giao diện sáng / tối"
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            {dark ? "Sáng" : "Tối"}
          </button>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-5">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
