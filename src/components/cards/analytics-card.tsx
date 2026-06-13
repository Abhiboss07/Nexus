import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";

export interface AnalyticsPoint {
  t: string;
  a: number;
  b?: number;
}

export interface AnalyticsCardProps {
  title: string;
  subtitle?: string;
  data: AnalyticsPoint[];
  seriesA: string;
  seriesB?: string;
}

/** Larger multi-series analytics surface for trend exploration. */
export function AnalyticsCard({
  title,
  subtitle,
  data,
  seriesA,
  seriesB,
}: AnalyticsCardProps) {
  return (
    <GlassCard padding="lg" className="flex flex-col gap-md">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-base font-semibold text-content">{title}</h3>
          {subtitle && <p className="text-xs text-content-muted">{subtitle}</p>}
        </div>
        <div className="flex gap-xs">
          <Badge variant="accent">{seriesA}</Badge>
          {seriesB && <Badge variant="info">{seriesB}</Badge>}
        </div>
      </div>

      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -16 }}>
            <defs>
              <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(var(--color-accent))" stopOpacity={0.35} />
                <stop offset="100%" stopColor="rgb(var(--color-accent))" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="rgb(var(--color-iris))" stopOpacity={0.3} />
                <stop offset="100%" stopColor="rgb(var(--color-iris))" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid
              vertical={false}
              stroke="rgb(var(--color-border) / 0.5)"
              strokeDasharray="3 6"
            />
            <XAxis
              dataKey="t"
              tickLine={false}
              axisLine={false}
              tick={{ fill: "rgb(var(--color-text-subtle))", fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fill: "rgb(var(--color-text-subtle))", fontSize: 11 }}
            />
            <Tooltip
              cursor={{ stroke: "rgb(var(--color-accent) / 0.4)" }}
              contentStyle={{
                background: "rgb(var(--color-surface-raised))",
                border: "1px solid rgb(var(--color-border))",
                borderRadius: 12,
                fontSize: 12,
                color: "rgb(var(--color-text))",
                boxShadow: "var(--elevation-3)",
              }}
            />
            {seriesB && (
              <Area
                type="monotone"
                dataKey="b"
                name={seriesB}
                stroke="rgb(var(--color-iris))"
                strokeWidth={2}
                fill="url(#gb)"
              />
            )}
            <Area
              type="monotone"
              dataKey="a"
              name={seriesA}
              stroke="rgb(var(--color-accent))"
              strokeWidth={2.5}
              fill="url(#ga)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}
