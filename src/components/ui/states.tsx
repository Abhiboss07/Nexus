import { motion } from "framer-motion";
import { type LucideIcon, AlertTriangle, RotateCw, Inbox } from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { scaleIn } from "@/lib/motion";
import { cn } from "@/lib/cn";

/** Empty state — no data yet, with optional primary action. */
export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.div
      variants={scaleIn}
      initial="hidden"
      animate="show"
      className={cn(
        "grid place-items-center rounded-xl border border-dashed border-border px-lg py-2xl text-center",
        className,
      )}
    >
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-surface-raised text-content-muted">
        <Icon className="h-6 w-6" />
      </div>
      <p className="mt-md text-base font-semibold text-content">{title}</p>
      {description && (
        <p className="mt-2xs max-w-sm text-sm text-content-muted">{description}</p>
      )}
      {action && <div className="mt-md">{action}</div>}
    </motion.div>
  );
}

/** Error state with retry. */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this data. Please try again.",
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <GlassCard
      padding="lg"
      className={cn("grid place-items-center py-2xl text-center", className)}
    >
      <div className="grid h-14 w-14 place-items-center rounded-2xl bg-danger/12 text-danger">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <p className="mt-md text-base font-semibold text-content">{title}</p>
      <p className="mt-2xs max-w-sm text-sm text-content-muted">{description}</p>
      {onRetry && (
        <Button variant="solid" size="md" className="mt-md" onClick={onRetry}>
          <RotateCw className="h-4 w-4" /> Retry
        </Button>
      )}
    </GlassCard>
  );
}

/** Generic card-grid loading skeleton. */
export function LoadingState({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-md", className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-md">
          <Skeleton className="h-12 w-12 rounded-md" />
          <div className="flex-1 space-y-xs">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-8 w-16 rounded-md" />
        </div>
      ))}
    </div>
  );
}
