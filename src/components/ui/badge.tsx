import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-2xs rounded-full font-medium leading-none",
  {
    variants: {
      variant: {
        neutral: "bg-surface-raised text-content-muted",
        accent: "bg-accent/15 text-accent-strong",
        success: "bg-success/15 text-success",
        warning: "bg-warning/15 text-warning",
        danger: "bg-danger/15 text-danger",
        info: "bg-info/15 text-info",
        outline: "border border-border text-content-muted",
      },
      size: {
        sm: "px-2xs py-[2px] text-2xs",
        md: "px-xs py-[3px] text-xs",
      },
    },
    defaultVariants: { variant: "neutral", size: "sm" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, size, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant, size }), className)} {...props} />
  );
}

/** Small pulsing status dot. */
export function StatusDot({
  tone = "success",
  pulse = true,
  className,
}: {
  tone?: "success" | "warning" | "danger" | "info" | "accent";
  pulse?: boolean;
  className?: string;
}) {
  const toneMap = {
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
    info: "bg-info",
    accent: "bg-accent",
  } as const;
  return (
    <span className={cn("relative flex h-2 w-2", className)}>
      {pulse && (
        <span
          className={cn(
            "absolute inline-flex h-full w-full animate-ping rounded-full opacity-60",
            toneMap[tone],
          )}
        />
      )}
      <span className={cn("relative inline-flex h-2 w-2 rounded-full", toneMap[tone])} />
    </span>
  );
}
