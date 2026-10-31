/* Client API cho backend FastAPI (tiền tố /api). */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;
export type Dict<T = Json> = Record<string, T>;

export class ApiError extends Error {
  status: number;
  detail: Json;
  constructor(status: number, detail: Json) {
    super(formatDetail(detail) || `Lỗi HTTP ${status}`);
    this.status = status;
    this.detail = detail;
  }
}

/** detail có thể là chuỗi hoặc danh sách lỗi pydantic [{loc, msg, type}]. */
export function formatDetail(detail: Json): string {
  if (detail == null) return "";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        if (typeof e === "string") return e;
        const loc = Array.isArray(e?.loc) ? e.loc.filter((x: Json) => x !== "body").join(".") : "";
        return loc ? `${loc}: ${e?.msg ?? JSON.stringify(e)}` : e?.msg ?? JSON.stringify(e);
      })
      .join("; ");
  }
  if (typeof detail === "object") return detail.msg ?? JSON.stringify(detail);
  return String(detail);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, `Không kết nối được máy chủ (${errorMessage(e)})`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    let detail: Json = `Lỗi HTTP ${res.status}`;
    try {
      if (ct.includes("json")) {
        const j = await res.json();
        detail = j?.detail ?? j;
      } else {
        const t = await res.text();
        if (t) detail = `Lỗi HTTP ${res.status}: ${t.slice(0, 300)}`;
      }
    } catch {
      /* bỏ qua */
    }
    throw new ApiError(res.status, detail);
  }
  if (ct.includes("json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

/** Gửi multipart/form-data (tải file lên). */
export async function upload<T = Json>(url: string, form: FormData): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form });
  } catch (e) {
    throw new ApiError(0, `Không kết nối được máy chủ (${errorMessage(e)})`);
  }
  const ct = res.headers.get("content-type") || "";
  if (!res.ok) {
    let detail: Json = `Lỗi HTTP ${res.status}`;
    try {
      if (ct.includes("json")) {
        const j = await res.json();
        detail = j?.detail ?? j;
      }
    } catch {
      /* bỏ qua */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export interface DataSource {
  id: string;
  path: string;
  notes: string;
  created: number;
  exists: boolean;
  datasets: string[];
}

export interface ImportsList {
  asr: Model[];
  llm: { id: string; name: string; dataset_id: string; status: string; score: number | null; done: number; total: number; created: number }[];
}

export const http = {
  get: <T = Json>(url: string) => request<T>("GET", url),
  post: <T = Json>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  put: <T = Json>(url: string, body?: unknown) => request<T>("PUT", url, body ?? {}),
  del: <T = Json>(url: string) => request<T>("DELETE", url),
};

export function qs(params: Dict<string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export const enc = encodeURIComponent;

// ---------------- kiểu dữ liệu ----------------
export interface Provider {
  id: string;
  kind: string;
  base_url: string | null;
  api_key_env: string | null;
  notes: string;
  created: number;
  key_status: string;
}

export interface Model {
  id: string;
  name: string;
  role: "llm" | "asr" | "tts";
  provider_id: string;
  plugin: string | null;
  config: Dict;
  price: Dict<number>;
  n_params_b: number | null;
  context_len: number | null;
  release_date: string | null;
  license: string | null;
  submit_ok: number;
  source: string | null;
  base_model: string | null;
  train_dataset: string | null;
  train_script: string | null;
  notes: string;
  created: number;
  ready: string | null;
}

export interface Plugin {
  name: string;
  description: string;
  schema: Json;
}
export type Plugins = Record<string, Plugin[]>;

export interface Scenario {
  name: string;
  desc: string;
  expect: string;
}

export interface Meta {
  error_tags: Dict<string>;
  scenarios: Dict<Scenario>;
  recipe_schema: Json;
  recipe_default: Recipe;
  experiment_schema: Json;
  experiment_default: ExperimentConfig;
  price_fields: Dict<string>;
  app_ideas: string[];
  rules: string[];
}

export interface Dataset {
  id: string;
  name: string;
  root: string | null;
  split: string | null;
  kind: "official" | "synthetic" | "subset";
  parent_id: string | null;
  filter: Json;
  notes: string;
  created: number;
  n: number;
  error?: string;
  review?: ReviewSummary;
}

export interface ReviewSummary {
  n: number;
  status: Dict<number>;
  with_error: number;
  disagreement: number;
  spot_checked: number;
  spot_rejected: number;
  spot_error_rate: number | null;
  scenario: Dict<number>;
}

export interface SampleFeatures {
  id: string;
  text: string | null;
  scenario: string | null;
  label_apps: string[];
  installed: string[];
  hist_turns: number;
  n_calls: number | null;
  city: string | null;
  has_label: boolean;
  time: string | null;
  new_app: boolean;
  public_only_app: boolean;
}

export interface DatasetStats {
  n: number;
  labeled: number;
  scenario: Dict<number>;
  hist_turns: Dict<number>;
  n_calls: Dict<number>;
  city: Dict<number>;
  label_apps: Dict<number>;
  installed_apps: Dict<number>;
  new_app: number;
  public_only_app: number;
}

export interface SampleFilter {
  scenario?: string[];
  apps?: string[];
  installed?: string[];
  hist_min?: number | null;
  hist_max?: number | null;
  new_app?: boolean | null;
  text?: string;
  city?: string[];
}

export interface SampleDetail {
  sample: Json;
  split_dir: string;
  features: SampleFeatures;
  audio_files: string[];
  state?: Json;
}

export interface ExperimentConfig {
  name: string;
  mode: string;
  dataset: string;
  sample_ids: string[] | null;
  limit: number;
  asr_model: string;
  asr_overrides: Dict;
  postprocess: (Dict | string)[];
  llm_model: string;
  llm_overrides: Dict;
  renderer: Dict | string;
  prompt: Dict | string;
  agent: Dict | string;
  guards: (Dict | string)[];
  timeout_s: number;
  workers: number;
  budget_usd: number | null;
  use_cache: boolean;
  score: Dict;
}

export interface Experiment {
  id: string;
  name: string;
  config: ExperimentConfig;
  created: number;
  updated: number;
}

export interface RunListRow {
  id: string;
  experiment_id: string | null;
  name: string;
  dataset_id: string;
  status: string;
  total: number;
  done: number;
  score: number | null;
  cost: number;
  created: number;
  finished: number | null;
  kind: string;
  hash_ok: number | null;
  p95: number | null;
  wer: number | null;
  llm_model: string | null;
  asr_model: string | null;
  active: boolean;
}

export interface Group {
  n: number;
  score: number | null;
  hash_ok: number | null;
}

export interface RunMetrics {
  n: number;
  n_scored?: number;
  status?: Dict<number>;
  latency_p50?: number;
  latency_p95?: number;
  latency_max?: number;
  over_30s?: number;
  time_asr_mean?: number;
  cost?: number;
  tokens_in?: number;
  tokens_out?: number;
  calls_mean?: number;
  steps_mean?: number;
  score?: number;
  hash_ok?: number;
  P?: number;
  R?: number;
  f1_nohash?: number;
  perfect?: number;
  alt_scores?: { strict_keys?: number; case_sensitive?: number; literal?: number };
  by_scenario?: Dict<Group>;
  by_app?: Dict<Group>;
  by_history?: Dict<Group>;
  by_new_app?: Dict<Group>;
  tags?: Dict<number>;
  asr?: { utterances: number; wer: number; cer: number; wer_final: number; entity_recall: number; exact: number };
}

export interface Run {
  id: string;
  experiment_id: string | null;
  name: string;
  dataset_id: string;
  config: ExperimentConfig;
  status: string;
  total: number;
  done: number;
  score: number | null;
  metrics: RunMetrics | null;
  cost: number;
  created: number;
  started: number | null;
  finished: number | null;
  error: string | null;
  kind: string;
  active: boolean;
}

export interface RunSampleRow {
  sample_id: string;
  idx: number;
  status: string;
  score: number | null;
  hash_ok: number | null;
  M: number | null;
  U: number | null;
  G: number | null;
  P: number | null;
  R: number | null;
  f1_nohash: number | null;
  tags: string[] | null;
  scenario: string | null;
  apps: string[] | null;
  hist_turns: number | null;
  new_app: number | null;
  n_calls: number | null;
  latency_s: number | null;
  time_asr_s: number | null;
  cost: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  steps: number | null;
  wer: number | null;
}

export interface RunSampleFilter {
  tag?: string;
  scenario?: string;
  app?: string;
  status?: string;
  min_score?: number;
  max_score?: number;
  q?: string;
}

export interface AsrRow {
  sample_id: string;
  audio: string;
  final: boolean;
  ref: string | null;
  hyp: string | null;
  ref_norm?: string;
  hyp_norm?: string;
  raw: string | null;
  wer: number;
  entity_recall: number | null;
  score: number | null;
  error: string | null;
}

export interface TraceResponse {
  trace: Json;
  row: Json;
  sample: SampleDetail | null;
}

export interface Job {
  id: string;
  kind: string;
  status: string;
  progress: number;
  total: number;
  cost: number;
  budget: number | null;
  payload: Json;
  result?: Json;
  error: string | null;
  created: number;
  updated: number;
  log?: string[];
}

export interface Recipe {
  n_samples: number;
  weights: Dict<number>;
  apps_pool: string[];
  extra_apps: string[];
  installed_min: number;
  installed_max: number;
  history_dist: Dict<number>;
  region_weights: Dict<number>;
  state_mode: string;
  writer_model: string;
  labeler_model: string;
  labeler2_model: string | null;
  rules: string;
  parallel: number;
  seed: number;
  budget_usd: number | null;
  spot_check_rate: number;
}

export interface SavedRecipe {
  id: string;
  name: string;
  config: Recipe;
  created: number;
  updated: number;
}

export interface CatalogApp {
  id: string;
  name_vi: string | null;
  group: string | null;
  source: "train" | "generated";
  n_tools: number;
}

export interface Batch {
  id: string;
  name: string;
  recipe: Recipe;
  dataset_id: string;
  status: string;
  n_target: number;
  n_done: number;
  cost: number;
  job_id: string | null;
  created: number;
}

export interface Flag {
  code?: string;
  level: "error" | "warn" | string;
  msg: string;
}

export interface QueueRow {
  dataset_id: string;
  sample_id: string;
  batch_id: string;
  scenario: string;
  status: string;
  flags: Flag[] | null;
  disagreement: number;
  spot_check: number;
  provenance: Json;
  reviewer: string | null;
  updated: number;
  n_err: number;
  n_warn: number;
}

export interface SynthSample {
  record: Json;
  state: Json;
  base_state: Json;
  review: Json;
  edits: { ts: number; field: string }[];
}

export interface Calibration {
  ok: boolean;
  message: string;
  runs: { id: string; name: string; score: number; done: number; dataset_id: string; prompt: Json; finished: number | null }[];
}

export interface Coverage {
  n: number;
  scenario: Dict<{ actual: number; target: number | null; count: number }>;
  region: Dict<number>;
  focus_apps: Dict<number>;
  history_turns: Dict<number>;
  n_calls: Dict<number>;
}

export interface DuplicatePair {
  a: string;
  b: string;
  text_a: string;
  text_b: string;
  jaccard: number;
}

export interface GenStart {
  batch_id: string;
  job_id: string;
  dataset_id: string;
  calibration?: Calibration;
}

export interface ExportVersion {
  id: string;
  name: string;
  components: Json[];
  options: Json;
  export_path: string;
  stats: Json;
  created: number;
}

export interface GenApp {
  id: string;
  app_id: string;
  status: string;
  spec: Json; // toàn bộ app: {app_id, spec, code, example_state, test_calls}
  code: string;
  example_state: Json;
  test_report: Json;
  notes: string;
  created: number;
  updated: number;
  approved_on_disk?: boolean;
}

export interface Overview {
  runs: { id: string; name: string; dataset_id: string; status: string; score: number | null; cost: number; done: number; total: number; created: number }[];
  jobs: { id: string; kind: string; status: string; progress: number; total: number; cost: number; created: number }[];
  cost_total: number;
  cost_24h: number;
  providers: { id: string; key: string }[];
  best_runs: { id: string; name: string; score: number; dataset_id: string }[];
  n_models: number;
  n_datasets: number;
}

export interface CompareResult {
  runs: { id: string; name: string; score: number | null; metrics: RunMetrics | null; config: ExperimentConfig }[];
  common: number;
  flips: Dict<number>;
  rows: { sample_id: string; scores: number[]; kind: string; delta: number; tags: (string[] | null)[] }[];
}

export interface Costs {
  total: number;
  by_model: { model_id: string; kind: string; cost: number; input_tokens: number; output_tokens: number; audio_seconds: number; chars: number; calls: number; cached: number }[];
  by_owner: { owner: string; cost: number; calls: number; first: number }[];
  by_day: { day: string; cost: number }[];
}

export interface CheckItem {
  name: string;
  ok: boolean;
  detail: string;
  level: "ok" | "warn" | "error";
}

export interface LbScore {
  id: number;
  run_id: string | null;
  score: number;
  note: string;
  ts: number;
  run_name: string | null;
  local_score: number | null;
  dataset_id: string | null;
}

export interface PgOpen {
  session: string;
  ok: boolean;
  system: string;
  messages: Json[];
  tools: { name: string; api_name: string; description: string; parameters: Json; [k: string]: Json }[];
  label: Json;
  text: string | null;
}

export interface PgResp {
  ok: boolean;
  calls: { name: string; arguments: Json }[];
  state_hash: string;
  state: Json;
  messages: Json[];
  pending: { id: string; name: string; arguments: Json }[];
  text?: string;
  tool_calls?: Json[];
  usage?: Json;
  cost?: number;
  total_cost?: number;
  actions?: Json[];
  action?: Json;
}

// ---------------- endpoint ----------------
export const api = {
  health: () => http.get("/api/health"),
  overview: () => http.get<Overview>("/api/overview"),
  plugins: () => http.get<Plugins>("/api/plugins"),
  meta: () => http.get<Meta>("/api/meta"),

  prompts: () => http.get<{ name: string; chars: number }[]>("/api/prompts"),
  prompt: (name: string) => http.get<{ name: string; text: string }>(`/api/prompts/${enc(name)}`),
  savePrompt: (name: string, text: string) => http.put(`/api/prompts/${enc(name)}`, { text }),

  providers: () => http.get<Provider[]>("/api/providers"),
  saveProvider: (p: Partial<Provider>) => http.post<Provider>("/api/providers", p),
  deleteProvider: (id: string) => http.del(`/api/providers/${enc(id)}`),
  setKey: (id: string, key: string) => http.put<{ ok: boolean; key_status: string }>(`/api/providers/${enc(id)}/key`, { key }),

  models: (role?: string) => http.get<Model[]>(`/api/models${qs({ role })}`),
  saveModel: (m: Dict) => http.post<Model>("/api/models", m),
  deleteModel: (id: string) => http.del(`/api/models/${enc(id)}`),
  testModel: (id: string, body: Dict = {}) => http.post(`/api/models/${enc(id)}/test`, body),

  datasets: () => http.get<Dataset[]>("/api/datasets"),
  dataSources: () => http.get<{ sources: DataSource[]; train_root: string | null }>("/api/data_sources"),
  addDataSource: (path: string) => http.post<{ path: string; splits: string[]; added: string[]; moved: string[] }>("/api/data_sources", { path }),
  removeDataSource: (id: string) => http.del<{ removed_datasets: string[] }>(`/api/data_sources/${enc(id)}`),
  imports: () => http.get<ImportsList>("/api/predictions"),
  importAsr: (form: FormData) =>
    upload<{ model_id: string; records: number; coverage: { dataset_id: string; n: number; matched: number; complete: number }[] }>("/api/predictions/asr", form),
  importLlm: (form: FormData) =>
    upload<{ run_id: string; job_id: string; dataset_id: string; lines: number; scored: number; dataset_size: number; missing: number }>(
      "/api/predictions/llm",
      form,
    ),
  deleteAsrImport: (id: string) => http.del(`/api/predictions/asr/${enc(id)}`),
  datasetStats: (id: string) => http.get<DatasetStats>(`/api/datasets/${enc(id)}/stats`),
  datasetSamples: (id: string, body: { filter?: SampleFilter; offset?: number; limit?: number; with_ids?: boolean }) =>
    http.post<{ total: number; rows: SampleFeatures[]; ids: string[] | null }>(`/api/datasets/${enc(id)}/samples`, body),
  datasetSample: (id: string, sid: string) => http.get<SampleDetail>(`/api/datasets/${enc(id)}/samples/${enc(sid)}`),
  createSubset: (id: string, body: { name: string; filter?: SampleFilter; sample_ids?: string[]; notes?: string }) =>
    http.post<{ id: string; n: number }>(`/api/datasets/${enc(id)}/subset`, body),
  createHoldout: (id: string, body: { apps: string[]; name: string }) =>
    http.post<{ holdout: string; rest: string }>(`/api/datasets/${enc(id)}/holdout`, body),
  deleteDataset: (id: string) => http.del(`/api/datasets/${enc(id)}`),
  rescan: () => http.post("/api/datasets/rescan"),
  audioUrl: (ds: string, path: string) => `/api/audio${qs({ ds, path })}`,

  experiments: () => http.get<Experiment[]>("/api/experiments"),
  experiment: (id: string) => http.get<Experiment>(`/api/experiments/${enc(id)}`),
  saveExperiment: (body: { id?: string; name: string; config: ExperimentConfig }) => http.post<{ id: string }>("/api/experiments", body),
  deleteExperiment: (id: string) => http.del(`/api/experiments/${enc(id)}`),
  validateExperiment: (cfg: ExperimentConfig) => http.post<{ ok: boolean; n: number }>("/api/experiments/validate", cfg),
  estimate: (cfg: ExperimentConfig) => http.post<Dict>("/api/experiments/estimate", cfg),

  runs: () => http.get<RunListRow[]>("/api/runs"),
  startRun: (body: { config: ExperimentConfig; experiment_id?: string | null; name?: string }) => http.post<{ id: string }>("/api/runs", body),
  run: (id: string) => http.get<Run>(`/api/runs/${enc(id)}`),
  runSamples: (id: string, body: { filter?: RunSampleFilter; sort?: string; offset?: number; limit?: number }) =>
    http.post<{ total: number; rows: RunSampleRow[] }>(`/api/runs/${enc(id)}/samples`, body),
  runAsr: (id: string, limit = 300, only_errors = true) => http.get<AsrRow[]>(`/api/runs/${enc(id)}/asr${qs({ limit, only_errors })}`),
  trace: (id: string, sid: string) => http.get<TraceResponse>(`/api/runs/${enc(id)}/samples/${enc(sid)}`),
  runAction: (id: string, action: "pause" | "resume" | "cancel") => http.post(`/api/runs/${enc(id)}/${action}`),
  deleteRun: (id: string) => http.del(`/api/runs/${enc(id)}`),
  rerun: (id: string, body: { which?: string | string[]; overrides?: Dict; name?: string }) => http.post<{ id: string }>(`/api/runs/${enc(id)}/rerun`, body),
  submissionUrl: (id: string) => `/api/runs/${enc(id)}/submission`,
  wsUrl: (id: string) => `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/runs/${enc(id)}/ws`,

  compare: (run_ids: string[]) => http.post<CompareResult>("/api/compare", { run_ids }),
  costs: (days = 30) => http.get<Costs>(`/api/costs${qs({ days })}`),

  subChecks: (id: string, other?: string) => http.get<{ run_id: string; items: CheckItem[]; passed: boolean }>(`/api/submission/${enc(id)}/checks${qs({ other })}`),
  subValidate: (id: string) => http.post<{ returncode: number; stdout: string; stderr: string; ok: boolean }>(`/api/submission/${enc(id)}/validate`),
  lbScores: () => http.get<LbScore[]>("/api/lb_scores"),
  addLb: (body: { run_id: string | null; score: number; note: string }) => http.post("/api/lb_scores", body),
  deleteLb: (id: number) => http.del(`/api/lb_scores/${id}`),

  jobs: (kind?: string) => http.get<Job[]>(`/api/jobs${qs({ kind })}`),
  job: (id: string) => http.get<Job>(`/api/jobs/${enc(id)}`),
  cancelJob: (id: string) => http.post(`/api/jobs/${enc(id)}/cancel`),

  recipes: () => http.get<SavedRecipe[]>("/api/recipes"),
  saveRecipe: (body: { id?: string; name: string; config: Recipe }) => http.post<{ id: string }>("/api/recipes", body),
  deleteRecipe: (id: string) => http.del(`/api/recipes/${enc(id)}`),
  synthPreview: (recipe: Recipe, n = 5, name?: string) => http.post<GenStart>("/api/synth/preview", { recipe, n, name }),
  synthGenerate: (body: { recipe: Recipe; name?: string; dataset_id?: string | null }) => http.post<GenStart>("/api/synth/generate", body),
  calibration: (model: string) => http.get<Calibration>(`/api/synth/calibration${qs({ model })}`),
  coverage: (ds: string) => http.get<Coverage>(`/api/synth/${enc(ds)}/coverage`),
  duplicates: (ds: string, threshold = 0.8) => http.get<DuplicatePair[]>(`/api/datasets/${enc(ds)}/duplicates${qs({ threshold })}`),
  batches: () => http.get<Batch[]>("/api/synth/batches"),
  queue: (ds: string, p: { status?: string; flagged?: string; scenario?: string; spot?: number | null }) =>
    http.get<QueueRow[]>(`/api/synth/${enc(ds)}/queue${qs(p)}`),
  synthSummary: (ds: string) => http.get<ReviewSummary>(`/api/synth/${enc(ds)}/summary`),
  synthSample: (ds: string, sid: string) => http.get<SynthSample>(`/api/synth/${enc(ds)}/samples/${enc(sid)}`),
  review: (ds: string, sample_ids: string[], status: string) => http.post(`/api/synth/${enc(ds)}/review`, { sample_ids, status }),
  editSynth: (ds: string, sid: string, edits: Dict) => http.put<{ record: Json; flags: Flag[]; changed: string[] }>(`/api/synth/${enc(ds)}/samples/${enc(sid)}`, { edits }),
  relabel: (ds: string, body: { sample_ids: string[]; model: string; rules: string }) => http.post<{ job_id: string }>(`/api/synth/${enc(ds)}/relabel`, body),
  spotCheck: (ds: string, rate: number) => http.post<{ n: number }>(`/api/synth/${enc(ds)}/spot_check`, { rate }),
  synthTts: (ds: string, body: Dict) => http.post<{ job_id: string }>(`/api/synth/${enc(ds)}/tts`, body),
  ttsPreview: async (body: { model: string; text: string; voice: string; augment?: Dict | null }): Promise<Blob> => {
    const res = await fetch("/api/tts/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) {
      let detail: Json = `Lỗi HTTP ${res.status}`;
      try {
        detail = (await res.json()).detail;
      } catch {
        /* bỏ qua */
      }
      throw new ApiError(res.status, detail);
    }
    return res.blob();
  },

  exports: () => http.get<ExportVersion[]>("/api/exports"),
  startExport: (body: { name: string; components: Dict[]; options: Dict }) => http.post<{ job_id: string }>("/api/exports", body),
  exportDownloadUrl: (id: string, file: string) => `/api/exports/${enc(id)}/download${qs({ file })}`,
  exportPreview: (id: string, n = 3) => http.get<Json[]>(`/api/exports/${enc(id)}/preview${qs({ n })}`),

  apps: () => http.get<GenApp[]>("/api/apps"),
  app: (id: string) => http.get<GenApp>(`/api/apps/${enc(id)}`),
  createApp: (app: Dict, notes = "") => http.post<{ id: string; report: Json }>("/api/apps", { app, notes }),
  generateApp: (idea: string, model: string) => http.post<{ job_id: string }>("/api/apps/generate", { idea, model }),
  saveApp: (id: string, app: Dict) => http.put<Json>(`/api/apps/${enc(id)}`, { app }),
  approveApp: (id: string, approve: boolean) => http.post(`/api/apps/${enc(id)}/approve`, { approve }),
  deleteApp: (id: string) => http.del(`/api/apps/${enc(id)}`),
  catalogApps: () => http.get<CatalogApp[]>("/api/catalog/apps"),

  pgOpen: (body: { dataset_id: string; sample_id: string; llm_model?: string | null; renderer?: Json; prompt?: Json; guards?: Json; text?: string | null }) =>
    http.post<PgOpen>("/api/playground", body),
  pgCmd: (session: string, body: Dict) => http.post<PgResp>(`/api/playground/${enc(session)}`, body),
  pgClose: (session: string) => http.del(`/api/playground/${enc(session)}`),
};
