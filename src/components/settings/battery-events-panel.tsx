import { useRef, useState } from "react";
import { Volume2, Play, Upload, BatteryCharging, BatteryLow } from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  useBatteryEventsStore,
  CONNECT_ANIMS,
  DISCONNECT_ANIMS,
  SOUND_CHOICES,
  MAX_CUSTOM_SOUND_BYTES,
  type SoundChoice,
} from "@/store/battery-events-store";
import { playSound } from "@/lib/sound";
import { cn } from "@/lib/cn";

function readAudioFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_CUSTOM_SOUND_BYTES) {
      reject(new Error("File too large — max 1 MB."));
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

/** Settings → Battery Events: charging sounds + animations. */
export function BatteryEventsPanel() {
  const s = useBatteryEventsStore();

  return (
    <GlassCard padding="lg">
      <h3 className="flex items-center gap-xs text-lg font-semibold text-content">
        <BatteryCharging className="h-4 w-4 text-accent" /> Battery Events
      </h3>
      <p className="mb-md text-sm text-content-muted">
        How Nexus reacts when the charger connects or disconnects.
      </p>

      {/* Sounds */}
      <div className="space-y-md rounded-lg border border-border-subtle bg-surface-sunken/30 p-md">
        <label className="flex items-center justify-between">
          <span className="flex items-center gap-xs text-sm font-medium text-content">
            <Volume2 className="h-4 w-4 text-content-muted" /> Sounds
          </span>
          <Switch checked={s.soundEnabled} onCheckedChange={s.setSoundEnabled} />
        </label>

        <div className={cn("space-y-md transition-opacity", !s.soundEnabled && "pointer-events-none opacity-50")}>
          <div className="flex items-center gap-md">
            <span className="w-16 text-xs text-content-muted">Volume</span>
            <Slider
              value={[Math.round(s.volume * 100)]}
              min={0}
              max={100}
              step={5}
              onValueChange={(v) => s.setVolume(v[0] / 100)}
              className="flex-1"
            />
            <span className="w-10 text-right text-xs tabular-nums text-content-subtle">{Math.round(s.volume * 100)}%</span>
          </div>

          <SoundPicker
            label="AC connected"
            choice={s.connectSound}
            onChoice={s.setConnectSound}
            custom={s.connectCustom}
            setCustom={s.setConnectCustom}
            onPreview={() => playSound(s.connectSound, s.connectCustom, s.volume)}
          />
          <SoundPicker
            label="AC disconnected"
            choice={s.disconnectSound}
            onChoice={s.setDisconnectSound}
            custom={s.disconnectCustom}
            setCustom={s.setDisconnectCustom}
            onPreview={() => playSound(s.disconnectSound, s.disconnectCustom, s.volume)}
          />
        </div>
      </div>

      {/* Animations */}
      <div className="mt-md space-y-md rounded-lg border border-border-subtle bg-surface-sunken/30 p-md">
        <ChipRow
          icon={BatteryCharging}
          label="Connect animation"
          options={CONNECT_ANIMS}
          value={s.connectAnim}
          onChange={s.setConnectAnim}
        />
        <ChipRow
          icon={BatteryLow}
          label="Disconnect animation"
          options={DISCONNECT_ANIMS}
          value={s.disconnectAnim}
          onChange={s.setDisconnectAnim}
        />
        <p className="text-2xs text-content-subtle">
          Animations play on the battery graphic in Battery Center. Continuous and transition effects respect the
          Appearance → Animations setting (off / low keeps them static).
        </p>
      </div>
    </GlassCard>
  );
}

function SoundPicker({
  label,
  choice,
  onChoice,
  custom,
  setCustom,
  onPreview,
}: {
  label: string;
  choice: SoundChoice;
  onChoice: (s: SoundChoice) => void;
  custom: string | null;
  setCustom: (url: string | null) => void;
  onPreview: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setErr(null);
    try {
      setCustom(await readAudioFile(file));
      onChoice("custom");
    } catch (ex) {
      setErr(String(ex instanceof Error ? ex.message : ex));
    }
  }

  return (
    <div>
      <div className="mb-xs flex items-center justify-between">
        <span className="text-xs font-medium text-content-muted">{label}</span>
        <button
          onClick={onPreview}
          disabled={choice === "none" || (choice === "custom" && !custom)}
          className="inline-flex items-center gap-xs rounded-md border border-border px-sm py-1 text-2xs font-medium text-content-muted transition-colors hover:text-content disabled:opacity-40"
        >
          <Play className="h-3 w-3" /> Preview
        </button>
      </div>
      <div className="flex flex-wrap gap-xs">
        {SOUND_CHOICES.map((c) => (
          <Chip key={c.id} active={choice === c.id} onClick={() => onChoice(c.id)}>
            {c.label}
          </Chip>
        ))}
        {choice === "custom" && (
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> {custom ? "Replace file" : "Choose file"}
          </Button>
        )}
      </div>
      <input ref={fileRef} type="file" accept="audio/*,.wav,.ogg,.mp3" hidden onChange={pick} />
      {choice === "custom" && !custom && <p className="mt-xs text-2xs text-content-subtle">Pick a wav / ogg / mp3 (max 1 MB).</p>}
      {err && <p className="mt-xs text-2xs text-danger">{err}</p>}
    </div>
  );
}

function ChipRow<T extends string>({
  icon: Icon,
  label,
  options,
  value,
  onChange,
}: {
  icon: typeof BatteryCharging;
  label: string;
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <span className="mb-xs flex items-center gap-xs text-xs font-medium text-content-muted">
        <Icon className="h-3.5 w-3.5" /> {label}
      </span>
      <div className="flex flex-wrap gap-xs">
        {options.map((o) => (
          <Chip key={o.id} active={value === o.id} onClick={() => onChange(o.id)}>
            {o.label}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md border px-sm py-xs text-2xs font-medium transition-colors",
        active ? "border-accent/60 bg-accent/12 text-accent-strong" : "border-border text-content-muted hover:text-content",
      )}
    >
      {children}
    </button>
  );
}
