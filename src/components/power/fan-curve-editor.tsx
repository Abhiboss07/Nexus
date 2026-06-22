import { memo, useEffect, useRef, useState } from "react";
import type { CurvePoint } from "@/lib/fan-types";
import { cn } from "@/lib/cn";

const TMIN = 30;
const TMAX = 100;
const W = 1000;
const H = 520;
const PAD = { l: 44, r: 16, t: 16, b: 34 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

const tempToX = (t: number) => PAD.l + ((t - TMIN) / (TMAX - TMIN)) * PLOT_W;
const pctToY = (p: number) => PAD.t + (1 - p / 100) * PLOT_H;

/** Client-side safety checks mirroring the Rust `validate_curve_safe`. */
export function curveWarnings(points: CurvePoint[]): string[] {
  const w: string[] = [];
  const s = [...points].sort((a, b) => a.tempC - b.tempC);
  if (s.some((p, i) => i > 0 && p.pct < s[i - 1].pct))
    w.push("Fan speed must not decrease as temperature rises.");
  const top = s[s.length - 1];
  if (top && top.pct < 50) w.push("Highest point should command ≥50% for safety.");
  if (s.some((p) => p.tempC >= 90 && p.pct < 70)) w.push("At ≥90°C the fan must be ≥70%.");
  if (s.some((p) => p.tempC >= 85 && p.pct < 50)) w.push("At ≥85°C the fan must be ≥50%.");
  return w;
}

/** Interpolated fan % at a given temperature (for the live/simulated marker). */
export function curvePctAt(points: CurvePoint[], temp: number): number {
  const s = [...points].sort((a, b) => a.tempC - b.tempC);
  if (!s.length) return 0;
  if (temp <= s[0].tempC) return s[0].pct;
  if (temp >= s[s.length - 1].tempC) return s[s.length - 1].pct;
  for (let i = 1; i < s.length; i++) {
    if (temp <= s[i].tempC) {
      const a = s[i - 1];
      const b = s[i];
      const f = (temp - a.tempC) / (b.tempC - a.tempC || 1);
      return Math.round(a.pct + f * (b.pct - a.pct));
    }
  }
  return s[s.length - 1].pct;
}

/**
 * Memoized so it redraws ONLY when its data changes (points / live temp /
 * enabled state) — not on every unrelated FanControl re-render. The parent must
 * pass a stable `onChange` (useCallback) for the memo to hold.
 */
export const FanCurveEditor = memo(function FanCurveEditor({
  points,
  onChange,
  currentTemp,
  maxPoints = 8,
  disabled = false,
}: {
  points: CurvePoint[];
  onChange: (p: CurvePoint[]) => void;
  currentTemp?: number | null;
  maxPoints?: number;
  disabled?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);

  const sorted = [...points].sort((a, b) => a.tempC - b.tempC);

  function toData(clientX: number, clientY: number) {
    const rect = svgRef.current!.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * W;
    const vy = ((clientY - rect.top) / rect.height) * H;
    const temp = Math.round(TMIN + ((vx - PAD.l) / PLOT_W) * (TMAX - TMIN));
    const pct = Math.round((1 - (vy - PAD.t) / PLOT_H) * 100);
    return { temp: clamp(temp, TMIN, TMAX), pct: clamp(pct, 0, 100) };
  }

  // Drag with window listeners for smoothness.
  useEffect(() => {
    if (drag === null) return;
    function move(e: PointerEvent) {
      const { temp, pct } = toData(e.clientX, e.clientY);
      onChange(
        points.map((p, i) => {
          if (i !== drag) return p;
          // Keep temps from crossing neighbors.
          const others = points.filter((_, j) => j !== i).map((x) => x.tempC);
          const lower = Math.max(TMIN, ...others.filter((t) => t < p.tempC).map((t) => t + 2), TMIN);
          const upper = Math.min(TMAX, ...others.filter((t) => t > p.tempC).map((t) => t - 2), TMAX);
          return { tempC: clamp(temp, lower, upper), pct };
        }),
      );
    }
    function up() {
      setDrag(null);
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, points]);

  function addPoint(e: React.PointerEvent) {
    if (disabled || points.length >= maxPoints) return;
    const { temp, pct } = toData(e.clientX, e.clientY);
    if (points.some((p) => Math.abs(p.tempC - temp) < 3)) return;
    onChange([...points, { tempC: temp, pct }].sort((a, b) => a.tempC - b.tempC));
  }

  function removePoint(idx: number) {
    if (disabled || points.length <= 2) return;
    onChange(points.filter((_, i) => i !== idx));
  }

  const linePath = sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${tempToX(p.tempC)} ${pctToY(p.pct)}`).join(" ");
  const areaPath = `${linePath} L ${tempToX(sorted[sorted.length - 1]?.tempC ?? TMAX)} ${pctToY(0)} L ${tempToX(sorted[0]?.tempC ?? TMIN)} ${pctToY(0)} Z`;

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${W} ${H}`}
      className={cn("w-full select-none touch-none", disabled && "opacity-50")}
      style={{ aspectRatio: `${W} / ${H}` }}
      onPointerDown={addPoint}
    >
      {/* Grid */}
      {[0, 25, 50, 75, 100].map((p) => (
        <g key={`h${p}`}>
          <line x1={PAD.l} y1={pctToY(p)} x2={W - PAD.r} y2={pctToY(p)} stroke="rgb(var(--color-border) / 0.5)" strokeDasharray="4 6" />
          <text x={PAD.l - 8} y={pctToY(p) + 4} fontSize={20} textAnchor="end" fill="rgb(var(--color-text-subtle))">{p}</text>
        </g>
      ))}
      {[30, 50, 70, 85, 100].map((t) => (
        <g key={`v${t}`}>
          <line x1={tempToX(t)} y1={PAD.t} x2={tempToX(t)} y2={H - PAD.b} stroke="rgb(var(--color-border) / 0.3)" />
          <text x={tempToX(t)} y={H - 8} fontSize={20} textAnchor="middle" fill="rgb(var(--color-text-subtle))">{t}°</text>
        </g>
      ))}

      {/* Safety danger zone: ≥85°C must be ≥50% → shade the unsafe corner. */}
      <rect x={tempToX(85)} y={pctToY(50)} width={tempToX(TMAX) - tempToX(85)} height={pctToY(0) - pctToY(50)} fill="rgb(var(--color-danger) / 0.08)" />
      <text x={tempToX(92)} y={pctToY(25)} fontSize={18} textAnchor="middle" fill="rgb(var(--color-danger) / 0.6)">unsafe</text>

      {/* Curve fill + line */}
      {sorted.length >= 2 && (
        <>
          <defs>
            <linearGradient id="fanArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgb(var(--color-accent))" stopOpacity={0.28} />
              <stop offset="100%" stopColor="rgb(var(--color-accent))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#fanArea)" />
          <path d={linePath} fill="none" stroke="rgb(var(--color-accent))" strokeWidth={3} strokeLinejoin="round" />
        </>
      )}

      {/* Live / current temperature marker */}
      {currentTemp != null && currentTemp >= TMIN && currentTemp <= TMAX && (
        <g>
          <line x1={tempToX(currentTemp)} y1={PAD.t} x2={tempToX(currentTemp)} y2={H - PAD.b} stroke="rgb(var(--color-danger))" strokeWidth={2} strokeDasharray="3 4" />
          <circle cx={tempToX(currentTemp)} cy={pctToY(curvePctAt(points, currentTemp))} r={7} fill="rgb(var(--color-danger))" />
        </g>
      )}

      {/* Draggable points */}
      {points.map((p, i) => (
        <g key={i}>
          <circle
            cx={tempToX(p.tempC)}
            cy={pctToY(p.pct)}
            r={drag === i ? 14 : 10}
            fill="rgb(var(--color-surface-raised))"
            stroke="rgb(var(--color-accent))"
            strokeWidth={3}
            className={cn(!disabled && "cursor-grab", drag === i && "cursor-grabbing")}
            onPointerDown={(e) => {
              if (disabled) return;
              e.stopPropagation();
              setDrag(i);
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              removePoint(i);
            }}
          />
          <text x={tempToX(p.tempC)} y={pctToY(p.pct) - 18} fontSize={18} textAnchor="middle" fill="rgb(var(--color-text-muted))" pointerEvents="none">
            {p.tempC}°/{p.pct}%
          </text>
        </g>
      ))}
    </svg>
  );
});

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
