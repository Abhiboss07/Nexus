/**
 * TypeScript mirror of the Rust telemetry contracts (src-tauri/src/telemetry).
 * Keep field names in sync — the Rust side serializes camelCase.
 */

export interface CpuTelemetry {
  model: string;
  usage: number;
  perCore: number[];
  frequencyMhz: number;
  maxFrequencyMhz: number;
  temperatureC: number | null;
  packagePowerW: number | null;
  coreCount: number;
  threadCount: number;
}

export interface GpuTelemetry {
  name: string;
  vendor: string;
  usage: number;
  vramUsedMb: number;
  vramTotalMb: number;
  temperatureC: number | null;
  coreClockMhz: number | null;
  memClockMhz: number | null;
  powerW: number | null;
  powerLimitW: number | null;
}

export interface MemoryTelemetry {
  totalBytes: number;
  usedBytes: number;
  availableBytes: number;
  usage: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  swapUsage: number;
}

export interface StorageTelemetry {
  device: string;
  mountPoint: string;
  filesystem: string;
  totalBytes: number;
  usedBytes: number;
  usage: number;
  temperatureC: number | null;
  readBytesSec: number;
  writeBytesSec: number;
  smartStatus: "passed" | "failing" | "unknown";
}

export interface BatteryTelemetry {
  present: boolean;
  status: string;
  chargePercent: number;
  healthPercent: number;
  cycleCount: number;
  energyNowWh: number;
  energyFullWh: number;
  energyDesignWh: number;
  powerDrawW: number;
  voltageV: number;
  timeRemainingMin: number | null;
}

export interface NetworkTelemetry {
  interface: string;
  downloadBytesSec: number;
  uploadBytesSec: number;
  totalDownBytes: number;
  totalUpBytes: number;
  latencyMs: number | null;
}

export interface FanTelemetry {
  label: string;
  rpm: number;
}

export interface ThermalSensor {
  source: string;
  label: string;
  temperatureC: number;
}

export interface ThermalsTelemetry {
  cpuC: number | null;
  gpuC: number | null;
  storageC: number | null;
  sensors: ThermalSensor[];
}

export interface Snapshot {
  timestamp: number;
  cpu: CpuTelemetry;
  gpu: GpuTelemetry | null;
  memory: MemoryTelemetry;
  storage: StorageTelemetry[];
  battery: BatteryTelemetry | null;
  network: NetworkTelemetry;
  fans: FanTelemetry[];
  thermals: ThermalsTelemetry;
}

export interface ProcInfo {
  pid: number;
  name: string;
  cpuPercent: number;
  memMb: number;
  state: string;
}

export interface HistoryPoint {
  ts: number;
  cpuUsage: number;
  cpuTemp: number;
  gpuUsage: number;
  gpuTemp: number;
  memUsage: number;
  netDown: number;
  netUp: number;
  cpuFanRpm: number;
  gpuFanRpm: number;
}

export type Vendor =
  | "omen"
  | "victus"
  | "rog"
  | "tuf"
  | "legion"
  | "alienware"
  | "dell"
  | "generic";

export interface HardwareProfile {
  vendor: Vendor;
  vendorLabel: string;
  sysVendor: string;
  productName: string;
  boardName: string;
  cpuVendor: string;
  cpuModel: string;
  gpuVendor: string;
  gpuName: string;
  hasNvidia: boolean;
  hasAmdGpu: boolean;
  hasBattery: boolean;
  hasFanSensors: boolean;
  supportsFanControl: boolean;
  os: string;
}

/** Where the current telemetry stream is coming from. */
export type TelemetrySource = "connecting" | "live" | "demo";
