import { useState } from "react";
import { motion } from "framer-motion";
import {
  HardDrive,
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { Meter } from "@/components/ui/progress";
import { RouteFallback } from "@/components/shell/route-fallback";
import { EmptyState } from "@/components/ui/states";
import { useStorage, useTelemetrySource } from "@/hooks/use-telemetry";
import { stagger, fadeUp } from "@/lib/motion";
import { formatBytes, formatRate } from "@/lib/format";
import { cn } from "@/lib/cn";

export default function StoragePage() {
  const disks = useStorage();
  const source = useTelemetrySource();
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);

  if (source === "connecting" && disks.length === 0) return <RouteFallback />;
  if (disks.length === 0) {
    return (
      <div>
        <PageHeader title="Storage Center" description="Drives, usage & SMART health." />
        <EmptyState icon={HardDrive} title="No drives reporting" description="Storage telemetry is unavailable on this device." />
      </div>
    );
  }

  const drive = disks.find((d) => d.device === selectedDevice) ?? disks[0];

  return (
    <div>
      <PageHeader
        title="Storage Center"
        description="Live capacity, throughput and drive health."
      />

      {/* Drive selector — live */}
      <div className="mb-lg flex flex-wrap gap-md">
        {disks.map((d) => (
          <button
            key={d.device}
            onClick={() => setSelectedDevice(d.device)}
            className={cn(
              "flex min-w-[260px] flex-1 items-center gap-md rounded-xl border p-md text-left transition-all",
              drive.device === d.device ? "border-accent/50 bg-accent/8 shadow-glow" : "border-border hover:border-border-strong",
            )}
          >
            <div className="grid h-12 w-12 place-items-center rounded-lg bg-surface-raised">
              <HardDrive className={cn("h-6 w-6", drive.device === d.device ? "text-accent-strong" : "text-content-muted")} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="flex items-center justify-between text-sm font-semibold text-content">
                {d.mountPoint} <span className="text-xs text-content-muted">{d.usage.toFixed(0)}%</span>
              </p>
              <p className="truncate text-2xs text-content-subtle">{d.device} · {d.filesystem}</p>
              <Meter value={d.usage} tone={d.usage > 85 ? "danger" : d.usage > 65 ? "warning" : "accent"} className="mt-xs" height={5} />
            </div>
          </button>
        ))}
      </div>

      <motion.div variants={stagger(0.05)} initial="hidden" animate="show">
        {/* Capacity overview — live */}
        <motion.div variants={fadeUp}>
          <GlassCard padding="lg">
            <div className="mb-md flex flex-wrap items-end justify-between gap-md">
              <div>
                <p className="font-display text-3xl font-semibold text-content">
                  {formatBytes(drive.usedBytes, 0)}
                  <span className="text-base font-normal text-content-muted"> of {formatBytes(drive.totalBytes, 0)} used</span>
                </p>
                <p className="text-sm text-content-muted">{formatBytes(drive.totalBytes - drive.usedBytes, 0)} free on {drive.mountPoint}</p>
              </div>
              <div className="flex items-center gap-md">
                <Badge variant={drive.smartStatus === "passed" ? "success" : drive.smartStatus === "failing" ? "danger" : "neutral"}>
                  <Activity className="h-3 w-3" /> SMART {drive.smartStatus}
                </Badge>
                {drive.temperatureC != null && <Badge variant="info">{drive.temperatureC.toFixed(0)}°C</Badge>}
              </div>
            </div>

            <Meter value={drive.usage} tone={drive.usage > 85 ? "danger" : drive.usage > 65 ? "warning" : "accent"} height={18} />

            {/* Live I/O */}
            <div className="mt-md grid grid-cols-2 gap-md sm:max-w-md">
              <div className="flex items-center gap-sm rounded-lg bg-surface-sunken/50 p-md">
                <ArrowDownToLine className="h-5 w-5 text-info" />
                <div>
                  <p className="text-2xs uppercase tracking-wider text-content-subtle">Read</p>
                  <p className="font-display text-lg font-semibold text-content">{formatRate(drive.readBytesSec)}</p>
                </div>
              </div>
              <div className="flex items-center gap-sm rounded-lg bg-surface-sunken/50 p-md">
                <ArrowUpFromLine className="h-5 w-5 text-accent" />
                <div>
                  <p className="text-2xs uppercase tracking-wider text-content-subtle">Write</p>
                  <p className="font-display text-lg font-semibold text-content">{formatRate(drive.writeBytesSec)}</p>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* Mounted volumes — live */}
        <motion.div variants={fadeUp} className="mt-md">
          <GlassCard padding="lg">
            <h3 className="mb-md text-base font-semibold text-content">Mounted Volumes</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-2xs uppercase tracking-wider text-content-subtle">
                    <th className="py-xs text-left font-medium">Device</th>
                    <th className="py-xs text-left font-medium">Mount</th>
                    <th className="py-xs text-left font-medium">FS</th>
                    <th className="py-xs text-right font-medium">Used</th>
                    <th className="py-xs text-right font-medium">Size</th>
                    <th className="py-xs text-right font-medium">Temp</th>
                    <th className="py-xs text-right font-medium">SMART</th>
                  </tr>
                </thead>
                <tbody>
                  {disks.map((d) => (
                    <tr key={d.device} className="border-b border-border-subtle last:border-0">
                      <td className="py-xs font-medium text-content">{d.device}</td>
                      <td className="py-xs text-content-muted">{d.mountPoint}</td>
                      <td className="py-xs text-content-subtle">{d.filesystem}</td>
                      <td className="py-xs text-right tabular-nums text-content">{d.usage.toFixed(0)}%</td>
                      <td className="py-xs text-right tabular-nums text-content-muted">{formatBytes(d.totalBytes, 0)}</td>
                      <td className="py-xs text-right tabular-nums text-content-muted">{d.temperatureC != null ? `${d.temperatureC.toFixed(0)}°C` : "—"}</td>
                      <td className="py-xs text-right">
                        <Badge size="sm" variant={d.smartStatus === "passed" ? "success" : d.smartStatus === "failing" ? "danger" : "neutral"}>{d.smartStatus}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </motion.div>
      </motion.div>
    </div>
  );
}
