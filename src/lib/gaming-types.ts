/** TS mirror of src-tauri/src/gaming.rs + SessionAnalytics from store.rs. */

export interface SessionAnalytics {
  sessionId: number;
  startedAt: number;
  endedAt: number | null;
  durationMs: number;
  samples: number;
  cpuUsageAvg: number;
  cpuUsageMax: number;
  gpuUsageAvg: number;
  gpuUsageMax: number;
  memUsageAvg: number;
  memUsageMax: number;
  cpuTempAvg: number;
  cpuTempMax: number;
  gpuTempAvg: number;
  gpuTempMax: number;
  powerAvgW: number;
  fpsSamples: number;
  fpsAvg: number;
  fpsMin: number;
  fpsMax: number;
  fpsLow1pct: number;
  throttlePct: number;
}

export type LimiterKind = "cpu" | "gpu" | "thermal" | "memory";

export interface Limiter {
  kind: LimiterKind;
  confidence: number;
  title: string;
  detail: string;
  recommendation: string;
}

export interface FpsAnalysis {
  sessionId: number;
  hasFps: boolean;
  fpsAvg: number;
  fpsMin: number;
  fpsLow1pct: number;
  primary: Limiter | null;
  factors: Limiter[];
  summary: string;
}

export interface MetricTrend {
  metric: string;
  label: string;
  current: number;
  baseline: number;
  deltaPct: number;
  direction: "up" | "down" | "flat";
  verdict: "improved" | "regressed" | "stable";
  higherIsBetter: boolean;
}

export interface TrendReport {
  currentSessionId: number | null;
  baselineSessions: number;
  trends: MetricTrend[];
  summary: string;
}
