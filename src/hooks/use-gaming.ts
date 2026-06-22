import { useCallback, useEffect, useState } from "react";
import {
  isTauri,
  gamingTrends,
  gamingSessionAnalytics,
  gamingFpsAnalysis,
  gamingSessionSeries,
} from "@/lib/ipc";
import type { SessionAnalytics, FpsAnalysis, TrendReport } from "@/lib/gaming-types";
import type { TelemetryHistoryRow } from "@/lib/telemetry-history-types";

/**
 * React access to the Gaming Intelligence services. All analysis (limiters,
 * trends, 1% lows) is computed in the Rust layer over the persistent telemetry
 * store; these hooks only fetch and cache the verdicts.
 */

function demoTrends(): TrendReport {
  return {
    currentSessionId: 3,
    baselineSessions: 4,
    trends: [
      { metric: "cpuTempMax", label: "Peak CPU temp", current: 84, baseline: 91, deltaPct: -7.7, direction: "down", verdict: "improved", higherIsBetter: false },
      { metric: "gpuTempMax", label: "Peak GPU temp", current: 71, baseline: 74, deltaPct: -4.1, direction: "down", verdict: "stable", higherIsBetter: false },
      { metric: "throttlePct", label: "Throttling", current: 0, baseline: 6, deltaPct: -100, direction: "down", verdict: "improved", higherIsBetter: false },
      { metric: "cpuUsageAvg", label: "Avg CPU load", current: 38, baseline: 34, deltaPct: 11.8, direction: "up", verdict: "regressed", higherIsBetter: false },
      { metric: "powerAvgW", label: "Avg power draw", current: 62, baseline: 65, deltaPct: -4.6, direction: "down", verdict: "stable", higherIsBetter: false },
    ],
    summary: "2 improved, 1 regressed vs your recent average.",
  };
}

function demoAnalytics(id: number): SessionAnalytics {
  return {
    sessionId: id,
    startedAt: Date.now() - 2 * 3_600_000,
    endedAt: null,
    durationMs: 2 * 3_600_000,
    samples: 1440,
    cpuUsageAvg: 38,
    cpuUsageMax: 92,
    gpuUsageAvg: 41,
    gpuUsageMax: 99,
    memUsageAvg: 58,
    memUsageMax: 74,
    cpuTempAvg: 62,
    cpuTempMax: 84,
    gpuTempAvg: 56,
    gpuTempMax: 71,
    powerAvgW: 62,
    fpsSamples: 0,
    fpsAvg: 0,
    fpsMin: 0,
    fpsMax: 0,
    fpsLow1pct: 0,
    throttlePct: 0,
  };
}

function demoFps(id: number): FpsAnalysis {
  return {
    sessionId: id,
    hasFps: false,
    fpsAvg: 0,
    fpsMin: 0,
    fpsLow1pct: 0,
    primary: {
      kind: "gpu",
      confidence: 78,
      title: "GPU-bound",
      detail: "GPU averaged 91% — the graphics card is the ceiling (normal when maxing visuals).",
      recommendation: "Lower resolution/quality or enable upscaling (DLSS/FSR) for more frames.",
    },
    factors: [
      { kind: "gpu", confidence: 78, title: "GPU-bound", detail: "GPU averaged 91% — the graphics card is the ceiling.", recommendation: "Lower resolution/quality or enable upscaling (DLSS/FSR)." },
    ],
    summary: "Main limiter: gpu-bound. Install MangoHud to record FPS for frame-level analysis.",
  };
}

export function useGamingTrends() {
  const [report, setReport] = useState<TrendReport | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    if (!isTauri()) {
      setReport(demoTrends());
      setLoading(false);
      return;
    }
    gamingTrends(10)
      .then((r) => !cancelled && setReport(r))
      .catch(() => !cancelled && setReport(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);
  return { report, loading };
}

export interface SessionAnalysis {
  analytics: SessionAnalytics | null;
  fps: FpsAnalysis | null;
  series: TelemetryHistoryRow[];
  loading: boolean;
}

export function useSessionAnalysis(sessionId: number | null): SessionAnalysis {
  const [state, setState] = useState<SessionAnalysis>({
    analytics: null,
    fps: null,
    series: [],
    loading: false,
  });

  const load = useCallback((id: number) => {
    setState((s) => ({ ...s, loading: true }));
    if (!isTauri()) {
      setState({ analytics: demoAnalytics(id), fps: demoFps(id), series: [], loading: false });
      return;
    }
    Promise.allSettled([
      gamingSessionAnalytics(id),
      gamingFpsAnalysis(id),
      gamingSessionSeries(id, 400),
    ]).then(([a, f, s]) => {
      setState({
        analytics: a.status === "fulfilled" ? a.value : null,
        fps: f.status === "fulfilled" ? f.value : null,
        series: s.status === "fulfilled" ? s.value : [],
        loading: false,
      });
    });
  }, []);

  useEffect(() => {
    if (sessionId == null) {
      setState({ analytics: null, fps: null, series: [], loading: false });
      return;
    }
    load(sessionId);
  }, [sessionId, load]);

  return state;
}
