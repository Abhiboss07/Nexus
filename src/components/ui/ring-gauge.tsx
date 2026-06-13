import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

interface RingGaugeProps {
  /** 0–100 */
  value: number;
  size?: number;
  thickness?: number;
  label?: string;
  sublabel?: string;
  tone?: "accent" | "success" | "warning" | "danger" | "info";
  className?: string;
}

const toneStops: Record<NonNullable<RingGaugeProps["tone"]>, [string, string]> = {
  accent: ["rgb(var(--color-accent))", "rgb(var(--color-iris))"],
  success: ["rgb(var(--color-success))", "rgb(var(--color-iris))"],
  warning: ["rgb(var(--color-warning))", "rgb(var(--color-accent))"],
  danger: ["rgb(var(--color-danger))", "rgb(var(--color-accent))"],
  info: ["rgb(var(--color-info))", "rgb(var(--color-iris))"],
};

/** Animated circular progress ring with a brand gradient stroke. */
export function RingGauge({
  value,
  size = 120,
  thickness = 10,
  label,
  sublabel,
  tone = "accent",
  className,
}: RingGaugeProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const gradientId = `ring-${tone}`;
  const [from, to] = toneStops[tone];

  return (
    <div
      className={cn("relative grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgb(var(--color-border) / 0.6)"
          strokeWidth={thickness}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        {label && (
          <span className="font-display text-2xl font-semibold tabular-nums text-content">
            {label}
          </span>
        )}
        {sublabel && (
          <span className="mt-6 translate-y-5 text-2xs uppercase tracking-wider text-content-subtle">
            {sublabel}
          </span>
        )}
      </div>
    </div>
  );
}
