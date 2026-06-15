import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Keyboard,
  Mouse,
  MemoryStick,
  Box,
  Sparkles,
  Waves,
  Flame,
  Activity,
  Rainbow,
  Circle,
  Zap,
  FastForward,
  Aperture,
  Disc3,
  Blend,
  Power,
  Link2,
  Save,
  Upload,
  Download,
  CheckCircle2,
  AlertTriangle,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { SliderRow } from "@/components/ui/slider";
import { SectionTitle } from "@/components/ui/section";
import { KeyboardPreview, type RgbEffect } from "@/components/rgb/keyboard-preview";
import { HuePicker } from "@/components/rgb/hue-picker";
import { CapabilityGate, CapabilityBadge } from "@/components/ui/capability-gate";
import { useCapability, useTelemetrySource } from "@/hooks/use-telemetry";
import { rgbApply, rgbOff, rgbSaveProfile, rgbImportProfile } from "@/lib/ipc";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

const DEVICES = [
  { id: "keyboard", label: "Keyboard", icon: Keyboard, zones: 4 },
  { id: "mouse", label: "Mouse", icon: Mouse, zones: 3 },
  { id: "ram", label: "Memory", icon: MemoryStick, zones: 8 },
  { id: "case", label: "Case", icon: Box, zones: 12 },
];

const EFFECT_ICONS: Record<RgbEffect, LucideIcon> = {
  static: Circle,
  breathing: Activity,
  rainbow: Rainbow,
  wave: Waves,
  pulse: Zap,
  chase: FastForward,
  sparkle: Sparkles,
  candle: Flame,
  aurora: Aperture,
  disco: Disc3,
  gradient: Blend,
};
const ALL_EFFECTS = Object.keys(EFFECT_ICONS) as RgbEffect[];

const PRESETS: { name: string; effect: RgbEffect; hue: number; speed: number }[] = [
  { name: "Nebula", effect: "aurora", hue: 270, speed: 50 },
  { name: "Inferno", effect: "breathing", hue: 12, speed: 60 },
  { name: "Toxic", effect: "pulse", hue: 95, speed: 70 },
  { name: "Ocean", effect: "wave", hue: 200, speed: 45 },
  { name: "Rainbow", effect: "rainbow", hue: 0, speed: 60 },
  { name: "Party", effect: "disco", hue: 0, speed: 90 },
];

function formatError(e: unknown): string {
  const err = e as { kind?: string; detail?: string };
  switch (err?.kind) {
    case "permissionDenied":
      return "Permission denied — add your user to the 'input' group: sudo usermod -aG input $USER, then re-login.";
    case "driverUnavailable":
      return `Driver unavailable: ${err.detail ?? "RGB controller not found"}`;
    case "invalidParameter":
      return `Invalid: ${err.detail ?? ""}`;
    case "notImplemented":
      return "Not implemented yet.";
    default:
      return typeof e === "string" ? e : "Failed to apply lighting.";
  }
}

type Status = { kind: "idle" | "ok" | "error"; msg: string };

export default function RgbStudioPage() {
  const [device, setDevice] = useState("keyboard");
  const [effect, setEffect] = useState<RgbEffect>("aurora");
  const [hue, setHue] = useState(270);
  const [brightness, setBrightness] = useState(80);
  const [speed, setSpeed] = useState(55);
  const [power, setPower] = useState(true);
  const [sync, setSync] = useState(true);
  const [status, setStatus] = useState<Status>({ kind: "idle", msg: "" });

  const rgbCap = useCapability("rgb");
  const source = useTelemetrySource();
  const live = source === "live" && !!rgbCap?.status.controllable;
  const isKeyboard = device === "keyboard";

  const debounce = useRef<number | undefined>(undefined);
  const firstRun = useRef(true);

  /** Push the current settings to the hardware (debounced, live only). */
  const apply = useCallback(async () => {
    if (!live) {
      setStatus({ kind: "ok", msg: "Demo mode — connect under Tauri to drive hardware." });
      return;
    }
    try {
      if (!power) {
        await rgbOff();
        setStatus({ kind: "ok", msg: "Lighting turned off." });
        return;
      }
      const payload = { effect, hue, brightness, speed };
      const out = await rgbApply(payload);
      setStatus({ kind: "ok", msg: out.message });
    } catch (e) {
      setStatus({ kind: "error", msg: formatError(e) });
    }
  }, [live, power, effect, hue, brightness, speed, source, rgbCap]);

  // Keep a stable ref to the latest `apply` so the auto-apply effect can call it
  // WITHOUT taking `apply` (and thus `live`/`source`/`rgbCap`) as a dependency.
  const applyRef = useRef(apply);
  useEffect(() => { applyRef.current = apply; }, [apply]);

  // Debounced auto-apply — fires ONLY when a control *value* changes, which only
  // happens through a user gesture (slider, effect, preset, power, import). It is
  // deliberately NOT keyed on `apply`/`live`/`source`/`rgbCap`: those change as
  // telemetry & capabilities hydrate after mount and on every poll tick, and
  // keying on them caused unsolicited RGB writes at startup (issue: "RGB changes
  // on launch"). `firstRun` additionally suppresses the initial mount, so startup
  // is strictly read-only — no [RGB WRITE] happens without explicit user input.
  useEffect(() => {
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }
    if (!isKeyboard) return;
    window.clearTimeout(debounce.current);
    debounce.current = window.setTimeout(() => applyRef.current(), 250);
    return () => window.clearTimeout(debounce.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect, hue, brightness, speed, power, isKeyboard]);

  async function saveScene() {
    const name = window.prompt("Save lighting scene as:");
    if (!name) return;
    const profile = { name, effect, hue, brightness, speed, zones: [] };
    if (!live) {
      setStatus({ kind: "ok", msg: `Saved '${name}' (demo).` });
      return;
    }
    try {
      await rgbSaveProfile(profile);
      setStatus({ kind: "ok", msg: `Saved scene '${name}'.` });
    } catch (e) {
      setStatus({ kind: "error", msg: formatError(e) });
    }
  }

  function exportTheme() {
    const theme = JSON.stringify({ name: "Nexus Theme", effect, hue, brightness, speed, zones: [] }, null, 2);
    navigator.clipboard?.writeText(theme);
    setStatus({ kind: "ok", msg: "Theme JSON copied to clipboard." });
  }

  async function importTheme() {
    const json = window.prompt("Paste theme JSON:");
    if (!json) return;
    try {
      const p = JSON.parse(json);
      setEffect(p.effect);
      setHue(p.hue);
      setBrightness(p.brightness);
      setSpeed(p.speed);
      if (live) await rgbImportProfile(json);
      setStatus({ kind: "ok", msg: `Imported theme '${p.name ?? "theme"}'.` });
    } catch (e) {
      setStatus({ kind: "error", msg: formatError(e) });
    }
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setEffect(p.effect);
    setHue(p.hue);
    setSpeed(p.speed);
  }

  const effects = (rgbCap?.effects?.length ? rgbCap.effects : ALL_EFFECTS) as RgbEffect[];

  return (
    <div>
      <PageHeader
        title="RGB Studio"
        description="Compose lighting across every device and zone."
        actions={
          <>
            <CapabilityBadge status={rgbCap?.status} />
            <Badge variant={sync ? "accent" : "neutral"} size="md">
              <Link2 className="h-3.5 w-3.5" /> {sync ? "Synced" : "Independent"}
            </Badge>
            <Button variant="ghost" size="icon" onClick={importTheme} aria-label="Import theme">
              <Upload className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={exportTheme} aria-label="Export theme">
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="primary" size="md" onClick={saveScene} disabled={!rgbCap?.status.controllable}>
              <Save className="h-4 w-4" /> Save Scene
            </Button>
          </>
        }
      />

      {/* Status banner */}
      {status.kind !== "idle" && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "mb-md flex items-center gap-sm rounded-lg border p-sm text-sm",
            status.kind === "error"
              ? "border-danger/30 bg-danger/10 text-danger"
              : "border-success/30 bg-success/10 text-success",
          )}
        >
          {status.kind === "error" ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1">{status.msg}</span>
        </motion.div>
      )}

      <motion.div
        variants={stagger(0.05)}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-md xl:grid-cols-[1fr_360px]"
      >
        {/* Preview + devices */}
        <motion.div variants={fadeUp} className="space-y-md">
          <GlassCard padding="lg">
            <SectionTitle
              title="Live Preview"
              description={`${DEVICES.find((d) => d.id === device)?.zones} addressable zones`}
              action={
                <div className="flex items-center gap-sm">
                  <span className="text-xs text-content-muted">Power</span>
                  <Switch checked={power} onCheckedChange={setPower} />
                </div>
              }
            />
            <div className={cn("transition-opacity", !power && "pointer-events-none opacity-30")}>
              <KeyboardPreview effect={effect} hue={hue} brightness={brightness} speed={speed} />
            </div>

            <div className="mt-md grid grid-cols-4 gap-sm">
              {DEVICES.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setDevice(d.id)}
                  className={cn(
                    "group flex flex-col items-center gap-xs rounded-lg border p-md transition-all",
                    device === d.id ? "border-accent/50 bg-accent/8 shadow-glow" : "border-border hover:border-border-strong",
                  )}
                >
                  <d.icon className={cn("h-6 w-6 transition-colors", device === d.id ? "text-accent-strong" : "text-content-muted")} />
                  <span className="text-xs font-medium text-content">{d.label}</span>
                  <span className="text-2xs text-content-subtle">{d.zones} zones</span>
                </button>
              ))}
            </div>
            {!isKeyboard && (
              <p className="mt-sm text-2xs text-content-subtle">
                Hardware control is wired for the keyboard; other devices use the preview only.
              </p>
            )}
          </GlassCard>

          {/* Effects grid */}
          <GlassCard padding="lg">
            <SectionTitle title="Effect" description={`${effects.length} hardware modes`} />
            <div className="grid grid-cols-2 gap-sm sm:grid-cols-3">
              {effects.map((e) => {
                const Icon = EFFECT_ICONS[e] ?? Circle;
                return (
                  <button
                    key={e}
                    onClick={() => setEffect(e)}
                    className={cn(
                      "flex items-center gap-sm rounded-lg border p-md text-left capitalize transition-all",
                      effect === e ? "border-accent/50 bg-accent/8" : "border-border hover:border-border-strong",
                    )}
                  >
                    <span className={cn("grid h-9 w-9 place-items-center rounded-md transition-colors", effect === e ? "bg-accent/20 text-accent-strong" : "bg-surface-raised text-content-muted")}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="text-sm font-medium text-content">{e}</span>
                  </button>
                );
              })}
            </div>
          </GlassCard>
        </motion.div>

        {/* Controls — gated on RGB capability */}
        <motion.div variants={fadeUp}>
          <CapabilityGate status={rgbCap?.status} className="space-y-md">
            <GlassCard padding="lg">
              <SectionTitle title="Color" />
              <div
                className="mb-md h-20 rounded-lg ring-1 ring-inset ring-white/10"
                style={{ background: `linear-gradient(120deg, hsl(${hue} 90% 55%), hsl(${(hue + 40) % 360} 90% 50%))` }}
              />
              <HuePicker hue={hue} onChange={setHue} />
              <p className="mt-sm flex items-center justify-between text-xs text-content-muted">
                <span>Hue</span>
                <span className="font-mono tabular-nums text-content">{hue}°</span>
              </p>
            </GlassCard>

            <GlassCard padding="lg">
              <SectionTitle title="Parameters" />
              <SliderRow label="Brightness" value={brightness} unit="%" onValueChange={setBrightness} />
              <SliderRow label="Speed" value={speed} unit="%" onValueChange={setSpeed} />
              <label className="mt-sm flex items-center justify-between border-t border-border-subtle pt-md">
                <span className="text-sm font-medium text-content">Sync all devices</span>
                <Switch checked={sync} onCheckedChange={setSync} />
              </label>
            </GlassCard>

            <GlassCard padding="lg">
              <SectionTitle title="Presets" description="Quick scenes" />
              <div className="grid grid-cols-2 gap-sm">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    onClick={() => applyPreset(p)}
                    className="group overflow-hidden rounded-lg border border-border text-left transition-all hover:border-accent/50"
                  >
                    <div className="h-12" style={{ background: `linear-gradient(120deg, hsl(${p.hue} 90% 55%), hsl(${(p.hue + 60) % 360} 90% 55%))` }} />
                    <p className="px-sm py-xs text-xs font-medium text-content">{p.name}</p>
                  </button>
                ))}
              </div>
            </GlassCard>

            <Button variant="glass" size="lg" className="w-full" onClick={() => setPower((p) => !p)}>
              <Power className="h-4 w-4" /> {power ? "Turn Off Lighting" : "Turn On Lighting"}
            </Button>
          </CapabilityGate>
        </motion.div>
      </motion.div>
    </div>
  );
}
