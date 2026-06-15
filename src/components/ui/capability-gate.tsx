import { Lock, CheckCircle2 } from "lucide-react";
import type { CapabilityStatus } from "@/lib/capability-types";
import { GlassTooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";

/**
 * Gates a block of controls on a capability. When the capability isn't
 * controllable it dims + disables the children (pointer-events off) and shows a
 * lock with the reason. The UI passes only a `CapabilityStatus` — it never
 * knows which vendor/driver is involved.
 */
export function CapabilityGate({
  status,
  children,
  className,
}: {
  status: CapabilityStatus | null | undefined;
  children: React.ReactNode;
  className?: string;
}) {
  const controllable = status?.controllable ?? false;

  if (controllable) return <div className={className}>{children}</div>;

  const reason = status?.notes || "Not available on this device";

  return (
    <GlassTooltip side="top" label={reason}>
      <div className={cn("relative", className)}>
        <div className="pointer-events-none select-none opacity-40 saturate-50" aria-disabled>
          {children}
        </div>
        <div className="absolute right-2 top-2 z-10 flex items-center gap-xs rounded-full border border-border bg-surface-raised/90 px-xs py-[2px] text-2xs font-medium text-content-muted backdrop-blur">
          <Lock className="h-3 w-3" />
          Unavailable
        </div>
      </div>
    </GlassTooltip>
  );
}

/** Small inline badge naming the driver backing a live, controllable capability. */
export function CapabilityBadge({ status }: { status: CapabilityStatus | null | undefined }) {
  if (!status) return null;
  if (status.controllable) {
    return (
      <GlassTooltip side="top" label={`Controlled via ${status.driver || "the system driver"}`}>
        <span className="inline-flex items-center gap-xs rounded-full bg-success/12 px-xs py-[2px] text-2xs font-medium text-success">
          <CheckCircle2 className="h-3 w-3" /> {status.driver || "ready"}
        </span>
      </GlassTooltip>
    );
  }
  // Surface WHY it isn't controllable so testers don't read it as a bug.
  const reason =
    status.notes ||
    (status.available
      ? "Detected but not controllable on this system."
      : "Not available on this system.");
  return (
    <GlassTooltip side="top" label={reason}>
      <span className="inline-flex items-center gap-xs rounded-full bg-surface-raised px-xs py-[2px] text-2xs font-medium text-content-subtle">
        <Lock className="h-3 w-3" /> {status.available ? "read-only" : "unavailable"}
      </span>
    </GlassTooltip>
  );
}
