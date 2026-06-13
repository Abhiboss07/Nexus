import { type LucideIcon, TrendingDown, TrendingUp } from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { Sparkline } from "@/components/ui/sparkline";
import { cn } from "@/lib/cn";

export interface MetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  unit?: string;
  trend?: number; // signed % delta
  series?: number[];
  tone?: "accent" | "success" | "warning" | "danger" | "info";
  footer?: string;
}

const iconTint: Record<NonNullable<MetricCardProps["tone"]>, string> = {
  accent: "text-accent bg-accent/12",
  success: "text-success bg-success/12",
  warning: "text-warning bg-warning/12",
  danger: "text-danger bg-danger/12",
  info: "text-info bg-info/12",
};

/** The workhorse telemetry card: icon, big value, trend, sparkline. */
export function MetricCard({
  icon: Icon,
  label,
  value,
  unit,
  trend,
  series,
  tone = "accent",
  footer,
}: MetricCardProps) {
  const trendUp = (trend ?? 0) >= 0;
  return (
    <GlassCard interactive glow padding="lg" className="flex flex-col gap-md">
      <div className="flex items-start justify-between">
        <div className={cn("grid h-10 w-10 place-items-center rounded-md", iconTint[tone])}>
          <Icon className="h-5 w-5" strokeWidth={2} />
        </div>
        {trend !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-2xs rounded-full px-xs py-[3px] text-2xs font-semibold",
              trendUp ? "bg-success/12 text-success" : "bg-danger/12 text-danger",
            )}
          >
            {trendUp ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            {Math.abs(trend)}%
          </span>
        )}
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-content-subtle">
          {label}
        </p>
        <p className="mt-2xs flex items-baseline gap-2xs font-display">
          <span className="text-3xl font-semibold tabular-nums text-content">
            {value}
          </span>
          {unit && <span className="text-sm text-content-muted">{unit}</span>}
        </p>
      </div>

      {series && <Sparkline data={series} tone={tone} />}
      {footer && <p className="text-xs text-content-subtle">{footer}</p>}
    </GlassCard>
  );
}
