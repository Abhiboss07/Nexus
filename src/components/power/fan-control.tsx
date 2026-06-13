import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Fan,
  Wind,
  Zap,
  Gauge,
  Leaf,
  Flame,
  Sliders,
  Save,
  Upload,
  Download,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Lock,
  type LucideIcon,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { Slider } from "@/components/ui/slider";
import { SectionTitle, StatRow } from "@/components/ui/section";
import { FanCurveEditor, curveWarnings, curvePctAt } from "@/components/power/fan-curve-editor";
import { useThermal } from "@/hooks/use-thermal";
import { useFans, useThermals, useTelemetrySource } from "@/hooks/use-telemetry";
import { formatControlError } from "@/hooks/use-control";
import {
  fanSetCurve,
  fanDisableCurve,
  fanSetThermalProfile,
  fanSetMaxFan,
  fanApplyProfile,
  fanImportProfile,
} from "@/lib/ipc";
import type { CurvePoint, FanProfile } from "@/lib/fan-types";
import { cn } from "@/lib/cn";

type ThermalProfile = "performance" | "normal" | "silent";
type Status = { kind: "idle" | "ok" | "error"; msg: string };

const PRESETS: { name: string; icon: LucideIcon; profile: FanProfile }[] = [
  { name: "Silent", icon: Leaf, profile: { name: "Silent", builtin: true, thermalProfile: "silent", maxFan: false, curve: [{ tempC: 50, pct: 20 }, { tempC: 65, pct: 35 }, { tempC: 80, pct: 60 }, { tempC: 90, pct: 80 }] } },
  { name: "Balanced", icon: Gauge, profile: { name: "Balanced", builtin: true, thermalProfile: "normal", maxFan: false, curve: [{ tempC: 45, pct: 25 }, { tempC: 60, pct: 40 }, { tempC: 75, pct: 65 }, { tempC: 88, pct: 90 }] } },
  { name: "Gaming", icon: Zap, profile: { name: "Gaming", builtin: true, thermalProfile: "performance", maxFan: false, curve: [{ tempC: 45, pct: 35 }, { tempC: 60, pct: 55 }, { tempC: 75, pct: 80 }, { tempC: 88, pct: 100 }] } },
  { name: "Turbo", icon: Flame, profile: { name: "Turbo", builtin: true, thermalProfile: "performance", maxFan: true, curve: [] } },
  { name: "Custom", icon: Sliders, profile: { name: "Custom", builtin: true, thermalProfile: null, maxFan: false, curve: [{ tempC: 45, pct: 20 }, { tempC: 60, pct: 45 }, { tempC: 75, pct: 70 }, { tempC: 88, pct: 100 }] } },
];

export function FanControl() {
  const { fanInfo } = useThermal();
  const fans = useFans();
  const thermals = useThermals();
  const source = useTelemetrySource();
  const live = source === "live";

  const caps = fanInfo?.capabilities;
  const cpuTemp = thermals?.cpuC ?? 60;
  const cpuRpm = fans.find((f) => f.label === "CPU Fan")?.rpm ?? fanInfo?.cpuRpm ?? 0;
  const gpuRpm = fans.find((f) => f.label === "GPU Fan")?.rpm ?? fanInfo?.gpuRpm ?? 0;

  const [curve, setCurve] = useState<CurvePoint[]>([]);
  const [thermalProfile, setThermalProfile] = useState<ThermalProfile>("normal");
  const [maxFan, setMaxFan] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [simTemp, setSimTemp] = useState(Math.round(cpuTemp));
  const [status, setStatus] = useState<Status>({ kind: "idle", msg: "" });
  const [busy, setBusy] = useState(false);

  // Seed from the device's current curve once it loads.
  useEffect(() => {
    if (fanInfo && curve.length === 0) {
      setCurve(fanInfo.curve.length ? fanInfo.curve : PRESETS[4].profile.curve);
      if (fanInfo.thermalProfile && ["performance", "normal", "silent"].includes(fanInfo.thermalProfile))
        setThermalProfile(fanInfo.thermalProfile as ThermalProfile);
      setMaxFan(fanInfo.maxFan);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fanInfo]);

  // Not supported at all on this platform → hide entirely (never show broken UI).
  if (caps && (!caps.available || caps.interface === "none")) {
    return (
      <GlassCard padding="lg" className="flex items-center gap-md">
        <Fan className="h-8 w-8 text-content-subtle" />
        <div>
          <p className="text-sm font-semibold text-content">Fan control unavailable</p>
          <p className="text-xs text-content-muted">No supported fan interface on this device.</p>
        </div>
      </GlassCard>
    );
  }

  const warnings = curveWarnings(curve);
  const curveUnsafe = warnings.length > 0;

  async function run(fn: () => Promise<{ message: string }>, okMsg?: string) {
    setBusy(true);
    try {
      const out = await fn();
      setStatus({ kind: "ok", msg: okMsg ?? out.message });
    } catch (e) {
      setStatus({ kind: "error", msg: formatControlError(e) });
    } finally {
      setBusy(false);
    }
  }

  function applyPreset(p: (typeof PRESETS)[number]) {
    setActivePreset(p.name);
    if (p.profile.curve.length) setCurve(p.profile.curve);
    if (p.profile.thermalProfile) setThermalProfile(p.profile.thermalProfile as ThermalProfile);
    setMaxFan(p.profile.maxFan);
    if (!live) {
      setStatus({ kind: "ok", msg: `Demo — would apply ${p.name} profile.` });
      return;
    }
    run(() => fanApplyProfile(p.name), `Applied ${p.name} profile.`);
  }

  async function applyCurve() {
    if (curveUnsafe) return;
    if (!live) {
      setStatus({ kind: "ok", msg: "Demo — curve validated locally (no hardware write)." });
      return;
    }
    run(() => fanSetCurve(curve));
  }

  function exportProfile() {
    const profile: FanProfile = { name: activePreset ?? "Custom", builtin: false, thermalProfile, maxFan, curve };
    navigator.clipboard?.writeText(JSON.stringify(profile, null, 2));
    setStatus({ kind: "ok", msg: "Fan profile JSON copied to clipboard." });
  }

  async function importProfile() {
    const json = window.prompt("Paste fan profile JSON:");
    if (!json) return;
    try {
      const p = JSON.parse(json) as FanProfile;
      if (p.curve?.length) setCurve(p.curve);
      if (p.thermalProfile) setThermalProfile(p.thermalProfile as ThermalProfile);
      setMaxFan(!!p.maxFan);
      if (live) await fanImportProfile(json);
      setStatus({ kind: "ok", msg: `Imported '${p.name ?? "profile"}'.` });
    } catch (e) {
      setStatus({ kind: "error", msg: formatControlError(e) });
    }
  }

  const writable = caps?.writable ?? true;

  return (
    <GlassCard padding="lg">
      <SectionTitle
        title="Fan Control"
        description={caps ? `${caps.driver} · ${caps.interface}` : "Detecting…"}
        action={
          <div className="flex items-center gap-xs">
            <Badge variant={writable ? "success" : "warning"}>
              {writable ? <ShieldCheck className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
              {writable ? "Writable" : "Read-only"}
            </Badge>
            <Button variant="ghost" size="icon" onClick={importProfile} aria-label="Import"><Upload className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" onClick={exportProfile} aria-label="Export"><Download className="h-4 w-4" /></Button>
          </div>
        }
      />

      {/* Status / permission banner */}
      <AnimatePresence>
        {status.kind !== "idle" && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={cn("mb-md flex items-center gap-sm rounded-lg border p-sm text-sm", status.kind === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-success/30 bg-success/10 text-success")}>
            {status.kind === "error" ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1">{status.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>
      {!writable && status.kind === "idle" && (
        <div className="mb-md flex items-center gap-sm rounded-lg border border-warning/30 bg-warning/10 p-sm text-sm text-warning">
          <Lock className="h-4 w-4 shrink-0" />
          <span>{caps?.permissionNote}</span>
        </div>
      )}

      {/* Presets */}
      <div className="mb-md grid grid-cols-2 gap-sm sm:grid-cols-5">
        {PRESETS.map((p) => (
          <button key={p.name} disabled={busy} onClick={() => applyPreset(p)}
            className={cn("flex flex-col items-center gap-xs rounded-lg border p-md transition-all", activePreset === p.name ? "border-accent/60 bg-accent/8 shadow-glow" : "border-border hover:border-border-strong")}>
            <p.icon className={cn("h-5 w-5", activePreset === p.name ? "text-accent-strong" : "text-content-muted")} />
            <span className="text-xs font-medium text-content">{p.name}</span>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-[1fr_280px]">
        {/* Curve editor — only when the platform supports custom curves */}
        <div>
          {caps?.canSetCurve ? (
            <>
              <div className="mb-sm flex items-center justify-between">
                <p className="text-sm font-medium text-content">Fan Curve <span className="text-2xs text-content-subtle">· drag points · double-click to remove · click to add</span></p>
                <Badge variant="neutral" size="sm">{curve.length}/{caps.maxCurvePoints} pts</Badge>
              </div>
              <div className={cn("rounded-xl border border-border bg-surface-sunken/40 p-sm", maxFan && "pointer-events-none opacity-40")}>
                <FanCurveEditor points={curve} onChange={(c) => { setCurve(c); setActivePreset(null); }} currentTemp={cpuTemp} maxPoints={caps.maxCurvePoints} disabled={maxFan} />
              </div>
              {warnings.length > 0 && (
                <div className="mt-sm space-y-2xs">
                  {warnings.map((w, i) => (
                    <p key={i} className="flex items-center gap-xs text-xs text-danger"><AlertTriangle className="h-3 w-3" /> {w}</p>
                  ))}
                </div>
              )}
              <div className="mt-md flex gap-sm">
                <Button variant="primary" size="md" disabled={busy || curveUnsafe || maxFan} onClick={applyCurve}>
                  <Save className="h-4 w-4" /> Apply Curve
                </Button>
                <Button variant="ghost" size="md" disabled={busy} onClick={() => run(() => fanDisableCurve(), "Reverted to firmware fan control.")}>
                  <RotateCcw className="h-4 w-4" /> Firmware Auto
                </Button>
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center rounded-xl border border-dashed border-border p-lg text-center">
              <div>
                <Fan className="mx-auto h-8 w-8 text-content-subtle" />
                <p className="mt-sm text-sm text-content-muted">Custom curves not supported on this fan interface ({caps?.interface}).</p>
                <p className="text-2xs text-content-subtle">Thermal profile & max-fan are available below.</p>
              </div>
            </div>
          )}
        </div>

        {/* Side controls: thermal profile, max fan, simulator, live RPM */}
        <div className="space-y-md">
          {caps?.canSetThermalProfile && (
            <div>
              <p className="mb-xs text-sm font-medium text-content">Thermal Profile</p>
              <Segmented<ThermalProfile>
                className="w-full"
                value={thermalProfile}
                onChange={(v) => { setThermalProfile(v); if (live) run(() => fanSetThermalProfile(v), `Thermal profile → ${v}`); }}
                options={[
                  { value: "silent", label: "Silent" },
                  { value: "normal", label: "Normal" },
                  { value: "performance", label: "Perf" },
                ]}
              />
            </div>
          )}

          {caps?.canMaxFan && (
            <label className="flex items-center justify-between rounded-lg border border-border p-md">
              <span className="flex items-center gap-sm">
                <Flame className={cn("h-4 w-4", maxFan ? "text-danger" : "text-content-subtle")} />
                <span className="text-sm font-medium text-content">Max Fan Boost</span>
              </span>
              <Switch checked={maxFan} onCheckedChange={(v) => { setMaxFan(v); if (live) run(() => fanSetMaxFan(v), `Max fan ${v ? "on" : "off"}`); }} />
            </label>
          )}

          {/* Thermal simulator */}
          {caps?.canSetCurve && (
            <div className="rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
              <div className="mb-xs flex items-center justify-between">
                <span className="flex items-center gap-xs text-sm font-medium text-content"><Wind className="h-4 w-4 text-accent" /> Simulator</span>
                <span className="text-xs font-semibold tabular-nums text-accent-strong">{simTemp}°C → {curvePctAt(curve, simTemp)}%</span>
              </div>
              <Slider value={[simTemp]} min={30} max={100} step={1} onValueChange={(v) => setSimTemp(v[0])} />
              <p className="mt-xs text-2xs text-content-subtle">Drag to preview the fan % your curve commands at any temperature.</p>
            </div>
          )}

          {/* Live RPM feedback */}
          <div className="rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
            <p className="mb-xs flex items-center gap-xs text-sm font-medium text-content"><Fan className="h-4 w-4 text-info" /> Live RPM</p>
            <StatRow label="CPU Fan" value={`${cpuRpm} rpm`} />
            <StatRow label="GPU Fan" value={`${gpuRpm} rpm`} />
            <StatRow label="CPU Temp" value={`${cpuTemp.toFixed(0)}°C`} tone={cpuTemp > 82 ? "warning" : "success"} />
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
