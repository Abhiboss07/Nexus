/** TS mirror of src-tauri/src/telemetry/store.rs — the persistent telemetry store. */

/** A session (one app run) with rolled-up summary stats. */
export interface TelemetrySession {
  id: number;
  /** ms epoch */
  startedAt: number;
  /** ms epoch, null while the session is still active. */
  endedAt: number | null;
  /** endedAt − startedAt (or now − startedAt while active), ms. */
  durationMs: number;
  samples: number;
  cpuUsageAvg: number;
  cpuTempAvg: number;
  cpuTempMax: number;
  gpuUsageAvg: number;
  gpuTempAvg: number;
  gpuTempMax: number;
  /** Avg / peak FPS (0 until a frame-rate source records it). */
  fpsAvg: number;
  fpsMax: number;
  appVersion: string;
}

/** One persisted time-series point. `resolution` is "raw" or "hourly". */
export interface TelemetryHistoryRow {
  /** ms epoch */
  ts: number;
  cpuUsage: number;
  cpuTemp: number;
  cpuTempMax: number;
  gpuUsage: number;
  gpuTemp: number;
  gpuTempMax: number;
  memUsage: number;
  /** Frame rate (avg for hourly rows); 0 until a frame-rate source records it. */
  fps: number;
  fpsMax: number;
  resolution: "raw" | "hourly";
}

/** Store-wide totals. */
export interface TelemetryStoreStats {
  sessions: number;
  samples: number;
  firstSampleTs: number | null;
  lastSampleTs: number | null;
  /** Sum of session durations, ms. */
  trackedMs: number;
  cpuTempPeak: number;
  gpuTempPeak: number;
  fpsPeak: number;
  dbBytes: number;
}
