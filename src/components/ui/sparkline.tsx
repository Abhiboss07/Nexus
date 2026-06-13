import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

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

/** Compact filled area trend chart for metric cards. */
export function Sparkline({ data, tone = "accent", height = 48 }: SparklineProps) {
  const chartData = data.map((v, i) => ({ i, v }));
  const color = toneColor[tone];
  const id = `spark-${tone}`;

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 4, bottom: 0, left: 0, right: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={["dataMin - 4", "dataMax + 4"]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${id})`}
            isAnimationActive
            animationDuration={700}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
