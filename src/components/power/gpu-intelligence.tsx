import { motion } from "framer-motion";
import {
  CircuitBoard,
  Cpu,
  Thermometer,
  Activity,
  Zap,
  HardDrive,
  Check,
  Lock,
  Info,
  AlertTriangle,
  ShieldAlert,
  Gauge,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { RingGauge } from "@/components/ui/ring-gauge";
import { Meter } from "@/components/ui/progress";
import { SectionTitle, StatRow } from "@/components/ui/section";
import { useGpu } from "@/hooks/use-gpu";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

const SEV: Record<string, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: "bg-info/12 text-info" },
  warning: { icon: AlertTriangle, cls: "bg-warning/12 text-warning" },
  critical: { icon: ShieldAlert, cls: "bg-danger/12 text-danger" },
};

const BOTTLENECK_LABEL: Record<string, string> = {
  gpu: "GPU-bound", cpu: "CPU-bound", vram: "VRAM-bound", balanced: "Balanced",
};

export function GpuIntelligence() {
  const { info, intel, caps } = useGpu();

  if (!info || !info.present) {
    return (
      <GlassCard padding="lg" className="flex items-center gap-md">
        <CircuitBoard className="h-8 w-8 text-content-subtle" />
        <div>
          <p className="text-sm font-semibold text-content">No discrete GPU detected</p>
          <p className="text-xs text-content-muted">GPU intelligence is unavailable.</p>
        </div>
      </GlassCard>
    );
  }

  const vram = (info.vramUsedMb / Math.max(1, info.vramTotalMb)) * 100;

  return (
    <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="space-y-md">
      {/* Scores */}
      <motion.div variants={fadeUp} className="grid grid-cols-2 gap-md lg:grid-cols-4">
        <ScoreCard icon={Activity} label="Health" value={intel?.healthScore ?? 0} tone="success" />
        <ScoreCard icon={Thermometer} label="Thermal" value={intel?.thermalScore ?? 0} tone={(intel?.thermalScore ?? 100) > 70 ? "success" : "warning"} />
        <ScoreCard icon={Zap} label="Efficiency" value={intel?.efficiencyScore ?? 0} tone="info" />
        <ScoreCard icon={Gauge} label="Gaming Ready" value={intel?.gamingReadiness ?? 0} tone="accent" />
      </motion.div>

      <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
        {/* GPU details */}
        <motion.div variants={fadeUp} className="lg:col-span-2">
          <GlassCard padding="lg">
            <SectionTitle
              title={info.name.replace("NVIDIA GeForce ", "")}
              description={`Driver ${info.driverVersion} · CUDA ${info.cudaVersion} · VBIOS ${info.vbiosVersion}`}
              action={<Badge variant="accent">{BOTTLENECK_LABEL[intel?.bottleneck ?? "balanced"]}</Badge>}
            />
            <div className="grid grid-cols-2 gap-x-lg sm:grid-cols-3">
              <StatRow label="Utilization" value={`${info.utilization}%`} />
              <StatRow label="Temp" value={`${info.temperatureC?.toFixed(0) ?? "—"}°C`} tone={(info.temperatureC ?? 0) > 82 ? "warning" : "success"} />
              {/* Three DISTINCT power figures — never conflate current draw with TGP. */}
              <StatRow label="Current Draw" value={`${info.powerDrawW?.toFixed(0) ?? "—"} W`} />
              <StatRow label="Max TGP" value={`${(info.powerMaxW ?? info.powerDefaultW)?.toFixed(0) ?? "—"} W`} />
              <StatRow label="Power Limit" value={info.powerLimitW != null ? `${info.powerLimitW.toFixed(0)} W` : "Dynamic Boost"} />
              <StatRow label="Core Clock" value={`${info.clockGraphicsMhz ?? "—"} MHz`} />
              <StatRow label="Mem Clock" value={`${info.clockMemoryMhz ?? "—"} MHz`} />
              <StatRow label="Mem Speed" value={`${info.memEffectiveGbps?.toFixed(0) ?? "—"} Gbps`} />
              <StatRow label="PCIe" value={`Gen ${info.pcieGenCurrent ?? "—"} ×${info.pcieWidthCurrent ?? "—"}`} />
              <StatRow label="P-State" value={info.pstate} />
            </div>
            <div className="mt-md">
              <div className="mb-xs flex items-center justify-between text-xs">
                <span className="flex items-center gap-xs text-content-muted"><HardDrive className="h-3.5 w-3.5" /> VRAM</span>
                <span className="font-medium text-content">{(info.vramUsedMb / 1024).toFixed(1)} / {(info.vramTotalMb / 1024).toFixed(1)} GB · {vram.toFixed(0)}%</span>
              </div>
              <Meter value={vram} tone={vram > 90 ? "danger" : vram > 75 ? "warning" : "accent"} />
            </div>
          </GlassCard>
        </motion.div>

        {/* Capability matrix */}
        <motion.div variants={fadeUp}>
          <GlassCard padding="lg" className="h-full">
            <SectionTitle title="GPU Capabilities" description="Discovered — no assumptions" />
            <div className="space-y-2xs">
              <CapRow label="Power limit / TGP control" ok={caps?.powerLimitControl} />
              <CapRow label="Dynamic Boost" ok={caps?.dynamicBoost} />
              <CapRow label="Runtime D3 (RTD3)" ok={caps?.rtd3} />
              <CapRow label="PRIME offload" ok={caps?.primeOffload} />
              <CapRow label="MUX switching" ok={caps?.muxSwitching} />
              <CapRow label="Advanced Optimus" ok={caps?.advancedOptimus} />
              <CapRow label="NVML" ok={caps?.hasNvml} />
            </div>
            {caps?.notes && <p className="mt-sm text-2xs text-content-subtle">{caps.notes}</p>}
          </GlassCard>
        </motion.div>
      </div>

      {/* Recommendations */}
      {intel && intel.recommendations.length > 0 && (
        <motion.div variants={fadeUp}>
          <GlassCard padding="lg">
            <SectionTitle title="GPU Recommendations" />
            <div className="space-y-sm">
              {intel.recommendations.map((r, i) => {
                const sev = SEV[r.severity] ?? SEV.info;
                return (
                  <div key={i} className="flex items-start gap-md rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
                    <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md", sev.cls)}><sev.icon className="h-4 w-4" /></div>
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
      )}
    </motion.div>
  );
}

function ScoreCard({ icon: Icon, label, value, tone }: { icon: typeof Cpu; label: string; value: number; tone: "success" | "warning" | "info" | "accent" }) {
  return (
    <GlassCard padding="md" interactive className="flex items-center gap-md">
      <RingGauge value={value} size={76} tone={tone} label={`${value}`} />
      <div>
        <p className="flex items-center gap-xs text-sm font-semibold text-content"><Icon className="h-4 w-4 text-accent" /> {label}</p>
        <p className="mt-2xs text-2xs uppercase tracking-wider text-content-subtle">Score</p>
      </div>
    </GlassCard>
  );
}

function CapRow({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-xs last:border-0">
      <span className="text-sm text-content-muted">{label}</span>
      {ok ? (
        <span className="flex items-center gap-xs text-2xs font-medium text-success"><Check className="h-3.5 w-3.5" /> Yes</span>
      ) : (
        <span className="flex items-center gap-xs text-2xs font-medium text-content-subtle"><Lock className="h-3 w-3" /> No</span>
      )}
    </div>
  );
}
