/** TS mirror of src-tauri/src/control/battery (Phase 3.3A). */

export type BatteryGrade = "excellent" | "good" | "fair" | "poor";

export interface BatteryRecommendation {
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
}

export interface BatterySample {
  ts: number;
  capacity: number;
  healthPercent: number;
  energyFullWh: number;
  powerW: number;
  status: string;
}

export interface LifespanEstimate {
  equivalentCycles: number;
  cyclesToEol: number;
  yearsRemaining: number;
  summary: string;
}

export interface DegradationTrend {
  samples: number;
  firstFullWh: number;
  currentFullWh: number;
  lostWh: number;
  spanDays: number;
}

export interface BatteryReport {
  present: boolean;
  status: string;
  capacityLevel: string;
  technology: string;
  manufacturer: string;
  model: string;
  serial: string;
  chargePercent: number;
  healthPercent: number;
  wearPercent: number;
  score: number;
  grade: BatteryGrade;
  designWh: number;
  fullWh: number;
  nowWh: number;
  voltageV: number;
  voltageMinDesignV: number;
  cycleCount: number;
  charging: boolean;
  powerDrawW: number;
  chargeRateW: number;
  dischargeRateW: number;
  runtimeMin: number | null;
  lifespan: LifespanEstimate;
  degradation: DegradationTrend;
  recommendations: BatteryRecommendation[];
}

/** Evidence for whether Linux can cap this battery's charge level (Task 4). */
export interface ChargeLimitProbe {
  path: string;
  exists: boolean;
  purpose: string;
}

export interface ChargeLimitEvidence {
  supported: boolean;
  battery: string | null;
  vendorLabel: string;
  explanation: string;
  probes: ChargeLimitProbe[];
}
