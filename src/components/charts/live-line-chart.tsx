import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  YAxis,
  CartesianGrid,
} from "recharts";

export interface LiveSeries {
  key: string;
  label: string;
  color: string;
  data: number[];
}

/** Multi-line live chart. Each series is an array; index aligns the x-axis. */
export function LiveLineChart({
  series,
  height = 220,
  domain = [0, 100],
}: {
  series: LiveSeries[];
  height?: number;
  domain?: [number, number];
}) {
  const length = Math.max(...series.map((s) => s.data.length), 0);
  const rows = Array.from({ length }, (_, i) => {
    const row: Record<string, number> = { i };
    for (const s of series) row[s.key] = s.data[i] ?? 0;
    return row;
  });

  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 6, right: 6, bottom: 0, left: -22 }}>
          <CartesianGrid
            vertical={false}
            stroke="rgb(var(--color-border) / 0.5)"
            strokeDasharray="3 6"
          />
          <YAxis
            domain={domain}
            tickLine={false}
            axisLine={false}
            width={40}
            tick={{ fill: "rgb(var(--color-text-subtle))", fontSize: 11 }}
          />
          <Tooltip
            isAnimationActive={false}
            contentStyle={{
              background: "rgb(var(--color-surface-raised))",
              border: "1px solid rgb(var(--color-border))",
              borderRadius: 12,
              fontSize: 12,
              color: "rgb(var(--color-text))",
              boxShadow: "var(--elevation-3)",
            }}
            labelFormatter={() => ""}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
