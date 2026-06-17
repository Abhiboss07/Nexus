import { useEffect } from "react";
import { isTauri, getIntelligence } from "@/lib/ipc";
import type {
  IntelligenceReport,
  Trend,
  Subsystem,
} from "@/lib/intelligence-types";
import type { HistoryPoint, Snapshot } from "@/lib/telemetry-types";
import { useTelemetryStore } from "@/store/telemetry-store";
import {
  useIntelligenceStore,
  useIntelligenceReport,
} from "@/store/intelligence-store";

/* ---- Demo builder (mirrors the Rust scoring; browser-only fallback) ---- */

function slope(ys: number[]): number {
  const n = ys.length;
  if (n < 2) return 0;
  const mx = (n - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  ys.forEach((y, i) => { num += (i - mx) * (y - my); den += (i - mx) ** 2; });
  return den ? num / den : 0;
}

function trend(metric: string, ys: number[], band: number): Trend {
  const s = slope(ys);
  const series = ys.slice(-48);
  return {
    metric,
    current: ys.at(-1) ?? 0,
    average: ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : 0,
    min: ys.length ? Math.min(...ys) : 0,
    max: ys.length ? Math.max(...ys) : 0,
    direction: Math.abs(s) < band ? "stable" : s > 0 ? "rising" : "falling",
    slope: s,
    samples: ys.length,
    series,
  };
}

const thermalScore = (t: number) => Math.round(Math.max(0, Math.min(100, 100 - Math.max(0, t - 55) * 1.6)));
const pressureScore = (u: number) => Math.round(Math.max(0, Math.min(100, 100 - Math.max(0, u - 60) * 1.8)));
const statusFor = (s: number): Subsystem["status"] => (s >= 85 ? "optimal" : s >= 70 ? "good" : s >= 50 ? "warning" : "critical");

function buildDemo(snap: Snapshot | null, history: HistoryPoint[]): IntelligenceReport {
  const cpuTemp = snap?.cpu.temperatureC ?? 48;
  const gpuTemp = snap?.gpu?.temperatureC ?? 41;
  const mem = snap?.memory.usage ?? 41;
  const cpuUsage = snap?.cpu.usage ?? 8;
  const gpuUsage = snap?.gpu?.usage ?? 4;
  const vram = snap?.gpu ? (snap.gpu.vramUsedMb / snap.gpu.vramTotalMb) * 100 : 1;
  const batteryHealth = snap?.battery?.healthPercent ?? 85.8;

  const subs: Subsystem[] = [
    { name: "CPU", score: thermalScore(cpuTemp), status: statusFor(thermalScore(cpuTemp)), detail: `${cpuTemp.toFixed(0)}°C · ${cpuUsage.toFixed(0)}% load`, weight: 0.22 },
    { name: "GPU", score: thermalScore(gpuTemp), status: statusFor(thermalScore(gpuTemp)), detail: `${gpuTemp.toFixed(0)}°C · ${vram.toFixed(0)}% VRAM`, weight: 0.2 },
    { name: "Memory", score: pressureScore(mem), status: statusFor(pressureScore(mem)), detail: `${mem.toFixed(0)}% used`, weight: 0.15 },
    { name: "Storage", score: 92, status: "optimal", detail: "/ 55% · SMART passed", weight: 0.13 },
    { name: "Battery", score: Math.round(batteryHealth), status: statusFor(batteryHealth), detail: `${batteryHealth.toFixed(0)}% health`, weight: 0.18 },
    { name: "Thermals", score: thermalScore(Math.max(cpuTemp, gpuTemp)), status: statusFor(thermalScore(Math.max(cpuTemp, gpuTemp))), detail: `peak ${Math.max(cpuTemp, gpuTemp).toFixed(0)}°C`, weight: 0.12 },
  ];
  const tw = subs.reduce((a, s) => a + s.weight, 0);
  const overall = Math.round(subs.reduce((a, s) => a + s.score * s.weight, 0) / tw);

  const bottleneck = gpuUsage >= 92 ? "gpu" : cpuUsage >= 92 ? "cpu" : vram >= 92 ? "vram" : "none";

  return {
    health: { overallScore: overall, grade: statusFor(overall), subsystems: subs },
    bottleneck: { bottleneck, confidence: 85, detail: bottleneck === "none" ? "No single subsystem is limiting performance right now." : "One subsystem is saturated.", evidence: [{ metric: "CPU", value: `${cpuUsage.toFixed(0)}%`, threshold: "—" }, { metric: "GPU", value: `${gpuUsage.toFixed(0)}%`, threshold: "—" }] },
    recommendations: overall >= 85
      ? [{ id: "all-good", title: "System is running optimally", detail: "No issues detected across thermals, power, memory, storage or battery.", category: "thermal", severity: "info", confidence: 90, evidence: [{ metric: "CPU temp", value: `${cpuTemp.toFixed(0)}°C`, threshold: "82°C" }], action: null }]
      : [{ id: "cpu-thermal", title: "CPU running warm", detail: "A custom fan curve will lower peaks.", category: "thermal", severity: "warning", confidence: 78, evidence: [{ metric: "CPU temp", value: `${cpuTemp.toFixed(0)}°C`, threshold: "82°C" }], action: "/performance" }],
    trends: {
      metrics: [
        trend("CPU Usage", history.map((p) => p.cpuUsage), 0.05),
        trend("CPU Temp", history.map((p) => p.cpuTemp), 0.03),
        trend("GPU Usage", history.map((p) => p.gpuUsage), 0.05),
        trend("GPU Temp", history.map((p) => p.gpuTemp), 0.03),
        trend("Memory", history.map((p) => p.memUsage), 0.03),
        trend("CPU Fan", history.map((p) => p.cpuFanRpm), 2),
      ],
    },
    maintenance: [{ component: "Battery", prediction: "≈144 cycles (~0.4 years) until the 80% end-of-life threshold.", etaDays: 144, confidence: 81, severity: "info", evidence: [{ metric: "Health", value: `${batteryHealth.toFixed(0)}%`, threshold: "80% EOL" }] }],
    automationSuggestions: [],
  };
}

/**
 * The single, global intelligence poller. Mounted exactly once (AppProviders),
 * it recomputes the report on ONE cadence and publishes it to the intelligence
 * store. Telemetry is read via `getState()` inside the interval, so there are no
 * per-tick subscriptions and the report regenerates only on its own poll — not
 * on every 1.5s telemetry frame. Consumers read slices from the store.
 */
export function useIntelligencePoller() {
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const setReport = useIntelligenceStore.getState().setReport;
    const buildFromStore = () => {
      const { snapshot, history } = useTelemetryStore.getState();
      return buildDemo(snapshot, history);
    };
    async function tick() {
      try {
        const cpu = useTelemetryStore.getState().snapshot?.cpu.usage;
        const r = await getIntelligence(cpu);
        if (!cancelled) setReport(r);
      } catch {
        if (!cancelled) setReport(buildFromStore());
      }
    }
    if (isTauri()) {
      tick();
      timer = window.setInterval(tick, 4000);
    } else {
      setReport(buildFromStore());
      timer = window.setInterval(() => setReport(buildFromStore()), 2500);
    }
    return () => { cancelled = true; if (timer) window.clearInterval(timer); };
  }, []);
}

/** Back-compat accessor — the full report, sourced from the shared store. */
export function useIntelligence() {
  return { report: useIntelligenceReport() };
}
