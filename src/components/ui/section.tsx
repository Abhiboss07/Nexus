import { cn } from "@/lib/cn";

/** Lightweight section title used to structure dense module pages. */
export function SectionTitle({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-md flex items-end justify-between gap-md", className)}>
      <div>
        <h3 className="text-base font-semibold text-content">{title}</h3>
        {description && (
          <p className="mt-[2px] text-xs text-content-muted">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

/** Key/value stat row. */
export function StatRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-content";
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-xs last:border-0">
      <span className="text-sm text-content-muted">{label}</span>
      <span className={cn("text-sm font-medium tabular-nums", toneClass)}>
        {value}
      </span>
    </div>
  );
}
