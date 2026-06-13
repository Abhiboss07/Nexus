import { type LucideIcon, ChevronRight } from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { cn } from "@/lib/cn";

export interface ActionCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  tone?: "accent" | "success" | "warning" | "danger" | "info";
  onClick?: () => void;
}

const tint: Record<NonNullable<ActionCardProps["tone"]>, string> = {
  accent: "text-accent bg-accent/12 group-hover:bg-accent/20",
  success: "text-success bg-success/12 group-hover:bg-success/20",
  warning: "text-warning bg-warning/12 group-hover:bg-warning/20",
  danger: "text-danger bg-danger/12 group-hover:bg-danger/20",
  info: "text-info bg-info/12 group-hover:bg-info/20",
};

/** A call-to-action surface — used for quick fixes, launches, primary tasks. */
export function ActionCard({
  icon: Icon,
  title,
  description,
  tone = "accent",
  onClick,
}: ActionCardProps) {
  return (
    <GlassCard
      interactive
      padding="md"
      onClick={onClick}
      className="group flex items-center gap-md"
    >
      <div
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-md transition-colors",
          tint[tone],
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-content">{title}</p>
        <p className="truncate text-xs text-content-muted">{description}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-content-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-content" />
    </GlassCard>
  );
}

/** Quick-launch tile — square, icon-forward (Game Center / profiles). */
export function QuickLaunchCard({
  icon: Icon,
  title,
  subtitle,
  tone = "accent",
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  tone?: NonNullable<ActionCardProps["tone"]>;
  onClick?: () => void;
}) {
  return (
    <GlassCard
      interactive
      glow
      padding="md"
      onClick={onClick}
      className="group flex aspect-square flex-col justify-between"
    >
      <div className={cn("grid h-11 w-11 place-items-center rounded-md", tint[tone])}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-sm font-semibold text-content">{title}</p>
        {subtitle && <p className="text-xs text-content-subtle">{subtitle}</p>}
      </div>
    </GlassCard>
  );
}
