import { useEffect, useRef, useState } from "react";
import { useThemeStore } from "@/store/theme-store";

/**
 * Rolling time-series that ticks on an interval — drives "live" telemetry in
 * the Phase 1.5 surfaces. Respects the user's reduced-motion preference by
 * holding still. In Phase 2 the tick is replaced by a Tauri event subscription.
 */
export function useLiveSeries(
  next: (prev: number) => number,
  opts: { length?: number; intervalMs?: number; seed?: number } = {},
) {
  const { length = 40, intervalMs = 1500, seed = 40 } = opts;
  const reduced = useThemeStore((s) => s.reducedMotion);
  const [series, setSeries] = useState<number[]>(() =>
    Array.from({ length }, () => seed),
  );
  const nextRef = useRef(next);
  nextRef.current = next;

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setSeries((prev) => {
        const v = Math.max(0, Math.min(100, nextRef.current(prev[prev.length - 1])));
        return [...prev.slice(1), v];
      });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs, reduced]);

  return series;
}

/** Single live scalar that drifts within bounds. */
export function useLiveValue(
  base: number,
  amplitude = 8,
  intervalMs = 1500,
): number {
  const reduced = useThemeStore((s) => s.reducedMotion);
  const [v, setV] = useState(base);
  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setV((p) => {
        const drift = (Math.random() - 0.5) * amplitude;
        return Math.max(0, Math.min(100, Math.round((p + drift + base) / 2)));
      });
    }, intervalMs);
    return () => window.clearInterval(id);
  }, [base, amplitude, intervalMs, reduced]);
  return v;
}
