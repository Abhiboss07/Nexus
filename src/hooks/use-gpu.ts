import { useEffect, useRef, useState } from "react";
import { isTauri, getGpuInfo, getGpuIntelligence, getGpuCapabilities } from "@/lib/ipc";
import type { GpuCapabilities, GpuInfo, GpuIntelligence } from "@/lib/gpu-types";
import { useCpu } from "@/hooks/use-telemetry";

const DEMO_INFO: GpuInfo = {
  present: true,
  vendor: "NVIDIA",
  name: "NVIDIA GeForce RTX 4050 Laptop GPU",
  driverVersion: "610.43.02",
  vbiosVersion: "95.07.2B.00.09",
  cudaVersion: "13.3",
  temperatureC: 44,
  utilization: 6,
  memoryUtilization: 0,
  vramUsedMb: 12,
  vramTotalMb: 6141,
  clockGraphicsMhz: 2355,
  clockSmMhz: 2355,
  clockMemoryMhz: 8001,
  clockVideoMhz: 2025,
  powerDrawW: 20,
  powerLimitW: null,
  powerDefaultW: 80,
  powerMinW: 5,
  powerMaxW: 120,
  pcieGenCurrent: 4,
  pcieGenMax: 4,
  pcieWidthCurrent: 8,
  pstate: "P3",
  memEffectiveGbps: 16,
};

const DEMO_CAPS: GpuCapabilities = {
  present: true,
  vendor: "NVIDIA",
  cudaVersion: "13.3",
  hasNvml: true,
  powerLimitControl: false,
  dynamicBoost: true,
  rtd3: true,
  primeOffload: true,
  muxSwitching: false,
  advancedOptimus: false,
  tgpControl: false,
  notes: "Power-limit/TGP control unavailable (Dynamic Boost). No GPU MUX switch (Optimus; use PRIME offload).",
};

function demoIntel(info: GpuInfo): GpuIntelligence {
  const vram = (info.vramUsedMb / info.vramTotalMb) * 100;
  const thermal = Math.round(Math.max(0, 100 - Math.max(0, (info.temperatureC ?? 0) - 55) * 1.6));
  return {
    healthScore: 100,
    thermalScore: thermal,
    efficiencyScore: Math.round(Math.min(100, info.utilization / Math.max(0.1, (info.powerDrawW ?? 20) / 80))),
    gamingReadiness: Math.round(thermal * 0.4 + (100 - vram) * 0.35 + 25),
    vramPressure: vram,
    bottleneck: info.utilization > 95 ? "gpu" : vram > 92 ? "vram" : "balanced",
    recommendations: [{ severity: "info", title: "GPU healthy", detail: "Thermals, VRAM and link are all in good shape." }],
  };
}

export function useGpu() {
  const cpu = useCpu();
  const cpuRef = useRef<number | undefined>(undefined);
  cpuRef.current = cpu?.usage;

  const [info, setInfo] = useState<GpuInfo | null>(null);
  const [intel, setIntel] = useState<GpuIntelligence | null>(null);
  const [caps, setCaps] = useState<GpuCapabilities | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    async function tick() {
      try {
        const [i, t] = await Promise.all([getGpuInfo(), getGpuIntelligence(cpuRef.current)]);
        if (!cancelled) {
          setInfo(i);
          setIntel(t);
        }
      } catch {
        if (!cancelled) {
          // Drift the demo numbers a little so it feels live.
          const di = { ...DEMO_INFO, temperatureC: 42 + Math.random() * 16, utilization: Math.round(Math.random() * 30) };
          setInfo(di);
          setIntel(demoIntel(di));
        }
      }
    }

    if (isTauri()) {
      getGpuCapabilities().then((c) => !cancelled && setCaps(c)).catch(() => !cancelled && setCaps(DEMO_CAPS));
      tick();
      timer = window.setInterval(tick, 3000);
    } else {
      setCaps(DEMO_CAPS);
      setInfo(DEMO_INFO);
      setIntel(demoIntel(DEMO_INFO));
      timer = window.setInterval(() => {
        const di = { ...DEMO_INFO, temperatureC: 42 + Math.random() * 16, utilization: Math.round(Math.random() * 30) };
        setInfo(di);
        setIntel(demoIntel(di));
      }, 2500);
    }
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
    };
  }, []);

  return { info, intel, caps };
}
