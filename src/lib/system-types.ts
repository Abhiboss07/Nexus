/** TS mirror of production diagnostics/setup commands (Phase 5.5). */

export interface HealthCheckItem {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface HealthCheck {
  passed: number;
  total: number;
  checks: HealthCheckItem[];
}

export interface Permissions {
  inInputGroup: boolean;
  rgbWritable: boolean;
  fanWritable: boolean;
  powerControllable: boolean;
  remediation: string;
}

export interface SetupState {
  completed: boolean;
}

export type SupportTier =
  | "validated"
  | "compatible"
  | "unknown"
  | "unsupported";

/** Multi-hardware write-safety report (finding C1). */
export interface CompatibilityReport {
  tier: SupportTier;
  tierLabel: string;
  vendor: string;
  product: string;
  board: string;
  fanInterface: string;
  fanWrites: boolean;
  rgbWrites: boolean;
  powerControllable: boolean;
  summary: string;
  notes: string[];
}

export interface UpdateInfo {
  currentVersion: string;
  channel: string;
  updateAvailable: boolean;
  latestVersion: string | null;
  notes: string;
}

/** Live result of querying the signed updater feed. */
export interface UpdateStatus {
  available: boolean;
  currentVersion: string;
  latestVersion: string | null;
  notes: string | null;
}
