import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BatteryCharging,
  Heart,
  Clock,
  Plug,
  Zap,
  Activity,
  Download,
  TrendingDown,
  Gauge,
  Recycle,
  Info,
  AlertTriangle,
  ShieldAlert,
  ShieldOff,
  CheckCircle2,
  XCircle,
  Lock,
} from "lucide-react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge, StatusDot } from "@/components/ui/badge";
import { RingGauge } from "@/components/ui/ring-gauge";
import { Meter } from "@/components/ui/progress";
import { SectionTitle, StatRow } from "@/components/ui/section";
import { RouteFallback } from "@/components/shell/route-fallback";
import { useBattery, useCapability } from "@/hooks/use-telemetry";
import { useReduceMotion } from "@/store/prefs-store";
import { useBatteryEventsStore } from "@/store/battery-events-store";
import { useBatteryIntel } from "@/hooks/use-battery-intel";
import {
  isTauri,
  getChargeLimitEvidence,
  setChargeLimit as applyChargeLimit,
} from "@/lib/ipc";
import { isCharging, type ChargeLimitEvidence } from "@/lib/battery-types";
import type { CapabilityStatus } from "@/lib/capability-types";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

type Limit = 60 | 80 | 100;

const SEV: Record<string, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: "bg-info/12 text-info" },
  warning: { icon: AlertTriangle, cls: "bg-warning/12 text-warning" },
  critical: { icon: ShieldAlert, cls: "bg-danger/12 text-danger" },
};

export default function BatteryPage() {
  const { report, history, exportReport } = useBatteryIntel();
  const liveBattery = useBattery();
  const batteryCap = useCapability("battery");

  if (!report) return <RouteFallback />;

  // Prefer the live charge % from the telemetry stream; fall back to report.
  const charge = liveBattery?.chargePercent ?? report.chargePercent;
  // Prefer live status; fall back to the report's boolean. Never substring-match
  // "charg" (it matches "disCHARGing") — use the shared isCharging() helper.
  const charging = liveBattery ? isCharging(liveBattery.status) : report.charging;
  const scoreTone = report.score > 85 ? "success" : report.score > 65 ? "warning" : "danger";

  const degradationData = history.map((s) => ({
    t: new Date(s.ts).toLocaleDateString([], { month: "short", day: "numeric" }),
    wh: Number(s.energyFullWh.toFixed(1)),
    health: Number(s.healthPercent.toFixed(1)),
  }));

  async function doExport() {
    const md = await exportReport();
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "nexus-battery-report.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <PageHeader
        title="Battery Center"
        description="Health analytics, lifespan prediction & smart recommendations."
        actions={
          <>
            <Badge variant={scoreTone === "success" ? "success" : scoreTone === "warning" ? "warning" : "danger"} size="md">
              <StatusDot tone={scoreTone} pulse={false} /> Score {report.score}/100
            </Badge>
            <Button variant="solid" size="md" onClick={doExport}>
              <Download className="h-4 w-4" /> Export Report
            </Button>
          </>
        }
      />

      <motion.div variants={stagger(0.05)} initial="hidden" animate="show">
        {/* Hero row: charge + score + key stats */}
        <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
          <motion.div variants={fadeUp} className="lg:col-span-2">
            <GlassCard padding="lg" className="relative h-full overflow-hidden">
              <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full" style={{ background: "radial-gradient(closest-side, rgb(var(--color-success) / 0.18), transparent)" }} />
              <div className="flex flex-col gap-lg sm:flex-row sm:items-center">
                <BatteryGlyph level={charge} charging={charging} />
                <div className="flex-1">
                  <p className="flex items-center gap-xs text-sm capitalize text-content-muted">
                    {charging ? (<><Plug className="h-4 w-4 text-success" /> charging</>) : report.status}
                  </p>
                  <p className="font-display text-5xl font-semibold text-content">
                    {charge.toFixed(0)}<span className="text-2xl text-content-muted">%</span>
                  </p>
                  <p className="text-sm text-content-muted">
                    {report.runtimeMin != null
                      ? `${Math.floor(report.runtimeMin / 60)}h ${report.runtimeMin % 60}m ${charging ? "to full" : "remaining"}`
                      : `${report.model} · ${report.technology}`}
                  </p>
                  <div className="mt-md flex flex-wrap gap-lg">
                    <MiniStat icon={Zap} label="Draw" value={`${report.powerDrawW.toFixed(1)} W`} />
                    <MiniStat icon={Heart} label="Wear" value={`${report.wearPercent.toFixed(1)}%`} />
                    <MiniStat icon={Recycle} label="Cycles" value={`${report.cycleCount}`} />
                    <MiniStat icon={Activity} label="Voltage" value={`${report.voltageV.toFixed(2)} V`} />
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>

          <motion.div variants={fadeUp}>
            <GlassCard padding="lg" className="flex h-full flex-col items-center justify-center text-center">
              <RingGauge value={report.score} size={150} thickness={12} tone={scoreTone} label={`${report.score}`} sublabel="Health Score" />
              <p className="mt-md text-sm font-semibold capitalize text-content">{report.grade}</p>
              <p className="text-xs text-content-muted">{report.healthPercent.toFixed(1)}% of design capacity</p>
            </GlassCard>
          </motion.div>
        </div>

        {/* Health + lifespan + cycle analytics */}
        <div className="mt-md grid grid-cols-1 gap-md lg:grid-cols-3">
          <motion.div variants={fadeUp}>
            <GlassCard padding="lg" className="h-full">
              <SectionTitle title="Capacity Health" />
              <div className="mb-md">
                <div className="mb-xs flex items-end justify-between">
                  <span className="font-display text-3xl font-semibold text-content">{report.healthPercent.toFixed(1)}%</span>
                  <Badge variant={report.healthPercent > 80 ? "success" : "warning"}>{report.healthPercent > 80 ? "Good" : "Aging"}</Badge>
                </div>
                <Meter value={report.healthPercent} tone={report.healthPercent > 80 ? "success" : "warning"} />
              </div>
              <StatRow label="Design Capacity" value={`${report.designWh.toFixed(1)} Wh`} />
              <StatRow label="Full Capacity" value={`${report.fullWh.toFixed(1)} Wh`} />
              <StatRow label="Lost to wear" value={`${(report.designWh - report.fullWh).toFixed(1)} Wh`} tone="warning" />
              <StatRow label="Current Energy" value={`${report.nowWh.toFixed(1)} Wh`} />
            </GlassCard>
          </motion.div>

          <motion.div variants={fadeUp}>
            <GlassCard padding="lg" className="h-full">
              <SectionTitle title="Lifespan Prediction" />
              <div className="grid place-items-center py-sm">
                <Gauge className="h-10 w-10 text-accent" />
                <p className="mt-sm font-display text-3xl font-semibold text-content">
                  {report.lifespan.yearsRemaining.toFixed(1)}<span className="text-base text-content-muted"> yrs</span>
                </p>
                <p className="text-xs text-content-subtle">to 80% end-of-life</p>
              </div>
              <p className="mt-sm rounded-lg bg-surface-sunken/50 p-sm text-xs text-content-muted">{report.lifespan.summary}</p>
              <StatRow label="Equivalent cycles" value={`~${report.lifespan.equivalentCycles}`} />
              <StatRow label="Cycles to EOL" value={`~${report.lifespan.cyclesToEol}`} />
            </GlassCard>
          </motion.div>

          <motion.div variants={fadeUp}>
            <ChargeLimitCard cap={batteryCap?.status} />
          </motion.div>
        </div>

        {/* Degradation history */}
        <motion.div variants={fadeUp} className="mt-md">
          <GlassCard padding="lg">
            <SectionTitle
              title="Capacity Degradation"
              description={
                report.degradation.samples > 1
                  ? `Lost ${report.degradation.lostWh.toFixed(1)} Wh over ${report.degradation.spanDays.toFixed(0)} days`
                  : "Building history — check back as samples accumulate"
              }
              action={<Badge variant="neutral"><TrendingDown className="h-3 w-3" /> {report.degradation.samples} samples</Badge>}
            />
            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={degradationData} margin={{ top: 6, right: 4, bottom: 0, left: -16 }}>
                  <defs>
                    <linearGradient id="deg" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="rgb(var(--color-accent))" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="rgb(var(--color-accent))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="rgb(var(--color-border) / 0.5)" strokeDasharray="3 6" />
                  <XAxis dataKey="t" tickLine={false} axisLine={false} tick={{ fill: "rgb(var(--color-text-subtle))", fontSize: 11 }} />
                  <YAxis domain={["dataMin - 1", "dataMax + 1"]} tickLine={false} axisLine={false} width={44} tick={{ fill: "rgb(var(--color-text-subtle))", fontSize: 11 }} unit=" Wh" />
                  <Tooltip contentStyle={{ background: "rgb(var(--color-surface-raised))", border: "1px solid rgb(var(--color-border))", borderRadius: 12, fontSize: 12, color: "rgb(var(--color-text))" }} />
                  <Area type="monotone" dataKey="wh" name="Full capacity" stroke="rgb(var(--color-accent))" strokeWidth={2.5} fill="url(#deg)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>
        </motion.div>

        {/* Recommendations */}
        <motion.div variants={fadeUp} className="mt-md">
          <GlassCard padding="lg">
            <SectionTitle title="Smart Recommendations" />
            <div className="space-y-sm">
              {report.recommendations.map((r, i) => {
                const sev = SEV[r.severity] ?? SEV.info;
                return (
                  <div key={i} className="flex items-start gap-md rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
                    <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md", sev.cls)}>
                      <sev.icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-content">{r.title}</p>
                      <p className="text-xs text-content-muted">{r.detail}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </motion.div>
      </motion.div>
    </div>
  );
}

/**
 * Charge Limit — never shows fake interactive controls. It probes the kernel for
 * a real charge-threshold interface; if one exists, it offers 60/80/100 that
 * write through it. If not, it explains *why* and shows the detected evidence.
 */
function ChargeLimitCard({ cap }: { cap?: CapabilityStatus }) {
  const [ev, setEv] = useState<ChargeLimitEvidence | null>(null);
  const [limit, setLimit] = useState<Limit>(80);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isTauri()) getChargeLimitEvidence().then(setEv).catch(() => setEv(null));
  }, []);

  // Outside Tauri (browser demo) we cannot probe — be honest about that too.
  const supported = ev?.supported ?? false;

  async function apply(l: Limit) {
    setLimit(l);
    if (!isTauri()) { setStatus({ kind: "ok", msg: `Demo — would cap charge at ${l}%.` }); return; }
    setBusy(true);
    try {
      const msg = await applyChargeLimit(l);
      setStatus({ kind: "ok", msg });
    } catch (e) {
      setStatus({ kind: "error", msg: String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard padding="lg" className="h-full">
      <SectionTitle
        title="Charge Limit"
        description="Cap charge to reduce battery wear"
        action={
          supported ? (
            <Badge variant="success"><CheckCircle2 className="h-3 w-3" /> available</Badge>
          ) : (
            <Badge variant="neutral"><Lock className="h-3 w-3" /> firmware-limited</Badge>
          )
        }
      />

      {status && (
        <div className={cn("mb-sm flex items-center gap-xs rounded-md border p-sm text-xs", status.kind === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-success/30 bg-success/10 text-success")}>
          {status.kind === "error" ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          <span>{status.msg}</span>
        </div>
      )}

      {supported ? (
        <div className="space-y-sm">
          {([60, 80, 100] as Limit[]).map((l) => (
            <button
              key={l}
              disabled={busy}
              onClick={() => apply(l)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg border p-md text-left transition-all",
                limit === l ? "border-accent/50 bg-accent/8" : "border-border hover:border-border-strong",
              )}
            >
              <div>
                <p className="text-sm font-semibold text-content">{l}%</p>
                <p className="text-2xs text-content-subtle">{l === 60 ? "Max longevity" : l === 80 ? "Recommended" : "Max runtime"}</p>
              </div>
              {limit === l && <StatusDot tone="accent" pulse={false} />}
            </button>
          ))}
          <p className="text-2xs text-content-subtle">Writes to <code>charge_control_end_threshold</code> via the kernel.</p>
        </div>
      ) : (
        <div>
          <div className="flex items-start gap-sm rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
            <ShieldOff className="mt-0.5 h-5 w-5 shrink-0 text-content-subtle" />
            <p className="text-sm text-content-muted">
              {ev?.explanation ??
                (cap?.notes ||
                  "Your firmware does not expose battery charge thresholds to Linux.")}
            </p>
          </div>
          {ev && ev.probes.length > 0 && (
            <div className="mt-sm">
              <p className="mb-xs text-2xs uppercase tracking-wider text-content-subtle">Detected evidence</p>
              <div className="space-y-2xs">
                {ev.probes.map((p) => (
                  <div key={p.path} className="flex items-center gap-xs rounded-md bg-surface-sunken/40 px-sm py-2xs">
                    {p.exists ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> : <XCircle className="h-3.5 w-3.5 shrink-0 text-content-subtle" />}
                    <code className="min-w-0 flex-1 truncate text-2xs text-content-muted" title={`${p.path} — ${p.purpose}`}>{p.path.replace("/sys/class/power_supply/", "").replace("/sys/devices/platform/", "")}</code>
                    <span className="shrink-0 text-2xs text-content-subtle">{p.exists ? "present" : "absent"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  );
}

/** Level → color tone, per the design thresholds (80 green / 40 cyan / 20 amber / red). */
function batteryTone(level: number): "success" | "iris" | "warning" | "danger" {
  if (level >= 80) return "success";
  if (level >= 40) return "iris";
  if (level >= 20) return "warning";
  return "danger";
}

/**
 * Premium vertical battery: liquid fill synced to the live level, color by
 * charge band, a configurable charging animation (Pulse / Electric / Neon /
 * Minimal / None) and a one-shot disconnect effect (Fade / Ripple / Battery
 * Drain / Minimal / None). All continuous + transition effects are gated behind
 * reduce-motion so Battery Saver / "animations off" keeps it static and cheap.
 */
function BatteryGlyph({ level, charging }: { level: number; charging: boolean }) {
  const reduce = useReduceMotion();
  const connectAnim = useBatteryEventsStore((s) => s.connectAnim);
  const disconnectAnim = useBatteryEventsStore((s) => s.disconnectAnim);
  const tone = batteryTone(level);
  const fillPct = Math.max(3, Math.min(100, level));

  const animating = charging && !reduce && connectAnim !== "none";
  const neon = connectAnim === "neon";
  const showGlow = animating && (connectAnim === "pulse" || connectAnim === "electric" || neon);
  const showShimmer = animating && (connectAnim === "electric" || neon);
  const glow = (a: number) => `0 0 26px rgb(var(--color-${tone}) / ${a})`;

  // One-shot disconnect effect, retriggered on each charging true→false edge.
  const prevCharging = useRef(charging);
  const [disc, setDisc] = useState(0);
  useEffect(() => {
    if (prevCharging.current && !charging && !reduce && disconnectAnim !== "none") {
      setDisc((n) => n + 1);
    }
    prevCharging.current = charging;
  }, [charging, reduce, disconnectAnim]);
  const done = () => setDisc(0);

  return (
    <div className="relative grid shrink-0 place-items-center">
      {/* terminal nub */}
      <div className="h-2 w-7 rounded-t-md bg-border-strong" />
      <motion.div
        className="relative h-36 w-20 rounded-2xl border-2 bg-surface-sunken"
        style={{ borderColor: neon ? `rgb(var(--color-${tone}))` : "rgb(var(--color-border-strong))" }}
        animate={showGlow ? { boxShadow: [glow(0), glow(neon ? 0.85 : 0.55), glow(0)] } : { boxShadow: glow(0) }}
        transition={showGlow ? { duration: neon ? 1.3 : 2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.4 }}
      >
        {/* fill track */}
        <div className="absolute inset-1.5 overflow-hidden rounded-xl">
          <motion.div
            className="absolute inset-x-0 bottom-0"
            style={{
              background: `linear-gradient(180deg, rgb(var(--color-${tone})), rgb(var(--color-${tone}) / 0.72))`,
            }}
            initial={false}
            animate={{ height: `${fillPct}%` }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="absolute inset-x-0 top-0 h-1.5 bg-white/30" />
            {showShimmer && (
              <motion.div
                className="absolute inset-x-0 h-10 bg-gradient-to-t from-transparent via-white/25 to-transparent"
                initial={{ y: "120%" }}
                animate={{ y: "-130%" }}
                transition={{ duration: neon ? 1.2 : 1.7, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </motion.div>

          {/* disconnect: battery-drain wipe (top→down over the fill) */}
          <AnimatePresence>
            {disc > 0 && disconnectAnim === "drain" && (
              <motion.div
                key={`drain-${disc}`}
                className="absolute inset-x-0 top-0 bg-surface-sunken"
                initial={{ height: "0%" }}
                animate={{ height: "100%" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeIn" }}
                onAnimationComplete={done}
              />
            )}
          </AnimatePresence>
        </div>

        {/* disconnect: ripple ring from center */}
        <AnimatePresence>
          {disc > 0 && disconnectAnim === "ripple" && (
            <motion.div
              key={`ripple-${disc}`}
              className="pointer-events-none absolute inset-0 m-auto h-6 w-6 rounded-full border-2"
              style={{ borderColor: `rgb(var(--color-${tone}))` }}
              initial={{ scale: 0.3, opacity: 0.85 }}
              animate={{ scale: 4.2, opacity: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              onAnimationComplete={done}
            />
          )}
        </AnimatePresence>

        {/* charging bolt */}
        {charging && (
          <BatteryCharging
            className={cn(
              "absolute inset-0 z-10 m-auto h-9 w-9 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]",
              neon && "drop-shadow-[0_0_8px_rgba(255,255,255,0.7)]",
            )}
          />
        )}
      </motion.div>

      {/* disconnect: fade / minimal flash over the whole glyph */}
      <AnimatePresence>
        {disc > 0 && (disconnectAnim === "fade" || disconnectAnim === "minimal") && (
          <motion.div
            key={`fade-${disc}`}
            className="pointer-events-none absolute inset-0 rounded-2xl bg-canvas"
            initial={{ opacity: disconnectAnim === "fade" ? 0.6 : 0.3 }}
            animate={{ opacity: 0 }}
            transition={{ duration: disconnectAnim === "fade" ? 0.7 : 0.35 }}
            onAnimationComplete={done}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }) {
  return (
    <div>
      <p className="flex items-center gap-xs text-2xs uppercase tracking-wider text-content-subtle">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="text-sm font-semibold text-content">{value}</p>
    </div>
  );
}
