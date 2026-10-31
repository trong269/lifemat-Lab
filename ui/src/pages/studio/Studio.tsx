import { Navigate, useNavigate, useParams } from "react-router-dom";
import { PageHeader, Tabs } from "../../components/ui";
import AppFactoryTab from "./AppFactoryTab";
import BatchesTab from "./BatchesTab";
import CalibrateTab from "./CalibrateTab";
import ExportTab from "./ExportTab";
import RecipeTab from "./RecipeTab";
import ReviewTab from "./ReviewTab";
import TtsTab from "./TtsTab";

const TABS = [
  { value: "recipe", label: "Công thức" },
  { value: "batches", label: "Đợt sinh" },
  { value: "review", label: "Duyệt" },
  { value: "tts", label: "TTS" },
  { value: "export", label: "Xuất dữ liệu" },
  { value: "apps", label: "App Factory" },
  { value: "calibrate", label: "Hiệu chỉnh teacher" },
] as const;
type Tab = (typeof TABS)[number]["value"];

export default function Studio({ tab: fixed }: { tab?: Tab }) {
  const params = useParams();
  const nav = useNavigate();
  const tab = (fixed ?? params.tab ?? "recipe") as Tab;
  if (!TABS.find((t) => t.value === tab)) return <Navigate to="/studio/recipe" replace />;
  return (
    <div className="space-y-4">
      <PageHeader title="Data Studio" subtitle="Sinh dữ liệu tổng hợp bằng teacher, duyệt/sửa nhãn, TTS, xuất dữ liệu huấn luyện, tạo app mới" />
      <Tabs value={tab} onChange={(v) => nav(v === "review" && params.ds ? `/studio/review/${params.ds}` : `/studio/${v}`)} items={TABS.map((t) => ({ ...t }))} />
      {tab === "recipe" && <RecipeTab />}
      {tab === "batches" && <BatchesTab />}
      {tab === "review" && <ReviewTab />}
      {tab === "tts" && <TtsTab />}
      {tab === "export" && <ExportTab />}
      {tab === "apps" && <AppFactoryTab />}
      {tab === "calibrate" && <CalibrateTab />}
    </div>
  );
}
