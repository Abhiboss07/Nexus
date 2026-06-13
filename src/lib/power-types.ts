/**
 * TS mirror of the Phase 3.2 power/profile/automation contracts
 * (src-tauri/src/control/{power,nexus,automation}).
 */

export interface ProfileMeta {
  name: string;
  cpuDriver: string | null;
  active: boolean;
}

export interface PowerInfo {
  driver: string;
  controllable: boolean;
  current: string | null;
  profiles: ProfileMeta[];
  cpuDriver: string | null;
  acOnline: boolean;
}

export interface RgbSpec {
  effect: string;
  hue: number;
  brightness: number;
  speed: number;
}

export interface NexusProfile {
  id: string;
  name: string;
  icon: string;
  builtin: boolean;
  power: string | null;
  rgb: RgbSpec | null;
  fan: string | null;
  gpu: string | null;
}

export type Trigger =
  | { type: "processRunning"; process: string }
  | { type: "batteryBelow"; percent: number }
  | { type: "acConnected"; connected: boolean };

export interface Rule {
  id: string;
  trigger: Trigger;
  profileId: string;
  enabled: boolean;
}

export interface AutomationConfig {
  enabled: boolean;
  rules: Rule[];
}
