/**
 * Demo-mode telemetry. When not running under Tauri (e.g. `npm run dev` in a
 * browser), this synthesizes realistic, smoothly-drifting snapshots so every
 * live surface keeps working. Shapes are identical to the Rust engine output.
 */
import type { HardwareProfile, Snapshot } from "./telemetry-types";

const GB = 1024 ** 3;
const MB = 1024 ** 2;

export const DEMO_PROFILE: HardwareProfile = {
  vendor: "omen",
  vendorLabel: "HP OMEN",
  sysVendor: "HP",
  productName: "OMEN by HP Gaming Laptop 16",
  boardName: "8BA9",
  cpuVendor: "Intel",
  cpuModel: "Intel Core i7-13700HX",
  gpuVendor: "NVIDIA",
  gpuName: "NVIDIA GeForce RTX 4050 Laptop GPU",
  hasNvidia: true,
  hasAmdGpu: false,
  hasBattery: true,
  hasFanSensors: false,
  supportsFanControl: false,
  os: "CachyOS Linux",
};

function drift(v: number, target: number, jitter: number, min = 0, max = 100) {
  const next = v + (target - v) * 0.15 + (Math.random() - 0.5) * jitter;
  return Math.max(min, Math.min(max, next));
}

export function createDemoStream() {
  let cpu = 22;
  let gpu = 18;
  let mem = 44;
  let cpuTemp = 52;
  let gpuTemp = 48;
  let down = 0;
  let up = 0;
  let charge = 92;
  // Demo battery oscillates so it's clearly *simulated* and exercises both
  // charging + discharging states (it can't see a real charger — there's no
  // backend in browser/demo mode).
  let demoCharging = false;

  return function next(): Snapshot {
    // Occasionally simulate a load spike.
    const spiking = Math.random() < 0.1;
    cpu = drift(cpu, spiking ? 85 : 26, 12);
    gpu = drift(gpu, spiking ? 78 : 20, 14);
    mem = drift(mem, 46, 3);
    cpuTemp = drift(cpuTemp, 45 + cpu * 0.45, 4, 35, 95);
    gpuTemp = drift(gpuTemp, 42 + gpu * 0.4, 4, 35, 90);
    down = Math.max(0, drift(down, Math.random() < 0.3 ? 80 : 8, 30, 0, 1000)) * MB / 8;
    up = Math.max(0, drift(up, 4, 8, 0, 200)) * MB / 8;
    if (charge >= 98) demoCharging = false;
    else if (charge <= 30) demoCharging = true;
    charge = Math.max(20, Math.min(100, charge + (demoCharging ? 0.05 : -0.03)));

    const cores = Array.from({ length: 16 }, (_, i) =>
      Math.max(2, Math.min(100, cpu + Math.sin(Date.now() / 800 + i) * 18)),
    );

    return {
      timestamp: Date.now(),
      cpu: {
        model: DEMO_PROFILE.cpuModel,
        usage: cpu,
        perCore: cores,
        frequencyMhz: Math.round(2200 + cpu * 26),
        maxFrequencyMhz: 5000,
        temperatureC: cpuTemp,
        packagePowerW: 15 + cpu * 0.6,
        coreCount: 8,
        threadCount: 16,
      },
      gpu: {
        name: DEMO_PROFILE.gpuName,
        vendor: "NVIDIA",
        usage: gpu,
        vramUsedMb: Math.round(900 + gpu * 50),
        vramTotalMb: 6141,
        temperatureC: gpuTemp,
        coreClockMhz: Math.round(400 + gpu * 18),
        memClockMhz: 6000,
        powerW: 8 + gpu * 0.6,
        powerLimitW: 75,
      },
      memory: {
        totalBytes: 16 * GB,
        usedBytes: (mem / 100) * 16 * GB,
        availableBytes: (1 - mem / 100) * 16 * GB,
        usage: mem,
        swapTotalBytes: 16 * GB,
        swapUsedBytes: 0.4 * GB,
        swapUsage: 2.5,
      },
      storage: [
        {
          device: "nvme0n1p2",
          mountPoint: "/",
          filesystem: "btrfs",
          totalBytes: 2048 * GB,
          usedBytes: 1240 * GB,
          usage: 60.5,
          temperatureC: 38 + Math.random() * 4,
          readBytesSec: Math.round(Math.random() * 200 * MB),
          writeBytesSec: Math.round(Math.random() * 80 * MB),
          smartStatus: "passed",
        },
      ],
      battery: {
        present: true,
        status: demoCharging ? "charging" : "discharging",
        chargePercent: charge,
        healthPercent: 85.9,
        cycleCount: 213,
        energyNowWh: (charge / 100) * 71.3,
        energyFullWh: 71.3,
        energyDesignWh: 83,
        powerDrawW: 14 + Math.random() * 4,
        voltageV: 12.8,
        timeRemainingMin: null,
      },
      network: {
        interface: "wlan0",
        downloadBytesSec: Math.round(down),
        uploadBytesSec: Math.round(up),
        totalDownBytes: 0,
        totalUpBytes: 0,
        latencyMs: 8 + Math.random() * 6,
      },
      fans: [
        { label: "CPU Fan", rpm: Math.round(2400 + cpu * 22) },
        { label: "GPU Fan", rpm: Math.round(2200 + gpu * 20) },
      ],
      thermals: {
        cpuC: cpuTemp,
        gpuC: gpuTemp,
        storageC: 39,
        sensors: [
          { source: "coretemp", label: "Package id 0", temperatureC: cpuTemp },
          { source: "nvme", label: "Composite", temperatureC: 39 },
          { source: "acpitz", label: "temp1", temperatureC: 44 },
        ],
      },
    };
  };
}
