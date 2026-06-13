import { useId } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

interface SegmentedProps<T extends string> {
  options: { value: T; label: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  className?: string;
}

/** Compact pill segmented control with a sliding active indicator. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  className,
}: SegmentedProps<T>) {
  const id = useId();
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-surface-sunken/60 p-2xs",
        className,
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative inline-flex items-center gap-xs rounded-md font-medium outline-none transition-colors",
              size === "sm" ? "h-7 px-sm text-xs" : "h-8 px-md text-sm",
              active ? "text-content" : "text-content-muted hover:text-content",
            )}
          >
            {active && (
              <motion.span
                layoutId={`${id}-seg`}
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
                className="absolute inset-0 rounded-md bg-surface-raised shadow-e1 ring-1 ring-inset ring-border"
              />
            )}
            <span className="relative z-10 flex items-center gap-xs">
              {opt.icon}
              {opt.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
