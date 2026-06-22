import { memo, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
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
import { useTelemetrySource } from "@/hooks/use-telemetry";
import { useTelemetryStore } from "@/store/telemetry-store";
import { useChartHistory } from "@/hooks/use-chart-history";
import { useBatteryIntel } from "@/hooks/use-battery-intel";
import {
  useHealthScore,
  useHealthGrade,
  useHealthSubsystems,
} from "@/store/intelligence-store";
import { useControlActions } from "@/hooks/use-control";
import {
  isTauri,
  getGpuInfo,
  getGameLaunchers,
  runSystemScan,
  optimizerScan,
  optimizerCleanTemp,
  optimizerRemoveOrphans,
  optimizerVacuumJournal,
} from "@/lib/ipc";
import type { GpuInfo } from "@/lib/gpu-types";
import type { LauncherStatus } from "@/lib/games-types";
import { isCharging, type BatteryReport } from "@/lib/battery-types";
import type { Finding } from "@/lib/sysdoctor-types";
import { useRenderCount } from "@/components/dev/render-count";
import { cn } from "@/lib/cn";

function trend(series: number[]): number {
  if (series.length < 6) return 0;
  const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / (a.length || 1);
  return Math.round(avg(series.slice(-5)) - avg(series.slice(-10, -5)));
}

export default function DashboardPage() {
  useRenderCount("DashboardPage");
  const navigate = useNavigate();
  const live = useTelemetrySource() === "live";
  const actions = useControlActions();

  // The page shell subscribes to NOTHING that changes at runtime beyond the
  // (rare) telemetry-source flip: live telemetry lives in self-subscribing
  // leaves (<LiveMetrics/>, <GpuCenter/>, …) and the intelligence/battery
  // reports live in their own slice-subscribing sections (<HealthSection/>,
  // <SystemStatusBadge/>, <BatterySection/>). So neither a 1.5s telemetry frame
  // nor the few-second intelligence poll re-renders the dashboard tree — only
  // the specific widget whose data actually changed. The page itself renders
  // ~once and then stays idle.
  return (
    <div>
      <PageHeader
        title="Command Center"
        description="Welcome back — your system at a glance."
        actions={<SystemStatusBadge />}
      />

      <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="space-y-md">
        {/* Live telemetry row — isolated subscriptions (re-renders per tick here only) */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
          <LiveMetrics />
        </motion.div>

        {/* Health score (hero) + Quick actions */}
        <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
          <motion.div variants={fadeUp} className="lg:col-span-2">
            <HealthSection />
          </motion.div>
          <motion.div variants={fadeUp}>
            <QuickActions navigate={navigate} live={live} setPower={actions.setPower} />
          </motion.div>
        </div>

        {/* GPU center + Gaming readiness */}
        <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
          <motion.div variants={fadeUp} className="lg:col-span-2">
            <GpuCenter live={live} />
          </motion.div>
          <motion.div variants={fadeUp}>
            <GamingReadiness live={live} />
          </motion.div>
        </div>

        {/* Battery intelligence + Alerts */}
        <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
          <motion.div variants={fadeUp}>
            <BatterySection />
          </motion.div>
          <motion.div variants={fadeUp} className="lg:col-span-2">
            <AlertsFeed navigate={navigate} live={live} />
          </motion.div>
        </div>

        {/* Recommended actions */}
        <motion.div variants={fadeUp}>
          <RecommendedActions />
        </motion.div>
      </motion.div>
    </div>
  );
}

/* ------------------------------ Live metrics ----------------------------- */

/**
 * The four live telemetry cards, isolated from the page shell. This is the only
 * dashboard subtree that subscribes to per-tick CPU/GPU/memory/thermal slices,
 * so a 1.5s frame re-renders just these cards (whose displayed values genuinely
 * change every tick) — never the surrounding widgets.
 */
const LiveMetrics = memo(function LiveMetrics() {
  useRenderCount("LiveMetrics");
  // Sparkline data batched to ≤1Hz (and frozen when the window is hidden); the
  // displayed values come from a SHALLOW selector of already-rounded/formatted
  // primitives, so a card re-renders only when a *shown* figure changes — not on
  // every sub-integer telemetry tick.
  const hist = useChartHistory();
  const cpuSeries = useMemo(() => hist.map((p) => p.cpuUsage), [hist]);
  const gpuSeries = useMemo(() => hist.map((p) => p.gpuUsage), [hist]);
  const memSeries = useMemo(() => hist.map((p) => p.memUsage), [hist]);
  const tempSeries = useMemo(() => hist.map((p) => p.cpuTemp), [hist]);

  const d = useTelemetryStore(
    useShallow((s) => {
      const cpu = s.snapshot?.cpu;
      const gpu = s.snapshot?.gpu;
      const mem = s.snapshot?.memory;
      const cpuTemp = Math.round(s.snapshot?.thermals?.cpuC ?? cpu?.temperatureC ?? 0);
      return {
        cpuUsage: cpu ? String(Math.round(cpu.usage)) : "—",
        cpuFooter: cpu ? `${cpu.model.split(" ").slice(0, 3).join(" ")} · ${(cpu.frequencyMhz / 1000).toFixed(1)} GHz` : "Detecting…",
        gpuUsage: gpu ? String(Math.round(gpu.usage)) : "—",
        gpuFooter: gpu ? `${gpu.name.replace("NVIDIA GeForce ", "")} · ${gpu.temperatureC?.toFixed(0) ?? "—"}°C` : "No GPU",
        memValue: mem ? formatBytes(mem.usedBytes, 1).replace(" GB", "") : "—",
        memUnit: mem ? `/ ${formatBytes(mem.totalBytes, 0)}` : "",
        memFooter: mem ? `${Math.round(mem.usage)}% used` : "Detecting…",
        cpuTemp,
      };
    }),
  );

  return (
    <>
      <MetricCard icon={Cpu} label="CPU" value={d.cpuUsage} unit="%" trend={trend(cpuSeries)} tone="accent" series={cpuSeries} footer={d.cpuFooter} />
      <MetricCard icon={CircuitBoard} label="GPU" value={d.gpuUsage} unit="%" trend={trend(gpuSeries)} tone="info" series={gpuSeries} footer={d.gpuFooter} />
      <MetricCard icon={MemoryStick} label="Memory" value={d.memValue} unit={d.memUnit} trend={trend(memSeries)} tone="success" series={memSeries} footer={d.memFooter} />
      <MetricCard icon={Thermometer} label="CPU Thermals" value={d.cpuTemp ? String(d.cpuTemp) : "—"} unit="°C" trend={trend(tempSeries)} tone={d.cpuTemp > 80 ? "danger" : d.cpuTemp > 70 ? "warning" : "success"} series={tempSeries} footer="Package temperature" />
    </>
  );
});

/* -------------------------- Recommended actions -------------------------- */

type Rec = { id: string; icon: LucideIcon; label: string; detail: string; run: () => Promise<string> };

const RecommendedActions = memo(function RecommendedActions() {
  useRenderCount("RecommendedActions");
  const [recs, setRecs] = useState<Rec[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});

  function human(b: number) {
    const u = ["B", "KB", "MB", "GB", "TB"]; let v = b, i = 0;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(1)} ${u[i]}`;
  }

  useEffect(() => {
    if (!isTauri()) {
      setRecs([
        { id: "cache", icon: Trash2, label: "Free 1.2 GB by clearing caches", detail: "Thumbnail & app caches", run: async () => "Demo" },
        { id: "orphans", icon: CheckCircle2, label: "Remove 7 orphan packages", detail: "Reclaim space safely", run: async () => "Demo" },
        { id: "journal", icon: Activity, label: "Vacuum journals (≈488 MB)", detail: "Keep last 30 days", run: async () => "Demo" },
      ]);
      return;
    }
    optimizerScan()
      .then((s) => {
        const list: Rec[] = [];
        const reclaim = s.temp.reduce((a, t) => a + t.sizeBytes, 0);
        if (reclaim > 200 * 1024 * 1024) {
          list.push({ id: "cache", icon: Trash2, label: `Free ${human(reclaim)} by clearing caches`, detail: "Thumbnail cache (safe, one-click)", run: () => optimizerCleanTemp("thumbnails") });
        }
        if (s.orphans.supported && s.orphans.count > 0) {
          list.push({ id: "orphans", icon: CheckCircle2, label: `Remove ${s.orphans.count} orphan package(s)`, detail: "Authorizes via polkit", run: optimizerRemoveOrphans });
        }
        if (s.journal.supported && s.journal.sizeBytes > 200 * 1024 * 1024) {
          list.push({ id: "journal", icon: Activity, label: `Vacuum journals (${s.journal.human})`, detail: "Keep the last 30 days", run: () => optimizerVacuumJournal(30) });
        }
        setRecs(list);
      })
      .catch(() => setRecs([]));
  }, []);

  async function exec(r: Rec) {
    setBusy(r.id);
    try { const msg = await r.run(); setDone((d) => ({ ...d, [r.id]: msg })); }
    catch (e) { setDone((d) => ({ ...d, [r.id]: String(e) })); }
    finally { setBusy(null); }
  }

  return (
    <GlassCard padding="lg">
      <p className="mb-md flex items-center gap-xs text-sm font-semibold text-content"><Wand2 className="h-4 w-4 text-accent" /> Recommended Actions</p>
      {recs === null ? (
        <div className="flex items-center gap-sm py-md text-sm text-content-muted"><Loader2 className="h-4 w-4 animate-spin" /> Analyzing…</div>
      ) : recs.length === 0 ? (
        <div className="flex items-center gap-sm py-md text-sm text-success"><CheckCircle2 className="h-4 w-4" /> Nothing to clean up — your system is tidy.</div>
      ) : (
        <div className="grid grid-cols-1 gap-sm sm:grid-cols-3">
          {recs.map((r) => (
            <div key={r.id} className="flex flex-col rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
              <r.icon className="h-5 w-5 text-accent" />
              <p className="mt-xs flex-1 text-sm font-medium text-content">{r.label}</p>
              <p className="text-2xs text-content-subtle">{r.detail}</p>
              {done[r.id] ? (
                <p className="mt-sm truncate text-2xs text-success" title={done[r.id]}>✓ {done[r.id]}</p>
              ) : (
                <Button variant="primary" size="sm" className="mt-sm" disabled={busy === r.id} onClick={() => exec(r)}>
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />} Run
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
});

/* ----------------------------- Health hero ------------------------------- */

/** Header status pill — subscribes only to the health *score* (a primitive that
 *  is stable across polls when unchanged), so it re-renders only when status
 *  tier actually shifts, never the page. */
const SystemStatusBadge = memo(function SystemStatusBadge() {
  useRenderCount("SystemStatusBadge");
  const score = useHealthScore();
  const tone = score >= 85 ? "success" : score >= 60 ? "warning" : "danger";
  return (
    <Badge variant={tone === "success" ? "success" : "warning"} size="md">
      <StatusDot tone={tone} pulse={false} />
      {score >= 85 ? "All systems nominal" : score >= 60 ? "Attention advised" : "Action needed"}
    </Badge>
  );
});

/** Owns the intelligence-report subscription for the hero so the poll re-renders
 *  this section only — not the dashboard shell. */
const HealthSection = memo(function HealthSection() {
  const score = useHealthScore();
  const grade = useHealthGrade();
  const subsystems = useHealthSubsystems();
  const tone = score >= 85 ? "success" : score >= 60 ? "warning" : "danger";
  return <HealthHero score={score} grade={grade} tone={tone} subsystems={subsystems} />;
});

const HealthHero = memo(function HealthHero({ score, grade, tone, subsystems }: { score: number; grade: string; tone: "success" | "warning" | "danger"; subsystems: { name: string; score: number; status: string; detail: string }[] }) {
  useRenderCount("HealthHero");
  return (
    <GlassCard padding="lg" className="relative h-full overflow-hidden">
      <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full" style={{ background: `radial-gradient(closest-side, rgb(var(--color-${tone}) / 0.18), transparent)` }} />
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
});

/* ----------------------------- Quick actions ----------------------------- */

const QuickActions = memo(function QuickActions({ navigate, live, setPower }: { navigate: (p: string) => void; live: boolean; setPower: (n: string) => Promise<{ ok: boolean; msg: string }> }) {
  useRenderCount("QuickActions");
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
});

/* ------------------------------- GPU center ------------------------------ */

const GpuCenter = memo(function GpuCenter({ live }: { live: boolean }) {
  useRenderCount("GpuCenter");
  // Rounded shallow selector: re-renders only when a *displayed* GPU figure
  // changes. While the GPU idles (stable clocks/usage) this collapses to nearly
  // zero renders; under load it tracks the real changes.
  const gpu = useTelemetryStore(
    useShallow((s) => {
      const g = s.snapshot?.gpu;
      if (!g) return null;
      return {
        name: g.name,
        usage: Math.round(g.usage),
        vramUsedMb: g.vramUsedMb,
        vramTotalMb: g.vramTotalMb,
        temperatureC: g.temperatureC != null ? Math.round(g.temperatureC) : null,
        coreClockMhz: g.coreClockMhz ?? null,
        memClockMhz: g.memClockMhz ?? null,
        powerW: g.powerW != null ? Math.round(g.powerW) : null,
        powerLimitW: g.powerLimitW != null ? Math.round(g.powerLimitW) : null,
      };
    }),
  );
  const hist = useChartHistory();
  const gpuTempSeries = useMemo(() => hist.map((p) => p.gpuTemp), [hist]);
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
});

/* --------------------------- Gaming readiness ---------------------------- */

const GamingReadiness = memo(function GamingReadiness({ live }: { live: boolean }) {
  useRenderCount("GamingReadiness");
  const [launchers, setLaunchers] = useState<LauncherStatus | null>(null);
  useEffect(() => {
    if (!isTauri()) { setLaunchers({ steam: true, lutris: true, heroic: false, gamemode: true, gamescope: false, mangohud: false, primeRun: true }); return; }
    getGameLaunchers().then(setLaunchers).catch(() => {});
  }, []);

  // Subscribe to derived *booleans*, not raw telemetry: these selectors only
  // change (and thus re-render this card) when a readiness check actually flips,
  // not on every 1.5s frame.
  const hasGpu = useTelemetryStore((s) => !!s.snapshot?.gpu);
  const thermalsOk = useTelemetryStore((s) => {
    const t = s.snapshot?.thermals?.cpuC ?? s.snapshot?.cpu?.temperatureC ?? 0;
    return t > 0 && t < 80;
  });
  const memOk = useTelemetryStore((s) => {
    const u = s.snapshot?.memory?.usage ?? 0;
    return u > 0 && u < 80;
  });

  const checks = [
    { label: "GPU drivers", ok: hasGpu },
    { label: "Steam", ok: !!launchers?.steam },
    { label: "GameMode", ok: !!launchers?.gamemode },
    { label: "MangoHud", ok: !!launchers?.mangohud },
    { label: "Thermals headroom", ok: thermalsOk },
    { label: "Free memory", ok: memOk },
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
});

/* -------------------------- Battery intelligence ------------------------- */

/** Owns the one-shot battery-report load so it doesn't live on the page shell. */
const BatterySection = memo(function BatterySection() {
  const { report, history } = useBatteryIntel();
  const sessions = chargeSessions(history.map((s) => s.status));
  return <BatteryIntel report={report} sessions={sessions} />;
});

function chargeSessions(statuses: string[]): number {
  let sessions = 0;
  let prevCharging = false;
  for (const s of statuses) {
    const charging = isCharging(s);
    if (charging && !prevCharging) sessions++;
    prevCharging = charging;
  }
  return sessions;
}

const BatteryIntel = memo(function BatteryIntel({ report, sessions }: { report: BatteryReport | null; sessions: number }) {
  useRenderCount("BatteryIntel");
  // Live charge %/draw via a SHALLOW selector of rounded primitives — battery %
  // and draw barely move, so this card re-renders only when a shown figure
  // changes (it has no live sparkline), not on every telemetry tick. Wear/cycle/
  // lifespan come from the one-shot report.
  const live = useTelemetryStore(
    useShallow((s) => {
      const b = s.snapshot?.battery;
      return {
        percent: b ? Math.round(b.chargePercent) : null,
        charging: isCharging(b?.status),
        drawW: b ? Math.round(Math.abs(b.powerDrawW)) : null,
      };
    }),
  );
  const wear = report?.wearPercent;
  const cycles = report?.cycleCount;
  const years = report?.lifespan.yearsRemaining;
  const dischargeW = report?.dischargeRateW != null ? Math.round(Math.abs(report.dischargeRateW)) : live.drawW;
  const charging = live.charging;
  const percent = live.percent;

  if (wear == null && percent == null) {
    return <GlassCard padding="lg" className="grid h-full place-items-center text-center"><div><BatteryCharging className="mx-auto h-8 w-8 text-content-subtle" /><p className="mt-sm text-sm text-content-muted">No battery detected.</p></div></GlassCard>;
  }
  const rows = [
    { label: "Battery wear", value: wear != null ? `${wear.toFixed(1)}%` : "—", tone: (wear ?? 0) > 20 ? "warning" : "success" },
    { label: "Cycle count", value: cycles != null ? `${cycles}` : "—" },
    { label: charging ? "Charge rate" : "Power draw", value: dischargeW != null ? `${dischargeW} W` : "—" },
    { label: "Est. lifespan", value: years != null ? `${years.toFixed(1)} yrs` : "—" },
    { label: "Charge sessions", value: `${sessions}` },
  ];
  return (
    <GlassCard padding="lg" className="h-full">
      <p className="mb-md flex items-center gap-xs text-sm font-semibold text-content"><BatteryCharging className="h-4 w-4 text-success" /> Battery Intelligence</p>
      <div className="mb-md flex items-end justify-between">
        <span className="font-display text-3xl font-semibold text-content">{percent != null ? `${percent}%` : "—"}</span>
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
});

/* ------------------------------- Alerts feed ----------------------------- */

const SEV_ICON: Record<string, { icon: LucideIcon; cls: string }> = {
  critical: { icon: XCircle, cls: "text-danger" },
  high: { icon: AlertTriangle, cls: "text-danger" },
  warning: { icon: AlertTriangle, cls: "text-warning" },
  low: { icon: Info, cls: "text-content-muted" },
  info: { icon: Info, cls: "text-info" },
  ok: { icon: CheckCircle2, cls: "text-success" },
};

const AlertsFeed = memo(function AlertsFeed({ navigate, live }: { navigate: (p: string) => void; live: boolean }) {
  useRenderCount("AlertsFeed");
  const [alerts, setAlerts] = useState<Finding[] | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setAlerts([
        { severity: "warning", title: "Journal errors", detail: "12 error-level entries this boot", fix: "", kind: "journal", unit: null, userScope: false },
        { severity: "info", title: "Orphan packages", detail: "7 orphaned packages", fix: "", kind: "package", unit: null, userScope: false },
      ]);
      return;
    }
    // Heavy scan runs async (off the UI thread) AFTER the dashboard renders.
    runSystemScan()
      .then((s) => {
        const found = s.categories
          .flatMap((c) => c.findings)
          .filter((f) => f.severity === "warning" || f.severity === "high" || f.severity === "critical")
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
});
