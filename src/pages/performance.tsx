import { motion } from "framer-motion";
import { Cpu, CircuitBoard, MemoryStick, Thermometer } from "lucide-react";
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
import { useCpu, useGpu, useMemory, useHistory } from "@/hooks/use-telemetry";

export default function PerformancePage() {
  const cpu = useCpu();
  const gpu = useGpu();
  const mem = useMemory();
  const history = useHistory();

  const cpuUsage = Math.round(cpu?.usage ?? 0);
  const gpuUsage = Math.round(gpu?.usage ?? 0);
  const memUsage = Math.round(mem?.usage ?? 0);
  const cores = cpu?.perCore ?? [];

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
          {[
            { icon: Cpu, label: "CPU", value: cpuUsage, sub: cpu?.model ?? "Processor", tone: "accent" as const, extra: `${((cpu?.frequencyMhz ?? 0) / 1000).toFixed(2)} GHz` },
            { icon: CircuitBoard, label: "GPU", value: gpuUsage, sub: gpu?.name ?? "No GPU", tone: "info" as const, extra: gpu ? `${gpu.vramUsedMb} / ${gpu.vramTotalMb} MB` : "—" },
            { icon: MemoryStick, label: "Memory", value: memUsage, sub: "System RAM", tone: "success" as const, extra: mem ? `${(mem.usedBytes / 1024 ** 3).toFixed(1)} GB used` : "—" },
          ].map((g) => (
            <GlassCard key={g.label} interactive padding="lg" className="flex items-center gap-lg">
              <RingGauge value={g.value} tone={g.tone} size={104} label={`${g.value}%`} />
              <div className="min-w-0">
                <p className="flex items-center gap-xs text-sm font-semibold text-content">
                  <g.icon className="h-4 w-4 text-accent" /> {g.label}
                </p>
                <p className="mt-2xs truncate text-xs text-content-muted">{g.sub}</p>
                <p className="mt-md text-2xs uppercase tracking-wider text-content-subtle">{g.extra}</p>
              </div>
            </GlassCard>
          ))}
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
              <LiveLineChart
                series={[
                  { key: "cpu", label: "CPU %", color: "rgb(var(--color-accent))", data: history.map((p) => p.cpuUsage) },
                  { key: "gpu", label: "GPU %", color: "rgb(var(--color-iris))", data: history.map((p) => p.gpuUsage) },
                  { key: "temp", label: "CPU °C", color: "rgb(var(--color-danger))", data: history.map((p) => p.cpuTemp) },
                ]}
              />
            </GlassCard>
          </motion.div>

          <motion.div variants={fadeUp}>
            <GlassCard padding="lg" className="h-full">
              <SectionTitle title="Per-Core Load" description={`${cores.length} logical processors`} />
              <div className="max-h-[280px] space-y-sm overflow-y-auto pr-2xs scrollbar-none">
                {cores.length === 0 ? (
                  <p className="py-lg text-center text-sm text-content-subtle">Awaiting telemetry…</p>
                ) : (
                  cores.map((c, i) => {
                    const v = Math.round(c);
                    return (
                      <div key={i} className="flex items-center gap-sm">
                        <span className="w-12 text-2xs tabular-nums text-content-subtle">Core {i}</span>
                        <Meter value={v} tone={meterTone(v)} className="flex-1" height={6} />
                        <span className="w-9 text-right text-2xs tabular-nums text-content-muted">{v}%</span>
                      </div>
                    );
                  })
                )}
              </div>
            </GlassCard>
          </motion.div>
        </div>

        {/* GPU intelligence */}
        <div className="mt-lg mb-md flex items-center gap-sm">
          <CircuitBoard className="h-4 w-4 text-accent" />
          <h2 className="font-display text-lg font-semibold text-content">GPU Intelligence</h2>
        </div>
        <GpuIntelligence />

        {/* Thermal intelligence dashboard */}
        <div className="mt-lg mb-md flex items-center gap-sm">
          <Thermometer className="h-4 w-4 text-accent" />
          <h2 className="font-display text-lg font-semibold text-content">Thermal Intelligence</h2>
          <Badge variant="neutral" size="sm">read-only · validated</Badge>
        </div>
        <ThermalDashboard />

        {/* Fan control — real writes (Victus-S), capability-gated */}
        <div className="mt-md">
          <FanControl />
        </div>
      </motion.div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-xs text-content-muted">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} />
      {label}
    </span>
  );
}
