import { memo, useMemo } from "react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import { Cpu, CircuitBoard, MemoryStick, Thermometer, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { RingGauge } from "@/components/ui/ring-gauge";
import { Meter, meterTone } from "@/components/ui/progress";
import { SectionTitle } from "@/components/ui/section";
import { LiveLineChart } from "@/components/charts/live-line-chart";
import { PowerCenter } from "@/components/power/power-center";
import { ThermalDashboard } from "@/components/power/thermal-dashboard";
import { FanControl } from "@/components/power/fan-control";
import { GpuIntelligence } from "@/components/power/gpu-intelligence";
import { stagger, fadeUp } from "@/lib/motion";
import { useTelemetryStore } from "@/store/telemetry-store";
import { useChartHistory, useInView } from "@/hooks/use-chart-history";
import { useRenderCount } from "@/components/dev/render-count";

/**
 * Performance page. The shell subscribes to NOTHING that changes at runtime, so
 * a 1.5s telemetry frame never re-renders the page tree — only the specific
 * self-subscribing leaf whose displayed value actually changed:
 *   • <LiveGauges/> — the three CPU/GPU/Memory ring cards (each card subscribes
 *     to its own *rounded/formatted* display values, so it re-renders only when
 *     a shown number changes, not on every raw-float tick).
 *   • <LiveTelemetryChart/> — the multi-line history chart.
 *   • <PerCoreLoad/> — the per-core meters.
 * The static sections (PowerCenter, GpuIntelligence, ThermalDashboard's
 * capability tables, FanControl) own their own polls and never see the
 * fast telemetry cadence.
 */
export default function PerformancePage() {
  useRenderCount("PerformancePage");
  return (
    <div>
      <PageHeader
        title="Performance"
        description="Power profiles, live telemetry, thermals & fan control — for HP OMEN."
      />

      {/* Power & profile center (real power-profiles-daemon control) */}
      <div className="mb-lg">
        <PowerCenter />
      </div>

      <motion.div variants={stagger(0.05)} initial="hidden" animate="show">
        {/* Live gauges */}
        <motion.div variants={fadeUp} className="grid grid-cols-1 gap-md md:grid-cols-3">
          <LiveGauges />
        </motion.div>

        <div className="mt-md grid grid-cols-1 gap-md lg:grid-cols-3">
          <motion.div variants={fadeUp} className="lg:col-span-2">
            <GlassCard padding="lg">
              <SectionTitle
                title="Live Telemetry"
                description="Utilization & temperatures"
                action={
                  <div className="flex gap-md text-xs">
                    <Legend color="rgb(var(--color-accent))" label="CPU %" />
                    <Legend color="rgb(var(--color-iris))" label="GPU %" />
                    <Legend color="rgb(var(--color-danger))" label="CPU °C" />
                  </div>
                }
              />
              <LiveTelemetryChart />
            </GlassCard>
          </motion.div>

          <motion.div variants={fadeUp}>
            <GlassCard padding="lg" className="h-full">
              <PerCoreLoad />
            </GlassCard>
          </motion.div>
        </div>

        {/* GPU intelligence — content-visibility defers its paint until scrolled near */}
        <div className="cv-auto">
          <div className="mt-lg mb-md flex items-center gap-sm">
            <CircuitBoard className="h-4 w-4 text-accent" />
            <h2 className="font-display text-lg font-semibold text-content">GPU Intelligence</h2>
          </div>
          <GpuIntelligence />
        </div>

        {/* Thermal intelligence dashboard */}
        <div className="cv-auto">
          <div className="mt-lg mb-md flex items-center gap-sm">
            <Thermometer className="h-4 w-4 text-accent" />
            <h2 className="font-display text-lg font-semibold text-content">Thermal Intelligence</h2>
            <Badge variant="neutral" size="sm">read-only · validated</Badge>
          </div>
          <ThermalDashboard />
        </div>

        {/* Fan control — real writes (Victus-S), capability-gated */}
        <div className="cv-auto mt-md">
          <FanControl />
        </div>
      </motion.div>
    </div>
  );
}

/* ------------------------------ Live gauges ------------------------------ */

/** Presentational gauge card — pure, re-renders only when its props change. */
const GaugeCard = memo(function GaugeCard({
  icon: Icon,
  label,
  value,
  sub,
  tone,
  extra,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  sub: string;
  tone: "accent" | "info" | "success";
  extra: string;
}) {
  return (
    <GlassCard interactive padding="lg" className="flex items-center gap-lg">
      <RingGauge value={value} tone={tone} size={104} label={`${value}%`} />
      <div className="min-w-0">
        <p className="flex items-center gap-xs text-sm font-semibold text-content">
          <Icon className="h-4 w-4 text-accent" /> {label}
        </p>
        <p className="mt-2xs truncate text-xs text-content-muted">{sub}</p>
        <p className="mt-md text-2xs uppercase tracking-wider text-content-subtle">{extra}</p>
      </div>
    </GlassCard>
  );
});

/**
 * Each gauge subscribes (via `useShallow`) only to its own *display-ready*
 * values, so zustand skips the re-render whenever every shown figure is
 * unchanged frame-to-frame — satisfying "update only when displayed values
 * change" rather than re-rendering on every raw-float tick.
 */
const CpuGauge = memo(function CpuGauge() {
  useRenderCount("CpuGauge");
  const d = useTelemetryStore(
    useShallow((s) => {
      const cpu = s.snapshot?.cpu;
      return {
        usage: Math.round(cpu?.usage ?? 0),
        model: cpu?.model ?? "Processor",
        ghz: ((cpu?.frequencyMhz ?? 0) / 1000).toFixed(2),
      };
    }),
  );
  return <GaugeCard icon={Cpu} label="CPU" value={d.usage} sub={d.model} tone="accent" extra={`${d.ghz} GHz`} />;
});

const GpuGauge = memo(function GpuGauge() {
  useRenderCount("GpuGauge");
  const d = useTelemetryStore(
    useShallow((s) => {
      const gpu = s.snapshot?.gpu;
      return {
        usage: Math.round(gpu?.usage ?? 0),
        name: gpu?.name ?? "No GPU",
        vram: gpu ? `${gpu.vramUsedMb} / ${gpu.vramTotalMb} MB` : "—",
      };
    }),
  );
  return <GaugeCard icon={CircuitBoard} label="GPU" value={d.usage} sub={d.name} tone="info" extra={d.vram} />;
});

const MemGauge = memo(function MemGauge() {
  useRenderCount("MemGauge");
  const d = useTelemetryStore(
    useShallow((s) => {
      const mem = s.snapshot?.memory;
      return {
        usage: Math.round(mem?.usage ?? 0),
        used: mem ? `${(mem.usedBytes / 1024 ** 3).toFixed(1)} GB used` : "—",
      };
    }),
  );
  return <GaugeCard icon={MemoryStick} label="Memory" value={d.usage} sub="System RAM" tone="success" extra={d.used} />;
});

const LiveGauges = memo(function LiveGauges() {
  return (
    <>
      <CpuGauge />
      <GpuGauge />
      <MemGauge />
    </>
  );
});

/* --------------------------- Live telemetry chart ------------------------ */

/** Owns the history subscription. Refreshes at ≤1Hz and freezes while scrolled
 *  off-screen / mid-scroll, so the recharts SVG never repaints needlessly. */
const LiveTelemetryChart = memo(function LiveTelemetryChart() {
  useRenderCount("LiveTelemetryChart");
  const [ref, inView] = useInView<HTMLDivElement>();
  const hist = useChartHistory(inView);
  const series = useMemo(
    () => [
      { key: "cpu", label: "CPU %", color: "rgb(var(--color-accent))", data: hist.map((p) => p.cpuUsage) },
      { key: "gpu", label: "GPU %", color: "rgb(var(--color-iris))", data: hist.map((p) => p.gpuUsage) },
      { key: "temp", label: "CPU °C", color: "rgb(var(--color-danger))", data: hist.map((p) => p.cpuTemp) },
    ],
    [hist],
  );
  return (
    <div ref={ref}>
      <LiveLineChart series={series} />
    </div>
  );
});

/* ------------------------------ Per-core load ---------------------------- */

/** Owns the per-core subscription. Selecting the rounded ints means the meters
 *  re-render only when a core's integer load actually moves. */
const PerCoreLoad = memo(function PerCoreLoad() {
  useRenderCount("PerCoreLoad");
  const cores = useTelemetryStore(
    useShallow((s) => (s.snapshot?.cpu?.perCore ?? []).map((c) => Math.round(c))),
  );
  return (
    <>
      <SectionTitle title="Per-Core Load" description={`${cores.length} logical processors`} />
      <div className="max-h-[280px] space-y-sm overflow-y-auto pr-2xs scrollbar-none">
        {cores.length === 0 ? (
          <p className="py-lg text-center text-sm text-content-subtle">Awaiting telemetry…</p>
        ) : (
          cores.map((v, i) => (
            <div key={i} className="flex items-center gap-sm">
              <span className="w-12 text-2xs tabular-nums text-content-subtle">Core {i}</span>
              <Meter value={v} tone={meterTone(v)} className="flex-1" height={6} />
              <span className="w-9 text-right text-2xs tabular-nums text-content-muted">{v}%</span>
            </div>
          ))
        )}
      </div>
    </>
  );
});

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-xs text-content-muted">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
