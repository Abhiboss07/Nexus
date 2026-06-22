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

/**
 * Animated circular progress ring with a brand-gradient stroke.
 *
 * The label/sublabel are drawn as SVG `<text>` with `dominant-baseline="central"`
 * + `text-anchor="middle"`, which centers the glyphs on the geometric center of
 * the circle independent of font metrics — so the value stays perfectly centered
 * for 1, 2 or 3 digits, with or without a sublabel, at any size. (The old HTML
 * overlay centered the label+sublabel *as a group*, which pushed the number
 * visibly upward whenever a sublabel was present.)
 *
 * This is the ONE radial gauge in the app; every score/percent ring renders
 * through it, so centering can never drift between screens.
 */
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
  const center = size / 2;
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clamped / 100) * circumference;
  const gradientId = `ring-${tone}`;
  const [from, to] = toneStops[tone];

  // Value font scales with the gauge and shrinks for long strings so 3–4 chars
  // (e.g. "100%", "2200") always fit inside the ring.
  const labelLen = (label ?? "").length;
  const baseValueFs = Math.min(36, Math.max(16, size * 0.28));
  const valueFs = labelLen > 3 ? baseValueFs * (3.2 / labelLen) : baseValueFs;
  const subFs = Math.min(13, Math.max(8.5, size * 0.105));
  // Value sits dead-center; sublabel floats just below without shifting it.
  const subY = center + valueFs * 0.62 + subFs * 0.5;

  return (
    <div
      className={cn("relative grid place-items-center", className)}
      style={{ width: size, height: size }}
    >
      {/* Ring arc (rotated so the stroke starts at 12 o'clock). */}
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="rgb(var(--color-border) / 0.6)"
          strokeWidth={thickness}
        />
        <motion.circle
          cx={center}
          cy={center}
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

      {/* Centered value + sublabel (upright SVG, not rotated). */}
      <svg width={size} height={size} className="absolute inset-0">
        {label && (
          <text
            x={center}
            y={center}
            textAnchor="middle"
            dominantBaseline="central"
            className="font-display font-semibold tabular-nums"
            style={{ fontSize: valueFs, fill: "rgb(var(--color-text))" }}
          >
            {label}
          </text>
        )}
        {sublabel && (
          <text
            x={center}
            y={subY}
            textAnchor="middle"
            dominantBaseline="central"
            className="uppercase"
            style={{
              fontSize: subFs,
              letterSpacing: "0.06em",
              fill: "rgb(var(--color-text-subtle))",
            }}
          >
            {sublabel}
          </text>
        )}
      </svg>
    </div>
  );
}
