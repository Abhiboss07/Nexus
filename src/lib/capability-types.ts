/**
 * TS mirror of the Rust control capability contracts
 * (src-tauri/src/control/capabilities.rs). The UI reasons purely about these
 * capability flags — never about which vendor or driver produced them.
 */
import type { Vendor } from "./telemetry-types";

export interface CapabilityStatus {
  available: boolean;
  controllable: boolean;
  driver: string;
  notes: string;
}

export interface RgbCapability {
  status: CapabilityStatus;
  zones: number;
  perKey: boolean;
  effects: string[];
}

export interface FanCapability {
  status: CapabilityStatus;
  fanCount: number;
  manualPwm: boolean;
  modes: string[];
}

export interface PowerCapability {
  status: CapabilityStatus;
  profiles: string[];
  currentProfile: string | null;
  tunableTdp: boolean;
}

export interface BatteryCapability {
  status: CapabilityStatus;
  chargeLimit: boolean;
  conservationMode: boolean;
  limitRange: [number, number] | null;
}

export interface MuxCapability {
  status: CapabilityStatus;
  modes: string[];
  currentMode: string | null;
  requiresReboot: boolean;
}

export interface HardwareCapabilities {
  vendor: Vendor;
  vendorLabel: string;
  rgb: RgbCapability;
  fan: FanCapability;
  power: PowerCapability;
  battery: BatteryCapability;
  mux: MuxCapability;
}

export interface DriverInfo {
  domain: string;
  driver: string | null;
}

/* ----- RGB control (Phase 3.1) ----- */

export interface RgbRequest {
  effect: string;
  hue: number;
  brightness: number;
  speed: number;
  zone?: string | null;
}

export interface RgbState {
  effect: string;
  brightness: number;
  speed: number;
  zones: string[];
}

export interface RgbProfile {
  name: string;
  effect: string;
  hue: number;
  brightness: number;
  speed: number;
  zones: string[];
}

export interface ControlOutcome {
  applied: boolean;
  dryRun: boolean;
  message: string;
}

/** Discriminated union mirroring Rust's ControlAction (serde tag = "type"). */
export type ControlAction =
  | { type: "setPowerProfile"; profile: string }
  | { type: "setFanMode"; mode: string; speedPercent?: number }
  | { type: "setChargeLimit"; limit: number }
  | { type: "setRgb"; effect: string; hue: number; brightness: number; speed: number }
  | { type: "setMux"; mode: string };
