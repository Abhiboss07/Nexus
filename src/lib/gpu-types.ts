/** TS mirror of src-tauri/src/control/gpu (Phase 4.0). */

export interface GpuInfo {
  present: boolean;
  vendor: string;
  name: string;
  driverVersion: string;
  vbiosVersion: string;
  cudaVersion: string;
  temperatureC: number | null;
  utilization: number;
  memoryUtilization: number;
  vramUsedMb: number;
  vramTotalMb: number;
  clockGraphicsMhz: number | null;
  clockSmMhz: number | null;
  clockMemoryMhz: number | null;
  clockVideoMhz: number | null;
  powerDrawW: number | null;
  powerLimitW: number | null;
  powerDefaultW: number | null;
  powerMinW: number | null;
  powerMaxW: number | null;
  pcieGenCurrent: number | null;
  pcieGenMax: number | null;
  pcieWidthCurrent: number | null;
  pstate: string;
  memEffectiveGbps: number | null;
}

export interface GpuCapabilities {
  present: boolean;
  vendor: string;
  cudaVersion: string;
  hasNvml: boolean;
  powerLimitControl: boolean;
  dynamicBoost: boolean;
  rtd3: boolean;
  primeOffload: boolean;
  muxSwitching: boolean;
  advancedOptimus: boolean;
  tgpControl: boolean;
  notes: string;
}

export interface GpuRecommendation {
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

export interface GpuIntelligence {
  healthScore: number;
  thermalScore: number;
  efficiencyScore: number;
  gamingReadiness: number;
  vramPressure: number;
  bottleneck: string;
  recommendations: GpuRecommendation[];
}
