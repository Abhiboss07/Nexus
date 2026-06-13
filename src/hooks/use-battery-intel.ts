import { useEffect, useState } from "react";
import {
  isTauri,
  getBatteryReport,
  getBatteryHistory,
  exportBatteryReport,
} from "@/lib/ipc";
import type { BatteryReport, BatterySample } from "@/lib/battery-types";

const DEMO_REPORT: BatteryReport = {
  present: true,
  status: "full",
  capacityLevel: "Full",
  technology: "Li-ion",
  manufacturer: "333-AC-12-A",
  model: "WK06083XL",
  serial: "2485",
  chargePercent: 100,
  healthPercent: 85.8,
  wearPercent: 14.2,
  score: 86,
  grade: "good",
  designWh: 83,
  fullWh: 71.2,
  nowWh: 71.2,
  voltageV: 12.77,
  voltageMinDesignV: 11.58,
  cycleCount: 0,
  charging: false,
  powerDrawW: 0,
  chargeRateW: 0,
  dischargeRateW: 0,
  runtimeMin: null,
  lifespan: {
    equivalentCycles: 356,
    cyclesToEol: 144,
    yearsRemaining: 0.4,
    summary: "≈144 cycles (~0.4 years) until the 80% end-of-life threshold.",
  },
  degradation: { samples: 12, firstFullWh: 73.4, currentFullWh: 71.2, lostWh: 2.2, spanDays: 64 },
  recommendations: [
    { severity: "info", title: "Avoid sitting at 100%", detail: "Keeping Li-ion at full charge accelerates wear. An 80% charge cap improves longevity." },
  ],
};

function demoHistory(): BatterySample[] {
  const now = Date.now();
  return Array.from({ length: 12 }, (_, i) => ({
    ts: now - (11 - i) * 5 * 86_400_000,
    capacity: 80 + Math.round(Math.random() * 20),
    healthPercent: 87.4 - i * 0.14,
    energyFullWh: 73.4 - i * 0.2,
    powerW: 0,
    status: "full",
  }));
}

function demoMarkdown(r: BatteryReport): string {
  return `# Nexus Battery Report\n\n**Model:** ${r.model}\n\n- Score: **${r.score}/100** (${r.grade})\n- Health: ${r.healthPercent}% · Wear: ${r.wearPercent}%\n- ${r.lifespan.summary}\n`;
}

export function useBatteryIntel() {
  const [report, setReport] = useState<BatteryReport | null>(null);
  const [history, setHistory] = useState<BatterySample[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (isTauri()) {
      Promise.all([getBatteryReport(), getBatteryHistory()])
        .then(([r, h]) => {
          if (cancelled) return;
          setReport(r ?? DEMO_REPORT);
          setHistory(h.length ? h : demoHistory());
        })
        .catch(() => {
          if (cancelled) return;
          setReport(DEMO_REPORT);
          setHistory(demoHistory());
        });
    } else {
      setReport(DEMO_REPORT);
      setHistory(demoHistory());
    }
    return () => {
      cancelled = true;
    };
  }, []);

  async function exportReport(): Promise<string> {
    if (isTauri()) {
      const md = await exportBatteryReport().catch(() => null);
      if (md) return md;
    }
    return demoMarkdown(report ?? DEMO_REPORT);
  }

  return { report, history, exportReport };
}
