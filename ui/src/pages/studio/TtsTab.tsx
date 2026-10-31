import { Mic, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { api, Dict } from "../../api";
import { JobProgress } from "../../components/JobProgress";
import { MultiSelect } from "../../components/MultiSelect";
import { useToast } from "../../components/Toast";
import { Button, Card, Checkbox, Field, Input, Notice, NumberInput, Select, Textarea, Toggle } from "../../components/ui";
import { statusVi } from "../../lib/format";
import { useDatasets, useModels } from "../../lib/hooks";

interface Aug {
  prob: number;
  noise_snr_db: [number, number];
  speed: [number, number];
  reverb_prob: number;
  gain_db: [number, number];
}
const DEFAULT_AUG: Aug = { prob: 0.5, noise_snr_db: [12, 30], speed: [0.9, 1.1], reverb_prob: 0.3, gain_db: [-6, 3] };

function Range({ label, value, onChange, step = 0.1 }: { label: string; value: [number, number]; onChange: (v: [number, number]) => void; step?: number }) {
  return (
    <Field label={label}>
      <div className="flex gap-1">
        <NumberInput value={value[0]} onChange={(v) => onChange([v ?? 0, value[1]])} allowNull={false} step={step} />
        <NumberInput value={value[1]} onChange={(v) => onChange([value[0], v ?? 0])} allowNull={false} step={step} />
      </div>
    </Field>
  );
}

function AugForm({ aug, setAug, showProb }: { aug: Aug; setAug: (a: Aug) => void; showProb?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {showProb && (
        <Field label="Xác suất áp dụng / file">
          <NumberInput value={aug.prob} onChange={(v) => setAug({ ...aug, prob: v ?? 0 })} allowNull={false} step={0.05} min={0} max={1} />
        </Field>
      )}
      <Range label="Nhiễu SNR (dB) từ–đến" value={aug.noise_snr_db} onChange={(v) => setAug({ ...aug, noise_snr_db: v })} step={1} />
      <Range label="Tốc độ từ–đến" value={aug.speed} onChange={(v) => setAug({ ...aug, speed: v })} step={0.01} />
      <Field label="Xác suất vang (reverb)">
        <NumberInput value={aug.reverb_prob} onChange={(v) => setAug({ ...aug, reverb_prob: v ?? 0 })} allowNull={false} step={0.05} min={0} max={1} />
      </Field>
      <Range label="Gain (dB) từ–đến" value={aug.gain_db} onChange={(v) => setAug({ ...aug, gain_db: v })} step={1} />
    </div>
  );
}

const csv = (s: string) => s.split(/[,\s]+/).filter(Boolean);

export default function TtsTab() {
  const models = useModels();
  const datasets = useDatasets();
  const toast = useToast();
  const tts = (models.data ?? []).filter((m) => m.role === "tts").map((m) => ({ value: m.id, label: `${m.id}${m.ready ? " (chưa sẵn sàng)" : ""}` }));
  const synth = (datasets.data ?? []).filter((d) => d.kind === "synthetic");

  // xem trước
  const [pm, setPm] = useState("");
  const [text, setText] = useState("Đặt báo thức sáu giờ sáng mai giúp mình nhé.");
  const [voice, setVoice] = useState("alloy");
  const [useAug, setUseAug] = useState(false);
  const [paug, setPaug] = useState<Aug>(DEFAULT_AUG);
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  const preview = async () => {
    setBusy(true);
    try {
      const blob = await api.ttsPreview({ model: pm, text, voice, augment: useAug ? (paug as unknown as Dict) : null });
      setUrl(URL.createObjectURL(blob));
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  // job
  const [ds, setDs] = useState("");
  const [jm, setJm] = useState("");
  const [voices, setVoices] = useState<Record<string, string>>({ bac: "alloy, nova", trung: "echo", nam: "shimmer, fable" });
  const [statuses, setStatuses] = useState<string[]>(["approved"]);
  const [aug, setAug] = useState<Aug>(DEFAULT_AUG);
  const [overwrite, setOverwrite] = useState(false);
  const [job, setJob] = useState<string | null>(null);
  const start = async () => {
    try {
      const r = await api.synthTts(ds, {
        model: jm,
        voices: { bac: csv(voices.bac), trung: csv(voices.trung), nam: csv(voices.nam) },
        statuses: statuses.length ? statuses : null,
        augment: aug,
        overwrite,
      });
      setJob(r.job_id);
      toast.success("Đã bắt đầu job TTS");
    } catch (e) {
      toast.error(e);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Nghe thử TTS">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Model TTS">
              <Select value={pm} onChange={setPm} placeholder="Chọn model…" options={tts} />
            </Field>
            <Field label="Giọng (voice)">
              <Input value={voice} onChange={(e) => setVoice(e.target.value)} />
            </Field>
          </div>
          <Field label="Văn bản">
            <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Toggle checked={useAug} onChange={setUseAug} label="Áp dụng augmentation (luôn áp dụng khi nghe thử)" />
          {useAug && <AugForm aug={paug} setAug={setPaug} />}
          <div className="flex items-center gap-3">
            <Button variant="primary" icon={<Play className="h-4 w-4" />} onClick={preview} loading={busy} disabled={!pm || !text}>
              Tổng hợp
            </Button>
            {url && <audio controls autoPlay src={url} className="h-9" />}
          </div>
          {!tts.length && <Notice color="yellow">Chưa có model TTS. Thêm ở trang Mô hình & Khoá (vai trò TTS).</Notice>}
        </div>
      </Card>
      <Card title="Tạo audio cho dataset tổng hợp" subtitle="Đọc mọi câu người dùng (history + câu cuối) thành file WAV, giọng theo vùng miền của mẫu">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Dataset">
              <Select value={ds} onChange={setDs} placeholder="Chọn dataset…" options={synth.map((d) => ({ value: d.id, label: `${d.name} (${d.n})` }))} />
            </Field>
            <Field label="Model TTS">
              <Select value={jm} onChange={setJm} placeholder="Chọn model…" options={tts} />
            </Field>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["bac", "trung", "nam"] as const).map((k) => (
              <Field key={k} label={`Giọng miền ${k === "bac" ? "Bắc" : k === "trung" ? "Trung" : "Nam"}`} hint="cách nhau bởi dấu phẩy">
                <Input value={voices[k]} onChange={(e) => setVoices({ ...voices, [k]: e.target.value })} />
              </Field>
            ))}
          </div>
          <Field label="Chỉ mẫu có trạng thái" hint="Trống = mọi mẫu">
            <MultiSelect value={statuses} onChange={setStatuses} options={["approved", "pending", "needs_relabel", "rejected"].map((x) => ({ value: x, label: statusVi(x) }))} placeholder="Mọi mẫu" />
          </Field>
          <div>
            <div className="label">Augmentation</div>
            <AugForm aug={aug} setAug={setAug} showProb />
          </div>
          <Checkbox checked={overwrite} onChange={setOverwrite} label="Ghi đè file audio đã có" />
          <div>
            <Button variant="primary" icon={<Mic className="h-4 w-4" />} onClick={start} disabled={!ds || !jm}>
              Bắt đầu TTS
            </Button>
          </div>
          {job && <JobProgress id={job} />}
        </div>
      </Card>
    </div>
  );
}
