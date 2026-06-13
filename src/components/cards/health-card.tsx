import { GlassCard } from "@/components/ui/glass";
import { RingGauge } from "@/components/ui/ring-gauge";

export interface HealthCardProps {
  title: string;
  value: number; // 0-100
  centerLabel: string;
  sublabel?: string;
  tone?: "accent" | "success" | "warning" | "danger" | "info";
  stats?: { label: string; value: string }[];
}

/** Radial health card pairing a ring gauge with supporting stats. */
export function HealthCard({
  title,
  value,
  centerLabel,
  sublabel,
  tone = "success",
  stats,
}: HealthCardProps) {
  return (
    <GlassCard interactive padding="lg" className="flex flex-col gap-md">
      <p className="text-xs font-medium uppercase tracking-wider text-content-subtle">
        {title}
      </p>
      <div className="flex items-center gap-lg">
        <RingGauge
          value={value}
          size={108}
          label={centerLabel}
          sublabel={sublabel}
          tone={tone}
        />
        {stats && (
          <div className="flex-1 space-y-sm">
            {stats.map((s) => (
              <div key={s.label} className="flex items-center justify-between">
                <span className="text-xs text-content-muted">{s.label}</span>
                <span className="text-sm font-medium tabular-nums text-content">
                  {s.value}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
