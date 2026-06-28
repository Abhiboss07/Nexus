import { useEffect, useState } from "react";
import { isTauri, getFanInfo, getThermalReport } from "@/lib/ipc";
import { isAppActive } from "@/lib/app-visibility";
import type { FanInfo, ThermalReport } from "@/lib/fan-types";

const DEMO_FAN: FanInfo = {
  capabilities: {
    available: true,
    driver: "omen-rgb-keyboard",
    interface: "victus-s",
    canReadRpm: true,
    canSetCurve: true,
    canSetThermalProfile: true,
    canMaxFan: true,
    maxCurvePoints: 8,
    tempRange: [0, 120],
    pctRange: [0, 100],
    thermalProfiles: ["performance", "normal", "silent"],
    writable: false,
    permissionNote: "Demo — fan control requires the 'input' group on real hardware.",
  },
  cpuRpm: 2000,
  gpuRpm: 2300,
  maxFan: false,
  fanCurveEnabled: false,
  thermalProfile: "normal",
  tempZone: "(auto)",
  curve: [
    { tempC: 45, pct: 20 },
    { tempC: 60, pct: 45 },
    { tempC: 75, pct: 70 },
    { tempC: 88, pct: 100 },
  ],
  attributes: [
    { name: "cpu_fan_rpm", present: true, writable: false, value: "2000", format: "u32 RPM (read-only)" },
    { name: "gpu_fan_rpm", present: true, writable: false, value: "2300", format: "u32 RPM (read-only)" },
    { name: "fan_curve", present: true, writable: false, value: "(unset)", format: "`temp:pct …` (2–8 pts, t 0–120, p 0–100)" },
    { name: "fan_curve_enable", present: true, writable: false, value: "0", format: "0 | 1" },
    { name: "fan_temp_zone", present: true, writable: false, value: "(auto)", format: "zone name | auto" },
    { name: "max_fan", present: true, writable: false, value: "0", format: "0 | 1 (max boost)" },
    { name: "thermal_profile", present: true, writable: false, value: "unknown", format: "performance | normal | silent" },
  ],
};

function demoThermal(): ThermalReport {
  const cpu = 48 + Math.random() * 18;
  const gpu = 42 + Math.random() * 14;
  const hottest = Math.max(cpu, gpu);
  const score = Math.round(Math.max(0, Math.min(100, 100 - Math.max(0, hottest - 55) * 1.6)));
  return {
    cpuC: cpu,
    gpuC: gpu,
    ssdC: 39 + Math.random() * 3,
    sensors: [
      { source: "coretemp", label: "Package id 0", temperatureC: cpu },
      { source: "nvme", label: "Composite", temperatureC: 40 },
      { source: "acpitz", label: "temp1", temperatureC: 45 },
    ],
    score,
    grade: hottest < 65 ? "optimal" : hottest < 79 ? "good" : hottest < 88 ? "warm" : "hot",
    recommendations: [
      hottest > 80
        ? { severity: "warning", title: "CPU running hot", detail: "Above 80°C — a custom fan curve will lower peaks." }
        : { severity: "info", title: "Thermals optimal", detail: "Temperatures are well within range." },
    ],
    correlation: { cpuC: cpu, cpuRpm: Math.round(1800 + cpu * 20), gpuC: gpu, gpuRpm: Math.round(2000 + gpu * 18), note: "Live operating point." },
  };
}

export function useThermal() {
  const [fanInfo, setFanInfo] = useState<FanInfo | null>(null);
  const [thermal, setThermal] = useState<ThermalReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function loadLive() {
      // Skip the thermal report (spawns nvidia-smi) while minimized to tray.
      if (isTauri() && !isAppActive()) return;
      try {
        const [f, t] = await Promise.all([getFanInfo(), getThermalReport()]);
        if (!cancelled) {
          setFanInfo(f);
          setThermal(t);
        }
      } catch {
        if (!cancelled) {
          setFanInfo(DEMO_FAN);
          setThermal(demoThermal());
        }
      }
    }

    if (isTauri()) {
      loadLive();
      timer = window.setInterval(loadLive, 4000);
    } else {
      setFanInfo(DEMO_FAN);
      setThermal(demoThermal());
      timer = window.setInterval(() => setThermal(demoThermal()), 2500);
    }
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return { fanInfo, thermal };
}
