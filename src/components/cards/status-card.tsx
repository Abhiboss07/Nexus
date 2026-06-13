import { type LucideIcon } from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { StatusDot } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

export interface StatusCardProps {
  icon: LucideIcon;
  title: string;
  status: string;
  tone?: "success" | "warning" | "danger" | "info" | "accent";
  detail?: string;
}

/** Compact health/status indicator card. */
export function StatusCard({
  icon: Icon,
  title,
  status,
  tone = "success",
  detail,
}: StatusCardProps) {
  return (
    <GlassCard interactive padding="md" className="flex items-center gap-md">
      <div className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-surface-raised">
        <Icon className="h-5 w-5 text-content-muted" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-content">{title}</p>
        <p className="flex items-center gap-xs text-xs text-content-muted">
          <StatusDot tone={tone} pulse={tone !== "success"} />
          {status}
        </p>
      </div>
      {detail && (
        <span className={cn("text-xs font-medium tabular-nums text-content-subtle")}>
          {detail}
        </span>
      )}
    </GlassCard>
  );
}
