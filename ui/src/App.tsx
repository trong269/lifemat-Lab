import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { Layout } from "./components/Layout";
import AsrLab from "./pages/AsrLab";
import Compare from "./pages/Compare";
import Costs from "./pages/Costs";
import DatasetDetail from "./pages/DatasetDetail";
import Datasets from "./pages/Datasets";
import ExperimentEditor from "./pages/ExperimentEditor";
import Experiments from "./pages/Experiments";
import Jobs from "./pages/Jobs";
import Models from "./pages/Models";
import Overview from "./pages/Overview";
import Playground from "./pages/Playground";
import Prompts from "./pages/Prompts";
import RunDetail from "./pages/RunDetail";
import Runs from "./pages/Runs";
import Submission from "./pages/Submission";
import Trace from "./pages/Trace";
import Studio from "./pages/studio/Studio";
import CompareSimple from "./pages/simple/CompareSimple";
import Connect from "./pages/simple/Connect";
import CreateData from "./pages/simple/CreateData";
import DataSources from "./pages/simple/DataSources";
import Evaluate from "./pages/simple/Evaluate";
import Home from "./pages/simple/Home";
import Result from "./pages/simple/Result";
import SampleResult from "./pages/simple/SampleResult";

/** Tạo lại trình soạn khi đổi URL (vd từ /experiments/:id sang /experiments/new hoặc Clone). */
function KeyedEditor() {
  const loc = useLocation();
  return <ExperimentEditor key={loc.key} />;
}

/** Trang run: tạo lại state khi đổi run (vd sau "Chạy lại"). */
function KeyedRun() {
  const { id } = useParams();
  return <RunDetail key={id} />;
}

function KeyedResult() {
  const { id } = useParams();
  return <Result key={id} />;
}

function NotFound() {
  return <div className="p-8 text-center text-sm text-slate-500">Không tìm thấy trang.</div>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="connect" element={<Connect />} />
        <Route path="sources" element={<DataSources />} />
        <Route path="evaluate" element={<Evaluate />} />
        <Route path="evaluate/compare" element={<CompareSimple />} />
        <Route path="evaluate/:id" element={<KeyedResult />} />
        <Route path="evaluate/:id/:sid" element={<SampleResult />} />
        <Route path="data" element={<CreateData />} />
        <Route path="data/review/:ds" element={<CreateData />} />
        {/* công cụ nâng cao */}
        <Route path="adv/overview" element={<Overview />} />
        <Route path="adv/models" element={<Models />} />
        <Route path="models" element={<Navigate to="/adv/models" replace />} />
        <Route path="datasets" element={<Datasets />} />
        <Route path="datasets/:id" element={<DatasetDetail />} />
        <Route path="experiments" element={<Experiments />} />
        <Route path="experiments/new" element={<KeyedEditor />} />
        <Route path="experiments/:id" element={<KeyedEditor />} />
        <Route path="runs" element={<Runs />} />
        <Route path="runs/:id" element={<KeyedRun />} />
        <Route path="runs/:id/s/:sid" element={<Trace />} />
        <Route path="compare" element={<Compare />} />
        <Route path="asr" element={<AsrLab />} />
        <Route path="studio" element={<Navigate to="/studio/recipe" replace />} />
        <Route path="studio/review/:ds" element={<Studio tab="review" />} />
        <Route path="studio/:tab" element={<Studio />} />
        <Route path="playground" element={<Playground />} />
        <Route path="prompts" element={<Prompts />} />
        <Route path="costs" element={<Costs />} />
        <Route path="submission" element={<Submission />} />
        <Route path="jobs" element={<Jobs />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
