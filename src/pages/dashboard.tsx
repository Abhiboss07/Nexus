import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import {
  Cpu,
  CircuitBoard,
  MemoryStick,
  Thermometer,
  Zap,
  ShieldCheck,
  Wand2,
  Stethoscope,
  Gauge,
  Leaf,
  BatteryCharging,
  Microchip,
  Gamepad2,
  Rocket,
  Trash2,
  Activity,
  AlertTriangle,
  CheckCircle2,
  Info,
  XCircle,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { MetricCard } from "@/components/cards/metric-card";
import { GlassCard } from "@/components/ui/glass";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RingGauge } from "@/components/ui/ring-gauge";
import { Meter, meterTone } from "@/components/ui/progress";
import { Sparkline } from "@/components/ui/sparkline";
import { stagger, fadeUp } from "@/lib/motion";
import { formatBytes } from "@/lib/format";
import {
  useCpu,
  useGpu,
  useMemory,
  useBattery,
  useThermals,
  useHistory,
  useTelemetrySource,
} from "@/hooks/use-telemetry";
import { useIntelligence } from "@/hooks/use-intelligence";
import { useBatteryIntel } from "@/hooks/use-battery-intel";
import { useControlActions } from "@/hooks/use-control";
import {
  isTauri,
  getGpuInfo,
  getGameLaunchers,
  runSystemScan,
  optimizerCleanTemp,
} from "@/lib/ipc";
import type { GpuInfo } from "@/lib/gpu-types";
import type { LauncherStatus } from "@/lib/games-types";
import type { Finding } from "@/lib/sysdoctor-types";
import { cn } from "@/lib/cn";

function trend(series: number[]): number {
  if (series.length < 6) return 0;
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  return Math.round(avg(series.slice(-5)) - avg(series.slice(-10, -5)));
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const cpu = useCpu();
  const gpu = useGpu();
  const mem = useMemory();
  const battery = useBattery();
  const thermals = useThermals();
  const history = useHistory();
  const live = useTelemetrySource() === "live";
  const { report } = useIntelligence();
  const { report: bat, history: batHistory } = useBatteryIntel();
  const actions = useControlActions();

  const cpuSeries = history.map((p) => p.cpuUsage);
  const gpuSeries = history.map((p) => p.gpuUsage);
  const memSeries = history.map((p) => p.memUsage);
  const tempSeries = history.map((p) => p.cpuTemp);
  const cpuTemp = thermals?.cpuC ?? cpu?.temperatureC ?? 0;

  const health = report?.health;
  const healthScore = health?.overallScore ?? 0;
  const healthTone = healthScore >= 85 ? "success" : healthScore >= 60 ? "warning" : "danger";

  return (
    <div>
      <PageHeader
        title="Command Center"
        description="Welcome back — your system at a glance."
        actions={
          <Badge variant={healthTone === "success" ? "success" : "warning"} size="md">
            <StatusDot tone={healthTone} pulse={false} />
            {healthScore >= 85 ? "All systems nominal" : healthScore >= 60 ? "Attention advised" : "Action needed"}
          </Badge>
        }
      />

      <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="space-y-md">
        {/* Live telemetry row */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Cpu} label="CPU" value={cpu ? cpu.usage.toFixed(0) : "—"} unit="%" trend={trend(cpuSeries)} tone="accent" series={cpuSeries} footer={cpu ? `${cpu.model.split(" ").slice(0, 3).join(" ")} · ${(cpu.frequencyMhz / 1000).toFixed(1)} GHz` : "Detecting…"} />
          <MetricCard icon={CircuitBoard} label="GPU" value={gpu ? gpu.usage.toFixed(0) : "—"} unit="%" trend={trend(gpuSeries)} tone="info" series={gpuSeries} footer={gpu ? `${gpu.name.replace("NVIDIA GeForce ", "")} · ${gpu.temperatureC?.toFixed(0) ?? "—"}°C` : "No GPU"} />
          <MetricCard icon={MemoryStick} label="Memory" value={mem ? formatBytes(mem.usedBytes, 1).replace(" GB", "") : "—"} unit={mem ? `/ ${formatBytes(mem.totalBytes, 0)}` : ""} trend={trend(memSeries)} tone="success" series={memSeries} footer={mem ? `${mem.usage.toFixed(0)}% used` : "Detecting…"} />
          <MetricCard icon={Thermometer} label="CPU Thermals" value={cpuTemp ? cpuTemp.toFixed(0) : "—"} unit="°C" trend={trend(tempSeries)} tone={cpuTemp > 80 ? "danger" : cpuTemp > 70 ? "warning" : "success"} series={tempSeries} footer="Package temperature" />
        </motion.div>

        {/* Health score (hero) + Quick actions */}
        <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
          <motion.div variants={fadeUp} className="lg:col-span-2">
            <HealthHero score={healthScore} grade={health?.grade ?? "…"} tone={healthTone} subsystems={health?.subsystems ?? []} />
          </motion.div>
          <motion.div variants={fadeUp}>
            <QuickActions navigate={navigate} live={live} setPower={actions.setPower} />
          </motion.div>
        </div>

        {/* GPU center + Gaming readiness */}
        <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
          <motion.div variants={fadeUp} className="lg:col-span-2">
            <GpuCenter live={live} gpuTempSeries={history.map((p) => p.gpuTemp)} />
          </motion.div>
          <motion.div variants={fadeUp}>
            <GamingReadiness live={live} gpu={!!gpu} cpuTemp={cpuTemp} memUsage={mem?.usage ?? 0} />
          </motion.div>
        </div>

        {/* Battery intelligence + Alerts */}
        <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
          <motion.div variants={fadeUp}>
            <BatteryIntel
              wear={bat?.wearPercent}
              cycles={bat?.cycleCount}
              years={bat?.lifespan.yearsRemaining}
              dischargeW={bat?.dischargeRateW ?? battery?.powerDrawW}
              charging={battery?.status?.includes("harg") ?? false}
              sessions={chargeSessions(batHistory.map((s) => s.status))}
              percent={battery?.chargePercent}
            />
          </motion.div>
          <motion.div variants={fadeUp} className="lg:col-span-2">
            <AlertsFeed navigate={navigate} live={live} />
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

/* ----------------------------- Health hero ------------------------------- */

function HealthHero({ score, grade, tone, subsystems }: { score: number; grade: string; tone: "success" | "warning" | "danger"; subsystems: { name: string; score: number; status: string; detail: string }[] }) {
  return (
    <GlassCard padding="lg" className="relative h-full overflow-hidden">
      <div className={cn("absolute -right-10 -top-10 h-44 w-44 rounded-full blur-3xl", tone === "success" ? "bg-success/15" : tone === "warning" ? "bg-warning/15" : "bg-danger/15")} />
      <div className="flex flex-col gap-lg sm:flex-row sm:items-center">
        <div className="grid place-items-center text-center">
          <RingGauge value={score} size={150} thickness={12} tone={tone} label={`${score}`} sublabel="/ 100" />
          <p className="mt-sm text-sm font-semibold capitalize text-content">{grade}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="mb-sm flex items-center gap-xs text-sm font-medium text-content-muted"><ShieldCheck className="h-4 w-4 text-accent" /> Overall System Health</p>
          <div className="space-y-2xs">
            {subsystems.slice(0, 6).map((s) => (
              <div key={s.name} className="flex items-center gap-sm">
                <span className="w-28 truncate text-xs text-content-muted">{s.name}</span>
                <Meter value={s.score} tone={meterTone(s.score)} className="flex-1" height={6} />
                <span className="w-8 text-right text-2xs tabular-nums text-content-subtle">{s.score}</span>
              </div>
            ))}
            {subsystems.length === 0 && <p className="text-xs text-content-subtle">Computing health…</p>}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

/* ----------------------------- Quick actions ----------------------------- */

function QuickActions({ navigate, live, setPower }: { navigate: (p: string) => void; live: boolean; setPower: (n: string) => Promise<{ ok: boolean; msg: string }> }) {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 3000); return () => clearTimeout(t); }, [msg]);

  async function power(profile: string, label: string) {
    const r = await setPower(profile);
    setMsg(r.ok ? `${label} applied.` : r.msg);
  }
  async function clearCache() {
    if (!isTauri()) { setMsg("Demo — would clear thumbnail cache."); return; }
    try { setMsg(await optimizerCleanTemp("thumbnails")); } catch (e) { setMsg(String(e)); }
  }

  const items: { icon: LucideIcon; label: string; tone: string; onClick: () => void }[] = [
    { icon: Rocket, label: "Performance", tone: "text-danger", onClick: () => power("performance", "Performance mode") },
    { icon: Gauge, label: "Balanced", tone: "text-accent", onClick: () => power("balanced", "Balanced mode") },
    { icon: Leaf, label: "Battery Saver", tone: "text-success", onClick: () => power("power-saver", "Battery saver") },
    { icon: Stethoscope, label: "Run Doctor", tone: "text-warning", onClick: () => navigate("/doctor") },
    { icon: Wand2, label: "Optimizer", tone: "text-info", onClick: () => navigate("/optimizer") },
    { icon: Trash2, label: "Clear Cache", tone: "text-content-muted", onClick: clearCache },
  ];

  return (
    <GlassCard padding="lg" className="h-full">
      <p className="mb-md flex items-center gap-xs text-sm font-semibold text-content"><Zap className="h-4 w-4 text-accent" /> Quick Actions</p>
      <div className="grid grid-cols-2 gap-sm">
        {items.map((it) => (
          <button key={it.label} onClick={it.onClick} disabled={!live && it.label !== "Run Doctor" && it.label !== "Optimizer"} className="flex flex-col items-center gap-xs rounded-lg border border-border bg-surface-sunken/40 p-md transition-all hover:border-accent/50 disabled:opacity-40">
            <it.icon className={cn("h-5 w-5", it.tone)} />
            <span className="text-xs font-medium text-content">{it.label}</span>
          </button>
        ))}
      </div>
      {msg && <p className="mt-sm truncate text-2xs text-content-muted">{msg}</p>}
    </GlassCard>
  );
}

/* ------------------------------- GPU center ------------------------------ */

function GpuCenter({ live, gpuTempSeries }: { live: boolean; gpuTempSeries: number[] }) {
  const gpu = useGpu();
  const [info, setInfo] = useState<GpuInfo | null>(null);
  useEffect(() => {
    if (!isTauri()) return;
    getGpuInfo().then(setInfo).catch(() => {});
    const t = setInterval(() => getGpuInfo().then(setInfo).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, []);

  if (!gpu && !info) {
    return <GlassCard padding="lg" className="grid h-full place-items-center text-center"><div><Microchip className="mx-auto h-8 w-8 text-content-subtle" /><p className="mt-sm text-sm text-content-muted">No discrete GPU detected.</p></div></GlassCard>;
  }

  const name = (gpu?.name ?? info?.name ?? "GPU").replace("NVIDIA GeForce ", "");
  const maxTgp = info?.powerMaxW ?? info?.powerDefaultW ?? gpu?.powerLimitW ?? null;
  const draw = info?.powerDrawW ?? gpu?.powerW ?? null;
  const stats: { label: string; value: string }[] = [
    { label: "Current Draw", value: draw != null ? `${draw.toFixed(0)} W` : "—" },
    { label: "Max TGP", value: maxTgp != null ? `${maxTgp.toFixed(0)} W` : "—" },
    { label: "Power Limit", value: info?.powerLimitW != null ? `${info.powerLimitW.toFixed(0)} W` : "Dynamic Boost" },
    { label: "Temperature", value: `${(gpu?.temperatureC ?? info?.temperatureC ?? 0).toFixed(0)} °C` },
    { label: "Core Clock", value: `${gpu?.coreClockMhz ?? info?.clockGraphicsMhz ?? "—"} MHz` },
    { label: "Mem Clock", value: `${gpu?.memClockMhz ?? info?.clockMemoryMhz ?? "—"} MHz` },
  ];
  const vramUsed = gpu?.vramUsedMb ?? info?.vramUsedMb ?? 0;
  const vramTotal = gpu?.vramTotalMb ?? info?.vramTotalMb ?? 1;
  const vramPct = (vramUsed / vramTotal) * 100;
  const usage = gpu?.usage ?? info?.utilization ?? 0;

  return (
    <GlassCard padding="lg" className="h-full">
      <div className="mb-md flex items-center justify-between">
        <div>
          <p className="flex items-center gap-xs text-sm font-semibold text-content"><Microchip className="h-4 w-4 text-info" /> {name}</p>
          <p className="text-2xs text-content-subtle">{live ? "Live GPU telemetry" : "Demo"}{info ? ` · driver ${info.driverVersion}` : ""}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-3xl font-semibold text-content">{usage.toFixed(0)}<span className="text-base text-content-muted">%</span></p>
          <p className="text-2xs text-content-subtle">utilization</p>
        </div>
      </div>

      <div className="mb-md">
        <div className="mb-2xs flex items-center justify-between text-xs">
          <span className="text-content-muted">VRAM</span>
          <span className="font-medium text-content">{(vramUsed / 1024).toFixed(1)} / {(vramTotal / 1024).toFixed(1)} GB</span>
        </div>
        <Meter value={vramPct} tone={vramPct > 90 ? "danger" : vramPct > 75 ? "warning" : "info"} />
      </div>

      <div className="grid grid-cols-2 gap-x-lg gap-y-2xs sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="flex items-center justify-between border-b border-border-subtle/60 py-2xs">
            <span className="text-2xs text-content-subtle">{s.label}</span>
            <span className="text-xs font-semibold tabular-nums text-content">{s.value}</span>
          </div>
        ))}
      </div>

      <div className="mt-sm"><Sparkline data={gpuTempSeries.length ? gpuTempSeries : [0, 0]} tone="info" height={32} /></div>
    </GlassCard>
  );
}

/* --------------------------- Gaming readiness ---------------------------- */

function GamingReadiness({ live, gpu, cpuTemp, memUsage }: { live: boolean; gpu: boolean; cpuTemp: number; memUsage: number }) {
  const [launchers, setLaunchers] = useState<LauncherStatus | null>(null);
  useEffect(() => {
    if (!isTauri()) { setLaunchers({ steam: true, lutris: true, heroic: false, gamemode: true, gamescope: false, mangohud: false, primeRun: true }); return; }
    getGameLaunchers().then(setLaunchers).catch(() => {});
  }, []);

  const checks = [
    { label: "GPU drivers", ok: gpu },
    { label: "Steam", ok: !!launchers?.steam },
    { label: "GameMode", ok: !!launchers?.gamemode },
    { label: "MangoHud", ok: !!launchers?.mangohud },
    { label: "Thermals headroom", ok: cpuTemp > 0 && cpuTemp < 80 },
    { label: "Free memory", ok: memUsage > 0 && memUsage < 80 },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  const tone = score >= 80 ? "success" : score >= 50 ? "warning" : "danger";

  return (
    <GlassCard padding="lg" className="h-full">
      <p className="mb-md flex items-center gap-xs text-sm font-semibold text-content"><Gamepad2 className="h-4 w-4 text-accent" /> Gaming Readiness</p>
      <div className="grid place-items-center">
        <RingGauge value={live || !isTauri() ? score : 0} size={120} thickness={10} tone={tone} label={`${score}`} sublabel="%" />
        <p className="mt-sm text-sm font-semibold text-content">{score >= 80 ? "Gaming Ready" : score >= 50 ? "Mostly Ready" : "Needs Setup"}</p>
      </div>
      <div className="mt-md space-y-2xs">
        {checks.map((c) => (
          <div key={c.label} className="flex items-center gap-sm text-xs">
            {c.ok ? <CheckCircle2 className="h-3.5 w-3.5 text-success" /> : <XCircle className="h-3.5 w-3.5 text-content-subtle" />}
            <span className={cn("flex-1", c.ok ? "text-content" : "text-content-muted")}>{c.label}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

/* -------------------------- Battery intelligence ------------------------- */

function chargeSessions(statuses: string[]): number {
  let sessions = 0;
  let prevCharging = false;
  for (const s of statuses) {
    const charging = s.toLowerCase().includes("charg") && !s.toLowerCase().includes("dis");
    if (charging && !prevCharging) sessions++;
    prevCharging = charging;
  }
  return sessions;
}

function BatteryIntel({ wear, cycles, years, dischargeW, charging, sessions, percent }: { wear?: number; cycles?: number; years?: number; dischargeW?: number; charging: boolean; sessions: number; percent?: number }) {
  if (wear == null && percent == null) {
    return <GlassCard padding="lg" className="grid h-full place-items-center text-center"><div><BatteryCharging className="mx-auto h-8 w-8 text-content-subtle" /><p className="mt-sm text-sm text-content-muted">No battery detected.</p></div></GlassCard>;
  }
  const rows = [
    { label: "Battery wear", value: wear != null ? `${wear.toFixed(1)}%` : "—", tone: (wear ?? 0) > 20 ? "warning" : "success" },
    { label: "Cycle count", value: cycles != null ? `${cycles}` : "—" },
    { label: charging ? "Charge rate" : "Power draw", value: dischargeW != null ? `${Math.abs(dischargeW).toFixed(1)} W` : "—" },
    { label: "Est. lifespan", value: years != null ? `${years.toFixed(1)} yrs` : "—" },
    { label: "Charge sessions", value: `${sessions}` },
  ];
  return (
    <GlassCard padding="lg" className="h-full">
      <p className="mb-md flex items-center gap-xs text-sm font-semibold text-content"><BatteryCharging className="h-4 w-4 text-success" /> Battery Intelligence</p>
      <div className="mb-md flex items-end justify-between">
        <span className="font-display text-3xl font-semibold text-content">{percent != null ? `${percent.toFixed(0)}%` : "—"}</span>
        <Badge variant={charging ? "success" : "neutral"}>{charging ? "Charging" : "On battery"}</Badge>
      </div>
      <div className="space-y-2xs">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between border-b border-border-subtle/60 py-2xs">
            <span className="text-xs text-content-muted">{r.label}</span>
            <span className={cn("text-xs font-semibold tabular-nums", r.tone === "warning" ? "text-warning" : "text-content")}>{r.value}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

/* ------------------------------- Alerts feed ----------------------------- */

const SEV_ICON: Record<string, { icon: LucideIcon; cls: string }> = {
  critical: { icon: XCircle, cls: "text-danger" },
  warning: { icon: AlertTriangle, cls: "text-warning" },
  info: { icon: Info, cls: "text-info" },
  ok: { icon: CheckCircle2, cls: "text-success" },
};

function AlertsFeed({ navigate, live }: { navigate: (p: string) => void; live: boolean }) {
  const [alerts, setAlerts] = useState<Finding[] | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setAlerts([
        { severity: "warning", title: "Journal errors", detail: "12 error-level entries this boot", fix: "" },
        { severity: "info", title: "Orphan packages", detail: "7 orphaned packages", fix: "" },
      ]);
      return;
    }
    // Heavy scan runs async (off the UI thread) AFTER the dashboard renders.
    runSystemScan()
      .then((s) => {
        const found = s.categories
          .flatMap((c) => c.findings)
          .filter((f) => f.severity === "warning" || f.severity === "critical")
          .slice(0, 6);
        setAlerts(found);
      })
      .catch(() => setAlerts([]));
  }, []);

  return (
    <GlassCard padding="lg" className="h-full">
      <div className="mb-md flex items-center justify-between">
        <p className="flex items-center gap-xs text-sm font-semibold text-content"><Activity className="h-4 w-4 text-accent" /> Alerts</p>
        <Button variant="ghost" size="sm" onClick={() => navigate("/doctor")}>Open Doctor</Button>
      </div>
      {alerts === null ? (
        <div className="flex items-center gap-sm py-lg text-sm text-content-muted"><Loader2 className="h-4 w-4 animate-spin" /> {live ? "Scanning system…" : "Loading…"}</div>
      ) : alerts.length === 0 ? (
        <div className="flex items-center gap-sm py-lg text-sm text-success"><CheckCircle2 className="h-4 w-4" /> No issues detected — system is healthy.</div>
      ) : (
        <div className="space-y-2xs">
          {alerts.map((a, i) => {
            const s = SEV_ICON[a.severity] ?? SEV_ICON.info;
            return (
              <button key={i} onClick={() => navigate("/doctor")} className="flex w-full items-start gap-sm rounded-lg border border-border-subtle bg-surface-sunken/40 p-sm text-left transition-colors hover:border-accent/40">
                <s.icon className={cn("mt-0.5 h-4 w-4 shrink-0", s.cls)} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-content">{a.title}</p>
                  <p className="truncate text-2xs text-content-muted">{a.detail}</p>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
