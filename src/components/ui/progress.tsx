import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

type Tone = "accent" | "success" | "warning" | "danger" | "info";

const toneBg: Record<Tone, string> = {
  accent: "bg-brand-gradient",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

/** Animated linear meter. Tone can be auto-derived from thresholds. */
export function Meter({
  value,
  tone = "accent",
  className,
  height = 8,
}: {
  value: number;
  tone?: Tone;
  className?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn("w-full overflow-hidden rounded-full bg-surface-raised", className)}
      style={{ height }}
    >
      <motion.div
        className={cn("h-full rounded-full", toneBg[tone])}
        initial={{ width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

/** Multi-segment stacked bar (e.g. storage by category). */
export function SegmentBar({
  segments,
  height = 14,
  className,
}: {
  segments: { value: number; color: string; label?: string }[];
  height?: number;
  className?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  return (
    <div
      className={cn("flex w-full overflow-hidden rounded-full bg-surface-raised", className)}
      style={{ height }}
    >
      {segments.map((s, i) => (
        <motion.div
          key={i}
          initial={{ width: 0 }}
          animate={{ width: `${(s.value / total) * 100}%` }}
          transition={{ duration: 0.7, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
          style={{ background: s.color }}
          className="h-full first:rounded-l-full last:rounded-r-full"
          title={s.label}
        />
      ))}
    </div>
  );
}

export function meterTone(value: number, invert = false): Tone {
  const v = invert ? 100 - value : value;
  if (v >= 85) return "danger";
  if (v >= 65) return "warning";
  return "success";
}
