import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Monitor,
  Cpu,
  Palette,
  BatteryCharging,
  Sparkles,
  RefreshCw,
  Puzzle,
  Layers,
  UserCog,
  Check,
  Rocket,
  Stethoscope,
  Gauge,
  Bot,
  Download,
  FolderOpen,
  ExternalLink,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Activity,
  Zap,
  FileText,
  Film,
  Keyboard,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { StatRow } from "@/components/ui/section";
import { THEMES } from "@/config/themes";
import { BACKGROUNDS } from "@/config/backgrounds";
import { useThemeStore } from "@/store/theme-store";
import { useTelemetryStore } from "@/store/telemetry-store";
import { usePrefsStore, type AnimationLevel } from "@/store/prefs-store";
import {
  useCapabilities,
  useHardwareProfile,
  useMemory,
  useGpu,
  useBattery,
} from "@/hooks/use-telemetry";
import { usePowerInfo, useControlActions } from "@/hooks/use-control";
import { useIntegrations } from "@/hooks/use-integrations";
import {
  isTauri,
  getAutostart,
  setAutostart,
  appUpdateInfo,
  checkForUpdate,
  setPollInterval,
  listPlugins,
  setPluginEnabled,
  getPluginsDir,
  listNexusProfiles,
  applyNexusProfile,
  getActiveProfile,
  getAutomation,
  setAutomation,
  readLogs,
  exportDiagnostics,
} from "@/lib/ipc";
import type { UpdateStatus } from "@/lib/system-types";
import type { Plugin } from "@/lib/plugins-types";
import type { NexusProfile, AutomationConfig } from "@/lib/power-types";
import { CapabilityBadge } from "@/components/ui/capability-gate";
import { formatBytes } from "@/lib/format";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

const SETTINGS_SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "system", label: "System", icon: Monitor },
  { id: "performance", label: "Performance", icon: Gauge },
  { id: "rgb", label: "RGB", icon: Keyboard },
  { id: "battery", label: "Battery", icon: BatteryCharging },
  { id: "ai", label: "AI", icon: Sparkles },
  { id: "updates", label: "Updates", icon: RefreshCw },
  { id: "plugins", label: "Plugins", icon: Puzzle },
  { id: "diagnostics", label: "Diagnostics", icon: Activity },
  { id: "profiles", label: "Profiles", icon: UserCog },
];

const ANIMATION_LEVELS: { id: AnimationLevel; label: string; hint: string }[] = [
  { id: "off", label: "Off", hint: "No motion" },
  { id: "low", label: "Low", hint: "Transitions only" },
  { id: "normal", label: "Normal", hint: "Default" },
  { id: "extreme", label: "Extreme", hint: "+ ambient FX" },
];

export default function SettingsPage() {
  const { theme, setTheme, background, setBackground, density, setDensity } =
    useThemeStore();
  const animations = usePrefsStore((s) => s.animations);
  const setAnimations = usePrefsStore((s) => s.setAnimations);

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Personalize Nexus and manage your system preferences."
      />

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-[220px_1fr]">
        {/* Section rail */}
        <GlassCard padding="sm" className="h-fit lg:sticky lg:top-0">
          <nav className="space-y-2xs">
            {SETTINGS_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="flex items-center gap-sm rounded-md px-sm py-xs text-sm text-content-muted transition-colors hover:bg-surface-raised hover:text-content"
              >
                <s.icon className="h-4 w-4" />
                <span className="flex-1">{s.label}</span>
              </a>
            ))}
          </nav>
        </GlassCard>

        {/* Panels */}
        <motion.div variants={stagger(0.06)} initial="hidden" animate="show" className="space-y-lg">
          {/* Appearance — Theme */}
          <motion.section variants={fadeUp} id="appearance">
            <GlassCard padding="lg">
              <h3 className="text-lg font-semibold text-content">Theme</h3>
              <p className="mb-md text-sm text-content-muted">
                Switching is instant and applies across the entire app.
              </p>
              <div className="grid grid-cols-2 gap-md sm:grid-cols-3">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      "group relative overflow-hidden rounded-lg border p-sm text-left transition-all",
                      theme === t.id ? "border-accent/60 shadow-glow" : "border-border hover:border-border-strong",
                    )}
                  >
                    <div className="mb-sm h-16 rounded-md" style={{ background: `linear-gradient(120deg, ${t.swatch[1]}, ${t.swatch[2]})` }} />
                    <p className="flex items-center gap-xs text-sm font-medium text-content">
                      {t.label}
                      {theme === t.id && <Check className="h-3.5 w-3.5 text-accent" />}
                    </p>
                    <p className="text-2xs text-content-subtle">{t.description}</p>
                  </button>
                ))}
              </div>
              <div className="mt-md flex flex-wrap items-center gap-lg">
                <div className="flex items-center gap-sm">
                  <span className="text-sm text-content-muted">Density</span>
                  <div className="flex rounded-md border border-border p-2xs">
                    {(["comfortable", "compact"] as const).map((dn) => (
                      <button key={dn} onClick={() => setDensity(dn)} className={cn("rounded px-md py-xs text-sm font-medium capitalize transition-colors", density === dn ? "bg-accent/15 text-accent-strong" : "text-content-muted hover:text-content")}>{dn}</button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center gap-sm">
                  <span className="flex items-center gap-xs text-sm text-content-muted"><Film className="h-3.5 w-3.5" /> Animations</span>
                  <div className="flex rounded-md border border-border p-2xs">
                    {ANIMATION_LEVELS.map((a) => (
                      <button key={a.id} onClick={() => setAnimations(a.id)} title={a.hint} className={cn("rounded px-sm py-xs text-sm font-medium transition-colors", animations === a.id ? "bg-accent/15 text-accent-strong" : "text-content-muted hover:text-content")}>{a.label}</button>
                    ))}
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.section>

          {/* Appearance — Background */}
          <motion.section variants={fadeUp} id="themes">
            <GlassCard padding="lg">
              <h3 className="text-lg font-semibold text-content">Background</h3>
              <p className="mb-md text-sm text-content-muted">Pick an ambient style. Lower-cost options suit battery saver.</p>
              <div className="grid grid-cols-2 gap-sm sm:grid-cols-3">
                {BACKGROUNDS.map((b) => (
                  <button key={b.id} onClick={() => setBackground(b.id)} className={cn("rounded-lg border p-md text-left transition-all", background === b.id ? "border-accent/60 bg-accent/8" : "border-border hover:border-border-strong")}>
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-content">{b.label}</p>
                      <Badge size="sm" variant={b.cost === "high" ? "warning" : "neutral"}>{b.cost}</Badge>
                    </div>
                    <p className="mt-2xs text-2xs text-content-subtle">{b.description}</p>
                  </button>
                ))}
              </div>
            </GlassCard>
          </motion.section>

          <motion.section variants={fadeUp} id="system"><SystemPanel /></motion.section>
          <motion.section variants={fadeUp} id="performance"><PerformancePanel /></motion.section>
          <motion.section variants={fadeUp} id="rgb"><RgbPanel /></motion.section>
          <motion.section variants={fadeUp} id="battery"><BatteryPanel /></motion.section>
          <motion.section variants={fadeUp} id="ai"><AiPanel /></motion.section>
          <motion.section variants={fadeUp} id="updates"><UpdatesPanel /></motion.section>
          <motion.section variants={fadeUp} id="plugins"><PluginsPanel /></motion.section>
          <motion.section variants={fadeUp} id="diagnostics"><DiagnosticsPanel /></motion.section>
          <motion.section variants={fadeUp} id="profiles"><ProfilesPanel /></motion.section>
          <motion.section variants={fadeUp}><ApplicationSettings /></motion.section>
        </motion.div>
      </div>
    </div>
  );
}

/* ------------------------------- System ---------------------------------- */

function SystemPanel() {
  const profile = useHardwareProfile();
  const caps = useCapabilities();
  const mem = useMemory();
  const gpu = useGpu();
  const [kernel, setKernel] = useState<string>("");

  useEffect(() => {
    if (!isTauri()) return;
    import("@tauri-apps/plugin-os").then((os) => {
      Promise.resolve(os.version()).then((v) => setKernel(String(v))).catch(() => {});
    }).catch(() => {});
  }, []);

  return (
    <GlassCard padding="lg">
      <h3 className="text-lg font-semibold text-content">System</h3>
      <p className="mb-md text-sm text-content-muted">Operating system, hardware & driver inventory.</p>
      <div className="grid grid-cols-1 gap-x-lg sm:grid-cols-2">
        <div>
          <StatRow label="OS" value={profile?.os ?? "—"} />
          <StatRow label="Kernel" value={kernel || (isTauri() ? "…" : "n/a in browser")} />
          <StatRow label="Vendor" value={profile ? `${profile.vendorLabel} · ${profile.productName}` : "—"} />
          <StatRow label="Board" value={profile?.boardName ?? "—"} />
        </div>
        <div>
          <StatRow label="CPU" value={profile?.cpuModel ?? "—"} />
          <StatRow label="Memory" value={mem ? `${formatBytes(mem.totalBytes, 0)} total` : "—"} />
          <StatRow label="GPU" value={profile?.gpuName ?? "—"} />
          <StatRow label="VRAM" value={gpu ? formatBytes(gpu.vramTotalMb * 1048576, 0) : "—"} />
        </div>
      </div>
      <div className="mt-md">
        <p className="mb-xs text-2xs uppercase tracking-wider text-content-subtle">Detected control drivers</p>
        <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
          {([
            { label: "Power Profiles", status: caps?.power.status },
            { label: "Fan Control", status: caps?.fan.status },
            { label: "RGB Lighting", status: caps?.rgb.status },
            { label: "Battery Charge Limit", status: caps?.battery.status },
            { label: "GPU MUX Switch", status: caps?.mux.status },
          ]).map((c) => (
            <div key={c.label} className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
              <div className="min-w-0">
                <p className="text-sm font-medium text-content">{c.label}</p>
                <p className="truncate text-2xs text-content-subtle">{c.status?.driver ? `via ${c.status.driver}` : c.status?.notes || "—"}</p>
              </div>
              <CapabilityBadge status={c.status} />
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

/* ----------------------------- Performance ------------------------------- */

const TELEMETRY_PRESETS = [
  { ms: 1000, label: "1s" },
  { ms: 2000, label: "2s" },
  { ms: 5000, label: "5s" },
  { ms: 10000, label: "10s" },
];

const PERF_MODES: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "power-saver", label: "Battery", icon: BatteryCharging },
  { id: "balanced", label: "Balanced", icon: Gauge },
  { id: "performance", label: "Performance", icon: Rocket },
];

function PerformancePanel() {
  const { background, setBackground } = useThemeStore();
  const intervalMs = useTelemetryStore((s) => s.pollIntervalMs);
  const setIntervalStore = useTelemetryStore((s) => s.setPollIntervalMs);
  const power = usePowerInfo();
  const actions = useControlActions();
  const [powerMsg, setPowerMsg] = useState<string | null>(null);

  function applyInterval(ms: number) {
    // Store is the source of truth so the provider restores to it on focus.
    setIntervalStore(ms);
    if (isTauri()) setPollInterval(ms).catch(() => {});
  }

  async function applyMode(id: string, label: string) {
    const r = await actions.setPower(id);
    setPowerMsg(r.ok ? `${label} mode applied.` : r.msg);
  }

  const bgQuality = BACKGROUNDS.find((b) => b.id === background);
  const currentPower = power?.current ?? null;

  return (
    <GlassCard padding="lg">
      <h3 className="text-lg font-semibold text-content">Performance</h3>
      <p className="mb-md text-sm text-content-muted">Tune Nexus's resource use and the system power mode.</p>

      {/* Performance mode → system power profile */}
      <div className="rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
        <div className="mb-xs flex items-center gap-xs text-sm font-medium text-content"><Zap className="h-4 w-4 text-accent" /> Performance mode</div>
        <div className="grid grid-cols-3 gap-sm">
          {PERF_MODES.map((m) => {
            const active = currentPower === m.id;
            return (
              <button
                key={m.id}
                onClick={() => applyMode(m.id, m.label)}
                disabled={!power?.controllable && isTauri()}
                className={cn("flex flex-col items-center gap-xs rounded-lg border p-md transition-all disabled:opacity-40", active ? "border-accent/60 bg-accent/8 shadow-glow" : "border-border hover:border-border-strong")}
              >
                <m.icon className={cn("h-5 w-5", active ? "text-accent-strong" : "text-content-muted")} />
                <span className="text-sm font-medium text-content">{m.label}</span>
              </button>
            );
          })}
        </div>
        {powerMsg && <p className="mt-xs text-2xs text-content-muted">{powerMsg}</p>}
      </div>

      {/* Telemetry refresh — presets + fine slider */}
      <div className="mt-md rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
        <div className="mb-xs flex items-center justify-between">
          <span className="flex items-center gap-xs text-sm font-medium text-content"><Activity className="h-4 w-4 text-accent" /> Telemetry refresh rate</span>
          <span className="text-xs font-semibold tabular-nums text-accent-strong">{(intervalMs / 1000).toFixed(2)}s</span>
        </div>
        <div className="mb-sm flex gap-sm">
          {TELEMETRY_PRESETS.map((p) => (
            <button key={p.ms} onClick={() => applyInterval(p.ms)} className={cn("flex-1 rounded-md border py-xs text-xs font-medium transition-colors", intervalMs === p.ms ? "border-accent/60 bg-accent/10 text-accent-strong" : "border-border text-content-muted hover:text-content")}>{p.label}</button>
          ))}
        </div>
        <Slider value={[intervalMs]} min={250} max={10000} step={250} onValueChange={(v) => applyInterval(v[0])} />
        <p className="mt-xs text-2xs text-content-subtle">Faster = more responsive graphs; slower = lower CPU & battery use. Nexus auto-slows to 10s when minimized.</p>
      </div>

      {/* Background effects */}
      <div className="mt-md rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
        <p className="mb-xs text-sm font-medium text-content">Background effects</p>
        <div className="flex flex-wrap gap-sm">
          {BACKGROUNDS.map((b) => (
            <button key={b.id} onClick={() => setBackground(b.id)} className={cn("rounded-md border px-sm py-xs text-xs font-medium transition-colors", background === b.id ? "border-accent/60 bg-accent/10 text-accent-strong" : "border-border text-content-muted hover:text-content")}>{b.label}</button>
          ))}
        </div>
        <p className="mt-xs text-2xs text-content-subtle">Current cost: <span className="capitalize">{bgQuality?.cost ?? "—"}</span>. Set Animations to “Off/Low” (Appearance) on battery.</p>
      </div>
    </GlassCard>
  );
}

/* --------------------------------- RGB ----------------------------------- */

function RgbPanel() {
  const [cfg, setCfg] = useState<AutomationConfig | null>(null);
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    getAutomation().then((c) => { setCfg(c); setEnabled(c.enabled); }).catch(() => {});
  }, []);

  async function toggle(v: boolean) {
    setEnabled(v);
    if (!isTauri() || !cfg) return;
    const next = { ...cfg, enabled: v };
    setCfg(next);
    await setAutomation(next).catch(() => setEnabled(!v));
  }

  return (
    <GlassCard padding="lg">
      <h3 className="text-lg font-semibold text-content">RGB &amp; Lighting</h3>
      <p className="mb-md text-sm text-content-muted">Control how Nexus drives your keyboard lighting.</p>

      <label className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
        <span>
          <span className="block text-sm font-medium text-content">Enable RGB automation</span>
          <span className="block text-2xs text-content-subtle">Let saved automation rules apply lighting when conditions change (e.g. on AC, on game launch).</span>
        </span>
        <Switch checked={enabled} onCheckedChange={toggle} />
      </label>

      <div className="mt-md flex items-start gap-sm rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
        <p className="text-2xs text-content-muted">
          Nexus never changes your lighting on launch — it only writes on your explicit actions or, when enabled above, a genuine automation trigger. Build profiles &amp; rules in <Link to="/rgb" className="text-accent-strong hover:underline">RGB Studio</Link>.
        </p>
      </div>
    </GlassCard>
  );
}

/* ----------------------------- Diagnostics ------------------------------- */

function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function DiagnosticsPanel() {
  const perfOverlay = usePrefsStore((s) => s.perfOverlay);
  const setPerfOverlay = usePrefsStore((s) => s.setPerfOverlay);
  const [busy, setBusy] = useState<string | null>(null);

  async function exportLogs() {
    setBusy("logs");
    try {
      const text = isTauri() ? await readLogs() : "# Nexus logs (demo build)\n";
      downloadText("nexus-logs.txt", text || "(empty log)", "text/plain");
    } catch (e) {
      downloadText("nexus-logs.txt", `Failed to read logs: ${e}`, "text/plain");
    } finally {
      setBusy(null);
    }
  }

  async function exportDiag() {
    setBusy("diag");
    try {
      const md = isTauri() ? await exportDiagnostics() : "# Nexus Diagnostics (demo)\n";
      downloadText("nexus-diagnostics.md", md, "text/markdown");
    } catch (e) {
      downloadText("nexus-diagnostics.md", `# Diagnostics\n(export failed: ${e})\n`, "text/markdown");
    } finally {
      setBusy(null);
    }
  }

  return (
    <GlassCard padding="lg">
      <h3 className="text-lg font-semibold text-content">Diagnostics</h3>
      <p className="mb-md text-sm text-content-muted">Performance instrumentation &amp; exportable reports.</p>

      <label className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
        <span>
          <span className="block text-sm font-medium text-content">Performance overlay</span>
          <span className="block text-2xs text-content-subtle">Show a live FPS + frame-time meter in the corner.</span>
        </span>
        <Switch checked={perfOverlay} onCheckedChange={setPerfOverlay} />
      </label>

      <div className="mt-md flex flex-wrap gap-sm">
        <Button variant="solid" size="md" onClick={exportLogs} disabled={busy === "logs"}>
          {busy === "logs" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />} Export Logs
        </Button>
        <Button variant="solid" size="md" onClick={exportDiag} disabled={busy === "diag"}>
          {busy === "diag" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Export Diagnostics
        </Button>
      </div>
    </GlassCard>
  );
}

/* ------------------------------- Battery --------------------------------- */

function BatteryPanel() {
  const battery = useBattery();
  return (
    <GlassCard padding="lg">
      <div className="mb-md flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-content">Battery</h3>
          <p className="text-sm text-content-muted">Quick stats & calibration guidance.</p>
        </div>
        <Link to="/battery"><Button variant="solid" size="sm"><BatteryCharging className="h-4 w-4" /> Open Battery Center</Button></Link>
      </div>
      {battery?.present ? (
        <div className="grid grid-cols-1 gap-x-lg sm:grid-cols-2">
          <div>
            <StatRow label="Charge" value={`${battery.chargePercent.toFixed(0)}%`} />
            <StatRow label="Status" value={battery.status} />
            <StatRow label="Health" value={`${battery.healthPercent.toFixed(0)}%`} />
          </div>
          <div>
            <StatRow label="Cycles" value={`${battery.cycleCount}`} />
            <StatRow label="Full capacity" value={`${battery.energyFullWh.toFixed(1)} Wh`} />
            <StatRow label="Design" value={`${battery.energyDesignWh.toFixed(1)} Wh`} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-content-muted">No battery detected.</p>
      )}
      <div className="mt-md rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
        <p className="mb-xs text-sm font-medium text-content">Calibration guide</p>
        <ol className="ml-4 list-decimal space-y-2xs text-2xs text-content-muted">
          <li>Charge to 100% and keep it plugged in for ~2 hours.</li>
          <li>Unplug and discharge with normal use until it auto-shuts down.</li>
          <li>Leave it off for ~5 hours, then charge uninterrupted to 100%.</li>
          <li>This re-syncs the battery gauge — do it every few months, not daily.</li>
        </ol>
      </div>
    </GlassCard>
  );
}

/* --------------------------------- AI ------------------------------------ */

function AiPanel() {
  const { items } = useIntegrations();
  const ai = items.filter((i) => i.category === "ai");
  return (
    <GlassCard padding="lg">
      <h3 className="text-lg font-semibold text-content">Local AI</h3>
      <p className="mb-md text-sm text-content-muted">Detected on-device inference tools. Nexus reasons fully offline.</p>
      <div className="grid grid-cols-1 gap-sm sm:grid-cols-3">
        {ai.map((i) => (
          <div key={i.id} className="rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
            <div className="flex items-center gap-sm">
              <Bot className="h-5 w-5 text-accent" />
              <p className="flex-1 text-sm font-semibold text-content">{i.name}</p>
              <Badge size="sm" variant={i.detected ? "success" : "neutral"}>{i.detected ? "found" : "missing"}</Badge>
            </div>
            <p className="mt-xs truncate text-2xs text-content-muted">{i.detected ? (i.detail || "installed") : i.hint}</p>
            {i.docUrl && <a href={i.docUrl} target="_blank" rel="noreferrer" className="mt-xs inline-flex items-center gap-xs text-2xs text-accent-strong hover:underline"><ExternalLink className="h-3 w-3" /> Docs</a>}
          </div>
        ))}
        {ai.length === 0 && <p className="text-sm text-content-muted">Detecting…</p>}
      </div>
      <p className="mt-md text-2xs text-content-subtle">Manage all integrations in <Link to="/integrations" className="text-accent-strong hover:underline">System Integrations</Link>.</p>
    </GlassCard>
  );
}

/* ------------------------------- Updates --------------------------------- */

function UpdatesPanel() {
  const [version, setVersion] = useState("0.1.0");
  const [channel, setChannel] = useState("beta");
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    appUpdateInfo().then((u) => { setVersion(u.currentVersion); setChannel(u.channel); }).catch(() => {});
  }, []);

  async function check() {
    setBusy(true); setErr(null); setStatus(null);
    try {
      if (!isTauri()) { setStatus({ available: false, currentVersion: version, latestVersion: null, notes: null }); }
      else setStatus(await checkForUpdate());
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard padding="lg">
      <div className="mb-md flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-content">Updates</h3>
          <p className="text-sm text-content-muted">Signed, minisign-verified in-app updates.</p>
        </div>
        <Badge variant="neutral">v{version}</Badge>
      </div>

      <div className="mb-md flex items-center gap-sm">
        <span className="text-sm text-content-muted">Release channel</span>
        <div className="flex rounded-md border border-border p-2xs">
          {(["stable", "beta"] as const).map((c) => (
            <button key={c} onClick={() => setChannel(c)} className={cn("rounded px-md py-xs text-sm font-medium capitalize transition-colors", channel === c ? "bg-accent/15 text-accent-strong" : "text-content-muted hover:text-content")}>{c}</button>
          ))}
        </div>
      </div>

      <Button variant="primary" size="md" onClick={check} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} Check for updates
      </Button>

      {err && <p className="mt-sm flex items-center gap-xs text-sm text-danger"><AlertTriangle className="h-4 w-4" /> {err}</p>}
      {status && (
        <div className="mt-sm flex items-center gap-xs text-sm">
          {status.available ? (
            <span className="flex items-center gap-xs text-accent-strong"><Download className="h-4 w-4" /> Update available: v{status.latestVersion}</span>
          ) : (
            <span className="flex items-center gap-xs text-success"><CheckCircle2 className="h-4 w-4" /> You're on the latest version.</span>
          )}
        </div>
      )}
    </GlassCard>
  );
}

/* ------------------------------- Plugins --------------------------------- */

function PluginsPanel() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [dir, setDir] = useState("");

  useEffect(() => {
    if (!isTauri()) { setDir("~/.config/nexus/plugins"); return; }
    listPlugins().then(setPlugins).catch(() => {});
    getPluginsDir().then(setDir).catch(() => {});
  }, []);

  async function toggle(p: Plugin, enabled: boolean) {
    setPlugins((ps) => ps.map((x) => x.id === p.id ? { ...x, enabled } : x));
    if (isTauri()) await setPluginEnabled(p.id, enabled).catch(() => {});
  }

  return (
    <GlassCard padding="lg">
      <h3 className="text-lg font-semibold text-content">Plugins</h3>
      <p className="mb-md text-sm text-content-muted">Drop a plugin manifest (<code className="text-2xs">.json</code>) into the plugins folder to extend Nexus.</p>
      {plugins.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-lg text-center">
          <Puzzle className="mx-auto h-8 w-8 text-content-subtle" />
          <p className="mt-sm text-sm text-content-muted">No plugins installed yet.</p>
          <code className="mt-xs inline-block rounded bg-surface-sunken px-sm py-xs text-2xs text-content-subtle">{dir}</code>
        </div>
      ) : (
        <div className="space-y-sm">
          {plugins.map((p) => (
            <div key={p.id} className="flex items-center gap-md rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
              <Puzzle className="h-5 w-5 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-content">{p.name} <span className="text-2xs text-content-subtle">{p.version}</span></p>
                <p className="truncate text-2xs text-content-muted">{p.description || p.kind || p.author}</p>
              </div>
              <Switch checked={p.enabled} onCheckedChange={(v) => toggle(p, v)} />
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

/* ------------------------------- Profiles -------------------------------- */

const PROFILE_ICON: Record<string, LucideIcon> = {
  gaming: Rocket, silent: Gauge, balanced: Layers, performance: Cpu,
};

function ProfilesPanel() {
  const [profiles, setProfiles] = useState<NexusProfile[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setProfiles([
        { id: "gaming", name: "Gaming", icon: "rocket", builtin: true, power: "performance", rgb: null, fan: "Gaming", gpu: null },
        { id: "silent", name: "Silent", icon: "gauge", builtin: true, power: "power-saver", rgb: null, fan: "Silent", gpu: null },
        { id: "balanced", name: "Balanced", icon: "layers", builtin: true, power: "balanced", rgb: null, fan: "Balanced", gpu: null },
        { id: "performance", name: "Performance", icon: "cpu", builtin: true, power: "performance", rgb: null, fan: "Turbo", gpu: null },
      ]);
      return;
    }
    listNexusProfiles().then(setProfiles).catch(() => {});
    getActiveProfile().then(setActive).catch(() => {});
  }, []);

  async function apply(p: NexusProfile) {
    setActive(p.id);
    if (!isTauri()) { setMsg(`Demo — would apply ${p.name}.`); return; }
    try { const out = await applyNexusProfile(p.id); setMsg(out.message || `Applied ${p.name}.`); }
    catch (e) { setMsg(String(e)); }
  }

  return (
    <GlassCard padding="lg">
      <h3 className="text-lg font-semibold text-content">Profiles</h3>
      <p className="mb-md text-sm text-content-muted">One-tap system profiles composing power, fan & lighting.</p>
      {msg && <p className="mb-sm rounded-md bg-surface-sunken/50 px-sm py-xs text-2xs text-content-muted">{msg}</p>}
      <div className="grid grid-cols-2 gap-md sm:grid-cols-4">
        {profiles.map((p) => {
          const Icon = PROFILE_ICON[p.id] ?? Layers;
          const isActive = active === p.id;
          return (
            <button key={p.id} onClick={() => apply(p)} className={cn("flex flex-col items-center gap-xs rounded-lg border p-md text-center transition-all", isActive ? "border-accent/60 bg-accent/8 shadow-glow" : "border-border hover:border-border-strong")}>
              <Icon className={cn("h-6 w-6", isActive ? "text-accent-strong" : "text-content-muted")} />
              <span className="text-sm font-medium text-content">{p.name}</span>
              <span className="text-2xs text-content-subtle">{p.power ?? "—"}{p.fan ? ` · ${p.fan}` : ""}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-md text-2xs text-content-subtle">Edit profiles & automation in <Link to="/performance" className="text-accent-strong hover:underline">Performance</Link>.</p>
    </GlassCard>
  );
}

/* ----------------------------- Application -------------------------------- */

function ApplicationSettings() {
  const [autostart, setAuto] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    getAutostart().then(setAuto).catch(() => {});
    appUpdateInfo().then((u) => setVersion(u.currentVersion)).catch(() => {});
  }, []);

  async function toggle(v: boolean) {
    setAuto(v);
    if (isTauri()) await setAutostart(v).catch(() => setAuto(!v));
  }

  return (
    <GlassCard padding="lg">
      <div className="mb-md flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-content">Application</h3>
          <p className="text-sm text-content-muted">Startup, tray & diagnostics</p>
        </div>
        <Badge variant="neutral">v{version ?? "0.1.0"}</Badge>
      </div>

      <label className="flex items-center justify-between border-b border-border-subtle py-md">
        <span className="flex items-center gap-sm">
          <Rocket className="h-4 w-4 text-content-muted" />
          <span>
            <span className="block text-sm font-medium text-content">Start on login</span>
            <span className="block text-2xs text-content-subtle">Launch Nexus in the tray at sign-in (for automation).</span>
          </span>
        </span>
        <Switch checked={autostart} onCheckedChange={toggle} />
      </label>

      <Link to="/doctor" className="flex items-center justify-between py-md">
        <span className="flex items-center gap-sm">
          <Stethoscope className="h-4 w-4 text-content-muted" />
          <span>
            <span className="block text-sm font-medium text-content">Run diagnostics</span>
            <span className="block text-2xs text-content-subtle">Deep system scan, permissions & diagnostics export.</span>
          </span>
        </span>
        <FolderOpen className="h-4 w-4 text-content-subtle" />
      </Link>

      <p className="mt-2xs text-2xs text-content-subtle">
        Closing the window keeps Nexus running in the system tray. Updates ship via your distro package or GitHub releases.
      </p>
    </GlassCard>
  );
}
