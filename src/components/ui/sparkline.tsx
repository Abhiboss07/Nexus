import { useId } from "react";

interface SparklineProps {
  data: number[];
  tone?: "accent" | "success" | "warning" | "danger" | "info";
  height?: number;
}

const toneColor: Record<NonNullable<SparklineProps["tone"]>, string> = {
  accent: "rgb(var(--color-accent))",
  success: "rgb(var(--color-success))",
  warning: "rgb(var(--color-warning))",
  danger: "rgb(var(--color-danger))",
  info: "rgb(var(--color-info))",
};

/**
 * Compact filled-area trend for metric cards — a dependency-free SVG (was
 * recharts). A sparkline never needs recharts' axes/layout machinery, and
 * dropping it keeps the 400KB+ charts chunk off the dashboard's load path.
 */
export function Sparkline({ data, tone = "accent", height = 48 }: SparklineProps) {
  const color = toneColor[tone];
  const gid = useId(); // unique per instance (recharts version reused ids by tone)
  const n = data.length;

  if (n === 0) return <div style={{ height }} className="w-full" />;

  // Auto-scale with the same padding recharts used (dataMin-4 … dataMax+4).
  const min = Math.min(...data) - 4;
  const max = Math.max(...data) + 4;
  const span = max - min || 1;

  const pts = data.map((v, i) => {
    const x = n <= 1 ? 0 : (i / (n - 1)) * 100;
    const y = 100 - ((v - min) / span) * 100;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const line = `M${pts.join(" L")}`;
  const area = `${line} L100,100 L0,100 Z`;

  return (
    <div style={{ height }} className="w-full">
      <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} stroke="none" />
        <path
          d={line}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
