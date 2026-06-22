import { useCallback, useEffect, useState } from "react";
import { isTauri, telemetrySessions, telemetryStats } from "@/lib/ipc";
import type {
  TelemetrySession,
  TelemetryStoreStats,
} from "@/lib/telemetry-history-types";

/**
 * Reads the *persistent* telemetry store (SQLite-backed sessions + aggregates),
 * not the volatile in-memory ring. This is the data layer Gaming Intelligence
 * dashboards consume for historical / session analysis.
 */

const HOUR = 3_600_000;

function demoSessions(): TelemetrySession[] {
  const now = Date.now();
  return [
    {
      id: 3,
      startedAt: now - 2 * HOUR,
      endedAt: null,
      durationMs: 2 * HOUR,
      samples: 1440,
      cpuUsageAvg: 28,
      cpuTempAvg: 58,
      cpuTempMax: 84,
      gpuUsageAvg: 41,
      gpuTempAvg: 52,
      gpuTempMax: 71,
      fpsAvg: 0,
      fpsMax: 0,
      appVersion: "1.0.0-beta.2",
    },
    {
      id: 2,
      startedAt: now - 26 * HOUR,
      endedAt: now - 23 * HOUR,
      durationMs: 3 * HOUR,
      samples: 2160,
      cpuUsageAvg: 64,
      cpuTempAvg: 71,
      cpuTempMax: 92,
      gpuUsageAvg: 78,
      gpuTempAvg: 68,
      gpuTempMax: 83,
      fpsAvg: 0,
      fpsMax: 0,
      appVersion: "1.0.0-beta.2",
    },
    {
      id: 1,
      startedAt: now - 52 * HOUR,
      endedAt: now - 51 * HOUR,
      durationMs: HOUR,
      samples: 720,
      cpuUsageAvg: 18,
      cpuTempAvg: 49,
      cpuTempMax: 63,
      gpuUsageAvg: 9,
      gpuTempAvg: 44,
      gpuTempMax: 52,
      fpsAvg: 0,
      fpsMax: 0,
      appVersion: "1.0.0-beta.1",
    },
  ];
}

function demoStats(): TelemetryStoreStats {
  const now = Date.now();
  return {
    sessions: 3,
    samples: 4320,
    firstSampleTs: now - 52 * HOUR,
    lastSampleTs: now,
    trackedMs: 6 * HOUR,
    cpuTempPeak: 92,
    gpuTempPeak: 83,
    fpsPeak: 0,
    dbBytes: 1.8 * 1024 * 1024,
  };
}

export function useTelemetryHistory() {
  const [sessions, setSessions] = useState<TelemetrySession[]>([]);
  const [stats, setStats] = useState<TelemetryStoreStats | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    if (!isTauri()) {
      setSessions(demoSessions());
      setStats(demoStats());
      setLoading(false);
      return;
    }
    Promise.allSettled([telemetrySessions(20), telemetryStats()])
      .then(([s, st]) => {
        if (s.status === "fulfilled") setSessions(s.value);
        if (st.status === "fulfilled") setStats(st.value);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(refresh, [refresh]);

  return { sessions, stats, loading, refresh };
}
