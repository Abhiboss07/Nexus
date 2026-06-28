import { useEffect, useRef, useState } from "react";
import {
  Volume2,
  Play,
  Upload,
  BatteryCharging,
  Plus,
  Download,
  Trash2,
  RotateCcw,
  Sparkles,
  Pencil,
  SlidersHorizontal,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import {
  useBatteryEventsStore,
  BATTERY_EVENTS,
  CONTINUOUS_ANIMS,
  ONESHOT_ANIMS,
  SOUND_CHOICES,
  defaultFx,
  type SoundChoice,
  type SoundFx,
  type BatteryEvent,
} from "@/store/battery-events-store";
import { BatteryGlyph, type GlyphOverride } from "@/components/battery/battery-glyph";
import { EffectBuilder } from "@/components/battery/effect-builder";
import { SoundPackImport } from "@/components/battery/sound-pack-import";
import { WaveformTrim } from "@/components/battery/waveform-trim";
import { playSound } from "@/lib/sound";
import { readAudioFile } from "@/lib/sound-pack";
import { simulateBatteryEvent } from "@/lib/ipc";
import { pushToast } from "@/store/toast-store";
import { cn } from "@/lib/cn";

function downloadJson(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Settings → Battery Events: per-event animations + sounds, profiles, live preview. */
export function BatteryEventsPanel() {
  const s = useBatteryEventsStore();
  const [activeEvent, setActiveEvent] = useState<BatteryEvent>("connect");
  const [nonce, setNonce] = useState(0);
  const [editingEffectId, setEditingEffectId] = useState<string | null>(null);

  const meta = BATTERY_EVENTS.find((e) => e.id === activeEvent)!;
  const cfg = s.events[activeEvent];
  const animOptions = meta.kind === "continuous" ? CONTINUOUS_ANIMS : ONESHOT_ANIMS;
  const activeEffect = cfg.effectId ? s.customEffects.find((e) => e.id === cfg.effectId) ?? null : null;
  const editingEffect = editingEffectId ? s.customEffects.find((e) => e.id === editingEffectId) ?? null : null;

  // Replay one-shot previews whenever the event, its anim or its effect changes.
  useEffect(() => {
    if (meta.kind === "oneshot") setNonce((n) => n + 1);
  }, [activeEvent, cfg.anim, cfg.effectId, meta.kind]);

  const newEffect = () => {
    const id = s.createEffect("Custom effect");
    s.setEventEffect(activeEvent, id);
    setEditingEffectId(id);
  };

  const override: GlyphOverride = { anim: cfg.anim, kind: meta.kind, nonce, effect: activeEffect };

  return (
    <GlassCard padding="lg">
      <h3 className="flex items-center gap-xs text-lg font-semibold text-content">
        <BatteryCharging className="h-4 w-4 text-accent" /> Battery Events
      </h3>
      <p className="mb-md text-sm text-content-muted">
        Give every power transition its own animation and sound. Pick an event, tune it, and watch the live preview.
      </p>

      <ProfileBar />

      <div className="mt-md">
        <SoundPackImport />
      </div>

      {/* Global sound */}
      <div className="mt-md space-y-md rounded-lg border border-border-subtle bg-surface-sunken/30 p-md">
        <label className="flex items-center justify-between">
          <span className="flex items-center gap-xs text-sm font-medium text-content">
            <Volume2 className="h-4 w-4 text-content-muted" /> Sounds
          </span>
          <Switch checked={s.soundEnabled} onCheckedChange={s.setSoundEnabled} />
        </label>
        <div className={cn("flex items-center gap-md transition-opacity", !s.soundEnabled && "pointer-events-none opacity-50")}>
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
      </div>

      {/* Event picker */}
      <div className="mt-md">
        <span className="mb-xs block text-xs font-medium text-content-muted">Event</span>
        <div className="flex flex-wrap gap-xs">
          {BATTERY_EVENTS.map((e) => (
            <Chip key={e.id} active={activeEvent === e.id} onClick={() => setActiveEvent(e.id)}>
              {e.label}
            </Chip>
          ))}
        </div>
      </div>

      {/* Editor + live preview */}
      <div className="mt-md grid grid-cols-1 gap-md md:grid-cols-[1fr_auto]">
        <div className="space-y-md rounded-lg border border-border-subtle bg-surface-sunken/30 p-md">
          <p className="text-2xs text-content-subtle">{meta.desc}</p>

          <div>
            <span className="mb-xs block text-xs font-medium text-content-muted">Animation</span>
            <div className={cn("flex flex-wrap gap-xs transition-opacity", activeEffect && "opacity-40")}>
              {animOptions.map((o) => (
                <Chip key={o.id} active={!activeEffect && cfg.anim === o.id} onClick={() => s.setEventAnim(activeEvent, o.id)}>
                  {o.label}
                </Chip>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-xs flex items-center justify-between">
              <span className="flex items-center gap-xs text-xs font-medium text-content-muted">
                <Sparkles className="h-3.5 w-3.5" /> Custom effect
              </span>
              <Button variant="ghost" size="sm" onClick={newEffect}>
                <Plus className="h-3.5 w-3.5" /> New
              </Button>
            </div>
            {s.customEffects.length > 0 ? (
              <div className="flex flex-wrap gap-xs">
                {s.customEffects.map((e) => {
                  const active = cfg.effectId === e.id;
                  return (
                    <div
                      key={e.id}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-md border pl-sm pr-1 py-2xs",
                        active ? "border-accent/60 bg-accent/12" : "border-border",
                      )}
                    >
                      <button
                        onClick={() => s.setEventEffect(activeEvent, active ? null : e.id)}
                        className={cn("text-2xs font-medium", active ? "text-accent-strong" : "text-content-muted hover:text-content")}
                      >
                        {e.name}
                      </button>
                      <button
                        onClick={() => setEditingEffectId((id) => (id === e.id ? null : e.id))}
                        className="text-content-subtle hover:text-content"
                        title="Edit effect"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-2xs text-content-subtle">No custom effects yet — build one with “New”.</p>
            )}
          </div>

          <SoundPicker
            label="Sound"
            choice={cfg.sound}
            onChoice={(c) => s.setEventSound(activeEvent, c)}
            custom={cfg.custom}
            setCustom={(u) => s.setEventCustom(activeEvent, u)}
            onPreview={() => playSound(cfg.sound, cfg.custom, s.volume, cfg.fx)}
          />

          {cfg.sound !== "none" && (
            <SoundFxControls
              fx={cfg.fx}
              custom={cfg.sound === "custom"}
              customUrl={cfg.custom}
              onChange={(patch) => s.setEventFx(activeEvent, patch)}
              onReset={() => s.setEventFx(activeEvent, defaultFx())}
            />
          )}
        </div>

        {/* Live preview */}
        <div className="flex flex-col items-center justify-center gap-sm rounded-lg border border-border-subtle bg-surface-sunken/30 px-lg py-md">
          <BatteryGlyph level={72} charging={meta.kind === "continuous"} override={override} />
          {meta.kind === "oneshot" ? (
            <button
              onClick={() => setNonce((n) => n + 1)}
              className="inline-flex items-center gap-xs rounded-md border border-border px-sm py-1 text-2xs font-medium text-content-muted transition-colors hover:text-content"
            >
              <RotateCcw className="h-3 w-3" /> Replay
            </button>
          ) : (
            <span className="text-2xs text-content-subtle">Live preview</span>
          )}
        </div>
      </div>

      {editingEffect && (
        <div className="mt-md">
          <EffectBuilder effect={editingEffect} onDelete={() => setEditingEffectId(null)} />
        </div>
      )}

      {import.meta.env.DEV && (
        <div className="mt-md rounded-lg border border-dashed border-warning/40 bg-warning/5 p-md">
          <span className="text-2xs font-medium uppercase tracking-wider text-warning">Dev · simulate event</span>
          <p className="mb-xs mt-2xs text-2xs text-content-subtle">
            Fires the real backend path (native notification + bell + toast/sound) without a physical plug/unplug.
          </p>
          <div className="flex flex-wrap gap-xs">
            {BATTERY_EVENTS.map((e) => (
              <Chip key={e.id} active={false} onClick={() => void simulateBatteryEvent(e.id)}>
                {e.label}
              </Chip>
            ))}
          </div>
        </div>
      )}

      <p className="mt-md text-2xs text-content-subtle">
        Animations play on the battery graphic in Battery Center and respect the Appearance → Animations setting (off / low keeps
        them static).
      </p>
    </GlassCard>
  );
}

/** Save / apply / import / export the full Battery Events configuration. */
function ProfileBar() {
  const profiles = useBatteryEventsStore((s) => s.profiles);
  const saveProfile = useBatteryEventsStore((s) => s.saveProfile);
  const applyProfile = useBatteryEventsStore((s) => s.applyProfile);
  const deleteProfile = useBatteryEventsStore((s) => s.deleteProfile);
  const exportConfig = useBatteryEventsStore((s) => s.exportConfig);
  const importProfile = useBatteryEventsStore((s) => s.importProfile);
  const resetDefaults = useBatteryEventsStore((s) => s.resetDefaults);

  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const save = () => {
    saveProfile(name || "My profile");
    setName("");
    setNaming(false);
    pushToast({ tone: "success", icon: "info", title: "Profile saved" });
  };

  async function onImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const text = await file.text();
    const res = importProfile(text);
    if (res.ok) pushToast({ tone: "success", icon: "info", title: "Profile imported" });
    else pushToast({ tone: "danger", icon: "info", title: "Import failed", body: res.error });
  }

  return (
    <div className="space-y-sm rounded-lg border border-border-subtle bg-surface-sunken/30 p-md">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-content-muted">Profiles</span>
        <div className="flex items-center gap-xs">
          <Button variant="ghost" size="sm" onClick={() => downloadJson("battery-events.json", exportConfig())}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
            <Upload className="h-3.5 w-3.5" /> Import
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setNaming((v) => !v)}>
            <Plus className="h-3.5 w-3.5" /> Save current
          </Button>
        </div>
      </div>

      {naming && (
        <div className="flex items-center gap-xs">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
            placeholder="Profile name"
            className="flex-1 rounded-md border border-border bg-surface-sunken px-sm py-1 text-xs text-content outline-none focus:border-accent/60"
          />
          <Button size="sm" onClick={save}>Save</Button>
        </div>
      )}

      {profiles.length > 0 ? (
        <div className="flex flex-wrap gap-xs">
          {profiles.map((p) => (
            <div key={p.id} className="inline-flex items-center gap-1 rounded-md border border-border pl-sm pr-1 py-2xs">
              <button onClick={() => applyProfile(p.id)} className="text-2xs font-medium text-content-muted hover:text-content">
                {p.name}
              </button>
              <button
                onClick={() => downloadJson(`${p.name.replace(/\s+/g, "-").toLowerCase()}.json`, exportConfig(p.id))}
                className="text-content-subtle hover:text-content"
                title="Export this profile"
              >
                <Download className="h-3 w-3" />
              </button>
              <button onClick={() => deleteProfile(p.id)} className="text-content-subtle hover:text-danger" title="Delete">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-2xs text-content-subtle">No saved profiles yet. Tune your events, then “Save current”.</p>
      )}

      <button
        onClick={() => {
          resetDefaults();
          pushToast({ tone: "info", icon: "info", title: "Reset to defaults" });
        }}
        className="inline-flex items-center gap-xs text-2xs text-content-subtle transition-colors hover:text-content"
      >
        <RotateCcw className="h-3 w-3" /> Reset all to defaults
      </button>

      <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={onImport} />
    </div>
  );
}

function SoundFxControls({
  fx,
  custom,
  customUrl,
  onChange,
  onReset,
}: {
  fx: SoundFx;
  custom: boolean;
  customUrl: string | null;
  onChange: (patch: Partial<SoundFx>) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const edited = JSON.stringify(fx) !== JSON.stringify(defaultFx());

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-xs text-xs font-medium text-content-muted transition-colors hover:text-content"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" /> Fine-tune sound
        {edited && <span className="text-2xs text-accent">• edited</span>}
      </button>
      {open && (
        <div className="mt-sm space-y-sm rounded-md border border-border-subtle bg-surface-sunken/40 p-sm">
          <FxRow label="Fade in" value={fx.fadeIn} min={0} max={3000} step={50} fmt={(v) => `${v}ms`} onChange={(v) => onChange({ fadeIn: v })} />
          <FxRow label="Fade out" value={fx.fadeOut} min={0} max={3000} step={50} fmt={(v) => `${v}ms`} onChange={(v) => onChange({ fadeOut: v })} />
          {custom && customUrl && (
            <div>
              <span className="mb-xs block text-2xs text-content-muted">Trim — drag the handles</span>
              <WaveformTrim url={customUrl} trimStart={fx.trimStart} trimEnd={fx.trimEnd} onChange={onChange} />
            </div>
          )}
          <FxRow label="Pitch" value={fx.pitch} min={-12} max={12} step={1} fmt={(v) => `${v > 0 ? "+" : ""}${v} st`} onChange={(v) => onChange({ pitch: v })} />
          <FxRow label="Speed" value={fx.speed} min={0.5} max={2} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onChange={(v) => onChange({ speed: v })} />
          <FxRow label="Delay" value={fx.delay} min={0} max={3000} step={50} fmt={(v) => `${v}ms`} onChange={(v) => onChange({ delay: v })} />
          <FxRow label="Repeat" value={fx.repeat} min={1} max={5} step={1} fmt={(v) => `${v}×`} onChange={(v) => onChange({ repeat: v })} />
          <div className="flex items-center justify-between">
            <button onClick={onReset} className="inline-flex items-center gap-xs text-2xs text-content-subtle transition-colors hover:text-content">
              <RotateCcw className="h-3 w-3" /> Reset
            </button>
            {!custom && <span className="text-2xs text-content-subtle">Trim applies to custom files.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

function FxRow({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  fmt: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-sm">
      <span className="w-16 text-2xs text-content-muted">{label}</span>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} className="flex-1" />
      <span className="w-12 text-right text-2xs tabular-nums text-content-subtle">{fmt(value)}</span>
    </div>
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
