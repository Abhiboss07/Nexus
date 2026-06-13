import { Activity, Cpu } from "lucide-react";
import { GlassTooltip } from "@/components/ui/tooltip";
import { StatusDot } from "@/components/ui/badge";
import {
  useTelemetrySource,
  useHardwareProfile,
} from "@/hooks/use-telemetry";
import { cn } from "@/lib/cn";

/** Compact pill showing whether telemetry is live (IPC) or demo, + the device. */
export function TelemetryBadge() {
  const source = useTelemetrySource();
  const profile = useHardwareProfile();

  const tone =
    source === "live" ? "success" : source === "demo" ? "warning" : "info";
  const label =
    source === "live" ? "Live" : source === "demo" ? "Demo" : "Connecting";

  return (
    <GlassTooltip
      side="bottom"
      label={
        <div className="space-y-[2px]">
          <p className="font-semibold text-content">
            {profile?.vendorLabel ?? "Detecting hardware…"}
          </p>
          <p className="text-2xs text-content-muted">
            {profile ? `${profile.cpuModel}` : "—"}
          </p>
          <p className="text-2xs text-content-muted">
            {source === "live"
              ? "Streaming real system telemetry"
              : source === "demo"
                ? "Simulated data (not running under Tauri)"
                : "Establishing telemetry stream"}
          </p>
        </div>
      }
    >
      <div
        className={cn(
          "no-drag flex h-8 items-center gap-xs rounded-full border border-border bg-surface-sunken/60 px-sm",
        )}
      >
        <StatusDot tone={tone} pulse={source !== "live"} />
        <span className="text-2xs font-semibold uppercase tracking-wider text-content-muted">
          {label}
        </span>
        {profile && (
          <span className="hidden items-center gap-1 border-l border-border pl-xs text-2xs text-content-subtle sm:flex">
            <Cpu className="h-3 w-3" /> {profile.vendorLabel}
          </span>
        )}
        {!profile && <Activity className="h-3 w-3 text-content-subtle" />}
      </div>
    </GlassTooltip>
  );
}
