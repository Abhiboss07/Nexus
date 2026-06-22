import { useEffect, useRef, useState } from "react";
import { useTelemetryStore } from "@/store/telemetry-store";
import type { HistoryPoint } from "@/lib/telemetry-types";

/**
 * IntersectionObserver-backed visibility flag. Heavy chart sections use it to
 * stop doing work while scrolled off-screen. Defaults to visible so SSR / no-IO
 * environments still render.
 */
export function useInView<T extends Element>(
  rootMargin = "200px",
): [React.MutableRefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
      rootMargin,
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [rootMargin]);
  return [ref, inView];
}

/**
 * Live telemetry history batched to ≤1Hz for chart rendering. Telemetry is still
 * stored at full rate in the zustand store; this just samples it once a second
 * so a fast poll cadence can't thrash the (expensive) recharts SVGs. Updates are
 * skipped while the chart is off-screen (`active=false`) or the window is hidden.
 * (No scroll coupling — that caused visible flicker; scrolling is left untouched.)
 */
export function useChartHistory(active = true): HistoryPoint[] {
  const [hist, setHist] = useState<HistoryPoint[]>(() => useTelemetryStore.getState().history);
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.hidden) return;
      // setState with the same array reference is a no-op (React bails), so a
      // poll cadence slower than 1Hz costs nothing.
      setHist(useTelemetryStore.getState().history);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return hist;
}
