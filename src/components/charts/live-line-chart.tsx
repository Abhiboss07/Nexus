import { memo, useMemo, useRef, useState } from "react";

export interface LiveSeries {
  key: string;
  label: string;
  color: string;
  data: number[];
}

/**
 * Multi-line live chart — a dependency-free SVG. Previously recharts, which on a
 * 1.5s-updating chart paid a ResizeObserver + full SVG reconciliation on every
 * tick; this draws plain `<polyline>`s with `non-scaling-stroke` so each tick is
 * cheap. Same props/visual (y-ticks, dashed grid, hover tooltip). Index aligns
 * the x-axis; values are clamped to `domain`.
 */
export const LiveLineChart = memo(function LiveLineChart({
  series,
  height = 220,
  domain = [0, 100],
}: {
  series: LiveSeries[];
  height?: number;
  domain?: [number, number];
}) {
  const [min, max] = domain;
  const span = max - min || 1;
  const length = Math.max(...series.map((s) => s.data.length), 0);
  const TICKS = 4;

  const lines = useMemo(
    () =>
      series.map((s) => {
        const n = s.data.length;
        const pts = s.data
          .map((v, i) => {
            const x = n <= 1 ? 0 : (i / (n - 1)) * 100;
            const clamped = Math.max(min, Math.min(max, v));
            const y = 100 - ((clamped - min) / span) * 100;
            return `${x.toFixed(2)},${y.toFixed(2)}`;
          })
          .join(" ");
        return { key: s.key, color: s.color, pts };
      }),
    [series, min, max, span],
  );

  const tickVals = Array.from({ length: TICKS + 1 }, (_, k) => max - (span * k) / TICKS);

  const areaRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; idx: number } | null>(null);
  const onMove = (e: React.MouseEvent) => {
    const el = areaRef.current;
    if (!el || length <= 1) return;
    const r = el.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setHover({ x: frac * 100, idx: Math.round(frac * (length - 1)) });
  };

  const tipLeft = hover ? (hover.x > 60 ? `calc(${hover.x}% - 8px)` : `calc(${hover.x}% + 8px)`) : "0";
  const tipShift = hover && hover.x > 60 ? "translateX(-100%)" : "none";

  return (
    <div style={{ height }} className="flex w-full text-2xs" onMouseLeave={() => setHover(null)}>
      <div className="flex w-9 shrink-0 flex-col justify-between py-1 pr-1 text-right tabular-nums text-content-subtle">
        {tickVals.map((t, i) => (
          <span key={i}>{Math.round(t)}</span>
        ))}
      </div>

      <div ref={areaRef} className="relative flex-1" onMouseMove={onMove}>
        <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" className="overflow-visible">
          {tickVals.map((_, i) => {
            const y = (i / TICKS) * 100;
            return (
              <line
                key={i}
                x1="0"
                y1={y}
                x2="100"
                y2={y}
                stroke="rgb(var(--color-border) / 0.5)"
                strokeWidth="1"
                strokeDasharray="3 6"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {hover && (
            <line x1={hover.x} y1="0" x2={hover.x} y2="100" stroke="rgb(var(--color-border))" strokeWidth="1" vectorEffect="non-scaling-stroke" />
          )}
          {lines.map((l) => (
            <polyline
              key={l.key}
              points={l.pts}
              fill="none"
              stroke={l.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute top-1 z-10 space-y-2xs rounded-lg border border-border bg-surface-raised px-sm py-xs"
            style={{ left: tipLeft, transform: tipShift, boxShadow: "var(--elevation-3)" }}
          >
            {series.map((s) => (
              <div key={s.key} className="flex items-center gap-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                <span className="text-content-muted">{s.label}</span>
                <span className="ml-auto tabular-nums text-content">{Math.round(s.data[hover.idx] ?? 0)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
