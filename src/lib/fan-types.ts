/** TS mirror of src-tauri/src/control/fan (Phase 3.4A). */

export interface CurvePoint {
  tempC: number;
  pct: number;
}

export interface FanCapabilities {
  available: boolean;
  driver: string;
  /** Detected interface: "victus-s" | "classic" | "none" | "unknown". */
  interface: string;
  canReadRpm: boolean;
  /** Authoritative — custom curves work only on Victus-S with a valid table. */
  canSetCurve: boolean;
  canSetThermalProfile: boolean;
  canMaxFan: boolean;
  maxCurvePoints: number;
  tempRange: [number, number];
  pctRange: [number, number];
  thermalProfiles: string[];
  writable: boolean;
  permissionNote: string;
}

export interface FanProfile {
  name: string;
  builtin: boolean;
  thermalProfile: string | null;
  curve: CurvePoint[];
  maxFan: boolean;
}

export interface AttrInspect {
  name: string;
  present: boolean;
  writable: boolean;
  value: string;
  format: string;
}

export interface FanInfo {
  capabilities: FanCapabilities;
  cpuRpm: number | null;
  gpuRpm: number | null;
  maxFan: boolean;
  fanCurveEnabled: boolean;
  thermalProfile: string;
  tempZone: string;
  curve: CurvePoint[];
  attributes: AttrInspect[];
}

export interface ThermalSensorInfo {
  source: string;
  label: string;
  temperatureC: number;
}

export interface ThermalRecommendation {
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

export interface CorrelationPoint {
  cpuC: number | null;
  cpuRpm: number | null;
  gpuC: number | null;
  gpuRpm: number | null;
  note: string;
}

export interface ThermalReport {
  cpuC: number | null;
  gpuC: number | null;
  ssdC: number | null;
  sensors: ThermalSensorInfo[];
  score: number;
  grade: string;
  recommendations: ThermalRecommendation[];
  correlation: CorrelationPoint;
}
