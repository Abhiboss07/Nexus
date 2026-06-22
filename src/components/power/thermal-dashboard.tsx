import { memo } from "react";
import { motion } from "framer-motion";
import { useShallow } from "zustand/react/shallow";
import {
  Fan,
  Thermometer,
  Wind,
  Gauge,
  Cpu,
  CircuitBoard,
  Info,
  AlertTriangle,
  ShieldAlert,
  ScanSearch,
  Lock,
  Check,
} from "lucide-react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { RingGauge } from "@/components/ui/ring-gauge";
import { SectionTitle, StatRow } from "@/components/ui/section";
import { useThermal } from "@/hooks/use-thermal";
import { useTelemetryStore } from "@/store/telemetry-store";
import { useHistorySeries } from "@/hooks/use-telemetry";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";
import type { FanInfo, ThermalReport } from "@/lib/fan-types";
import { useRenderCount } from "@/components/dev/render-count";

const SEV: Record<string, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: "bg-info/12 text-info" },
  warning: { icon: AlertTriangle, cls: "bg-warning/12 text-warning" },
  critical: { icon: ShieldAlert, cls: "bg-danger/12 text-danger" },
};

/**
 * The shell subscribes only to `useThermal()` (a 4s poll), NOT the 1.5s
 * telemetry store — so the heavy driver-capability table, fan-profile chart and
 * recommendations re-render at most every 4s. Genuinely live readings (fan
 * gauges, key temps, the rolling history chart) live in self-subscribing leaves
 * that select *integer* values, so they update only when a shown number moves.
 */
export function ThermalDashboard() {
  useRenderCount("ThermalDashboard");
  const { fanInfo, thermal } = useThermal();

  const score = thermal?.score ?? 100;
  const scoreTone = score > 85 ? "success" : score > 65 ? "warning" : "danger";
  const curve = fanInfo?.curve ?? [];
  // Fan-profile operating point comes from the 4s poll (keeps this chart off the
  // fast tick); the live top row below carries the per-tick readings.
  const pollCpuC = thermal?.cpuC ?? null;
  const pollCpuRpm = thermal?.correlation?.cpuRpm ?? fanInfo?.cpuRpm ?? 0;

  return (
    <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="space-y-md">
      {/* Top row: fan gauges + thermal score + key temps (live) */}
      <ThermalLiveRow fanInfo={fanInfo} thermal={thermal} score={score} scoreTone={scoreTone} />

      {/* History + correlation */}
      <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <GlassCard padding="lg">
            <SectionTitle
              title="Thermal & Fan History"
              description="Temperature vs CPU fan RPM"
              action={
                <div className="flex gap-md text-xs">
                  <Legend color="rgb(var(--color-danger))" label="CPU °C" />
                  <Legend color="rgb(var(--color-iris))" label="GPU °C" />
                  <Legend color="rgb(var(--color-accent))" label="CPU RPM" />
                </div>
              }
            />
            <ThermalHistoryChart />
          </GlassCard>
        </motion.div>

        {/* Fan profile visualizer */}
        <motion.div variants={fadeUp}>
          <GlassCard padding="lg" className="h-full">
            <SectionTitle title="Fan Profile" description={fanInfo?.fanCurveEnabled ? "Custom curve active" : "Firmware auto curve"} action={<Badge variant="info"><Wind className="h-3 w-3" /> {fanInfo?.thermalProfile ?? "—"}</Badge>} />
            {curve.length >= 2 ? (
              <div className="h-44 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={curve} margin={{ top: 6, right: 8, bottom: 0, left: -24 }}>
                    <CartesianGrid stroke="rgb(var(--color-border) / 0.5)" strokeDasharray="3 6" />
                    <XAxis dataKey="tempC" type="number" domain={[30, 100]} tickLine={false} axisLine={false} unit="°" tick={{ fill: "rgb(var(--color-text-subtle))", fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={32} unit="%" tick={{ fill: "rgb(var(--color-text-subtle))", fontSize: 11 }} />
                    {pollCpuC != null && <ReferenceLine x={Math.round(pollCpuC)} stroke="rgb(var(--color-danger))" strokeDasharray="3 3" />}
                    <Line type="monotone" dataKey="pct" stroke="rgb(var(--color-accent))" strokeWidth={2.5} dot={{ r: 3, fill: "rgb(var(--color-accent))" }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="grid h-44 place-items-center text-center">
                <div>
                  <Fan className="mx-auto h-8 w-8 text-content-subtle" />
                  <p className="mt-sm text-sm text-content-muted">No custom curve set</p>
                  <p className="text-2xs text-content-subtle">Firmware controls fans automatically.<br />Custom curves arrive in Phase 3.4B.</p>
                </div>
              </div>
            )}
            <div className="mt-sm">
              <StatRow label="Operating point" value={`${pollCpuC?.toFixed(0) ?? "—"}°C @ ${pollCpuRpm} rpm`} />
              <StatRow label="Max boost" value={fanInfo?.maxFan ? "On" : "Off"} />
            </div>
          </GlassCard>
        </motion.div>
      </div>

      {/* Driver capability inspector + recommendations */}
      <div className="grid grid-cols-1 gap-md lg:grid-cols-2">
        <motion.div variants={fadeUp}>
          <GlassCard padding="lg" className="h-full">
            <SectionTitle
              title="Driver Capability Inspector"
              description={fanInfo?.capabilities.driver ?? "—"}
              action={
                <Badge variant={fanInfo?.capabilities.writable ? "success" : "warning"}>
                  {fanInfo?.capabilities.writable ? <Check className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                  {fanInfo?.capabilities.writable ? "Writable" : "Read-only"}
                </Badge>
              }
            />
            <div className="overflow-hidden rounded-lg border border-border-subtle">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-sunken/50 text-2xs uppercase tracking-wider text-content-subtle">
                    <th className="px-sm py-xs text-left font-medium">Attribute</th>
                    <th className="px-sm py-xs text-left font-medium">Value</th>
                    <th className="px-sm py-xs text-center font-medium">R</th>
                    <th className="px-sm py-xs text-center font-medium">W</th>
                  </tr>
                </thead>
                <tbody>
                  {(fanInfo?.attributes ?? []).map((a) => (
                    <tr key={a.name} className="border-b border-border-subtle last:border-0">
                      <td className="px-sm py-xs">
                        <span className="font-mono text-content">{a.name}</span>
                        <span className="block text-2xs text-content-subtle">{a.format}</span>
                      </td>
                      <td className="px-sm py-xs font-mono text-content-muted">{a.value}</td>
                      <td className="px-sm py-xs text-center">{a.present ? <Check className="mx-auto h-3.5 w-3.5 text-success" /> : "—"}</td>
                      <td className="px-sm py-xs text-center">{a.writable ? <Check className="mx-auto h-3.5 w-3.5 text-success" /> : <Lock className="mx-auto h-3 w-3 text-content-subtle" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!fanInfo?.capabilities.writable && (
              <p className="mt-sm flex items-center gap-xs text-2xs text-content-subtle">
                <ScanSearch className="h-3 w-3" /> {fanInfo?.capabilities.permissionNote}
              </p>
            )}
          </GlassCard>
        </motion.div>

        <motion.div variants={fadeUp}>
          <GlassCard padding="lg" className="h-full">
            <SectionTitle title="Thermal Recommendations" action={<Badge variant="accent"><Gauge className="h-3 w-3" /> {thermal?.grade ?? "—"}</Badge>} />
            <div className="space-y-sm">
              {(thermal?.recommendations ?? []).map((r, i) => {
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
      </div>
    </motion.div>
  );
}

/* ------------------------------ Live top row ----------------------------- */

/**
 * Self-subscribes to the per-tick fan RPM / temperatures (as rounded integers),
 * so this row updates only when a displayed reading changes. The thermal score &
 * grade come from the 4s poll via props.
 */
const ThermalLiveRow = memo(function ThermalLiveRow({
  fanInfo,
  thermal,
  score,
  scoreTone,
}: {
  fanInfo: FanInfo | null;
  thermal: ThermalReport | null;
  score: number;
  scoreTone: "success" | "warning" | "danger";
}) {
  useRenderCount("ThermalLiveRow");
  const live = useTelemetryStore(
    useShallow((s) => ({
      cpuRpm: s.snapshot?.fans?.find((f) => f.label === "CPU Fan")?.rpm ?? null,
      gpuRpm: s.snapshot?.fans?.find((f) => f.label === "GPU Fan")?.rpm ?? null,
      cpuC: s.snapshot?.thermals?.cpuC != null ? Math.round(s.snapshot.thermals.cpuC) : null,
      gpuC: s.snapshot?.thermals?.gpuC != null ? Math.round(s.snapshot.thermals.gpuC) : null,
    })),
  );

  const cpuRpm = live.cpuRpm ?? fanInfo?.cpuRpm ?? 0;
  const gpuRpm = live.gpuRpm ?? fanInfo?.gpuRpm ?? 0;
  const cpuC = live.cpuC ?? thermal?.cpuC ?? null;
  const gpuC = live.gpuC ?? thermal?.gpuC ?? null;

  return (
    <div className="grid grid-cols-1 gap-md lg:grid-cols-4">
      <motion.div variants={fadeUp}>
        <FanCard label="CPU Fan" rpm={cpuRpm} temp={cpuC} icon={Cpu} />
      </motion.div>
      <motion.div variants={fadeUp}>
        <FanCard label="GPU Fan" rpm={gpuRpm} temp={gpuC} icon={CircuitBoard} />
      </motion.div>
      <motion.div variants={fadeUp}>
        <GlassCard padding="lg" className="flex h-full items-center gap-md">
          <RingGauge value={score} size={92} tone={scoreTone} label={`${score}`} />
          <div>
            <p className="flex items-center gap-xs text-sm font-semibold text-content">
              <Thermometer className="h-4 w-4 text-accent" /> Thermal
            </p>
            <p className="mt-2xs text-xs capitalize text-content-muted">{thermal?.grade ?? "—"}</p>
            <p className="mt-md text-2xs uppercase tracking-wider text-content-subtle">Health Score</p>
          </div>
        </GlassCard>
      </motion.div>
      <motion.div variants={fadeUp}>
        <GlassCard padding="lg" className="h-full">
          <p className="text-2xs uppercase tracking-wider text-content-subtle">Key Temps</p>
          <StatRow label="CPU" value={`${cpuC?.toFixed(0) ?? "—"}°C`} tone={(cpuC ?? 0) > 82 ? "warning" : "success"} />
          <StatRow label="GPU" value={`${gpuC?.toFixed(0) ?? "—"}°C`} tone={(gpuC ?? 0) > 80 ? "warning" : "success"} />
          <StatRow label="SSD" value={`${thermal?.ssdC?.toFixed(0) ?? "—"}°C`} tone="success" />
        </GlassCard>
      </motion.div>
    </div>
  );
});

/* ---------------------------- History chart ------------------------------ */

const ThermalHistoryChart = memo(function ThermalHistoryChart() {
  useRenderCount("ThermalHistoryChart");
  const cpuT = useHistorySeries("cpuTemp");
  const gpuT = useHistorySeries("gpuTemp");
  const cpuRpm = useHistorySeries("cpuFanRpm");
  const trend = cpuT.slice(-60).map((_, i, arr) => {
    const idx = cpuT.length - arr.length + i;
    return { i, cpuT: Math.round(cpuT[idx]), gpuT: Math.round(gpuT[idx]), cpuRpm: cpuRpm[idx] };
  });

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={trend} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
          <CartesianGrid vertical={false} stroke="rgb(var(--color-border) / 0.5)" strokeDasharray="3 6" />
          <XAxis dataKey="i" hide />
          <YAxis yAxisId="temp" domain={[20, 100]} tickLine={false} axisLine={false} width={40} tick={{ fill: "rgb(var(--color-text-subtle))", fontSize: 11 }} />
          <YAxis yAxisId="rpm" orientation="right" domain={[0, 6000]} tickLine={false} axisLine={false} width={44} tick={{ fill: "rgb(var(--color-text-subtle))", fontSize: 11 }} />
          <Tooltip isAnimationActive={false} labelFormatter={() => ""} contentStyle={{ background: "rgb(var(--color-surface-raised))", border: "1px solid rgb(var(--color-border))", borderRadius: 12, fontSize: 12, color: "rgb(var(--color-text))" }} />
          <Line yAxisId="temp" type="monotone" dataKey="cpuT" name="CPU °C" stroke="rgb(var(--color-danger))" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line yAxisId="temp" type="monotone" dataKey="gpuT" name="GPU °C" stroke="rgb(var(--color-iris))" strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line yAxisId="rpm" type="monotone" dataKey="cpuRpm" name="CPU RPM" stroke="rgb(var(--color-accent))" strokeWidth={2} strokeDasharray="4 3" dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});

function FanCard({ label, rpm, temp, icon: Icon }: { label: string; rpm: number; temp: number | null; icon: typeof Cpu }) {
  const pct = Math.min(100, (rpm / 6000) * 100);
  return (
    <GlassCard padding="lg" interactive className="flex h-full items-center gap-md">
      <RingGauge value={pct} size={92} tone="info" label={`${rpm}`} sublabel="rpm" />
      <div>
        <p className="flex items-center gap-xs text-sm font-semibold text-content">
          <Icon className="h-4 w-4 text-accent" /> {label}
        </p>
        <p className="mt-2xs text-xs text-content-muted">{temp != null ? `${temp.toFixed(0)}°C` : "—"}</p>
        <p className="mt-md flex items-center gap-xs text-2xs uppercase tracking-wider text-content-subtle">
          <Fan className="h-3 w-3" /> Live
        </p>
      </div>
    </GlassCard>
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
