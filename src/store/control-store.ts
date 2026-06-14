import { create } from "zustand";
import type {
  AutomationConfig,
  NexusProfile,
  PowerInfo,
} from "@/lib/power-types";

interface ControlState {
  powerInfo: PowerInfo | null;
  nexusProfiles: NexusProfile[];
  activeProfile: string | null;
  automation: AutomationConfig | null;

  setPowerInfo: (p: PowerInfo) => void;
  setNexusProfiles: (p: NexusProfile[]) => void;
  setActiveProfile: (id: string | null) => void;
  setAutomation: (a: AutomationConfig) => void;
  /** Optimistically mark a power profile active (before the IPC round-trip). */
  markPowerActive: (name: string) => void;
}

export const useControlStore = create<ControlState>((set) => ({
  powerInfo: null,
  nexusProfiles: [],
  activeProfile: null,
  automation: null,

  setPowerInfo: (powerInfo) => set({ powerInfo }),
  setNexusProfiles: (nexusProfiles) => set({ nexusProfiles }),
  setActiveProfile: (activeProfile) => set({ activeProfile }),
  setAutomation: (automation) => set({ automation }),
  markPowerActive: (name) =>
    set((s) =>
      s.powerInfo
        ? {
            powerInfo: {
              ...s.powerInfo,
              current: name,
              profiles: s.powerInfo.profiles.map((p) => ({
                ...p,
                active: p.name === name,
              })),
            },
          }
        : {},
    ),
}));

/* ----- Demo data (browser / no Tauri) ----- */

export const DEMO_POWER_INFO: PowerInfo = {
  driver: "power-profiles-daemon",
  controllable: true,
  current: "balanced",
  cpuDriver: "intel_pstate",
  acOnline: true,
  profiles: [
    { name: "performance", cpuDriver: "intel_pstate", active: false },
    { name: "balanced", cpuDriver: "intel_pstate", active: true },
    { name: "power-saver", cpuDriver: "intel_pstate", active: false },
  ],
};

export const DEMO_NEXUS_PROFILES: NexusProfile[] = [
  { id: "gaming", name: "Gaming", icon: "gamepad", builtin: true, power: "performance", rgb: { effect: "static", hue: 0, brightness: 100, speed: 50 }, fan: null, gpu: null },
  { id: "coding", name: "Coding", icon: "code", builtin: true, power: "balanced", rgb: { effect: "static", hue: 210, brightness: 70, speed: 0 }, fan: null, gpu: null },
  { id: "streaming", name: "Streaming", icon: "video", builtin: true, power: "performance", rgb: { effect: "breathing", hue: 280, brightness: 90, speed: 40 }, fan: null, gpu: null },
  { id: "battery-saver", name: "Battery Saver", icon: "leaf", builtin: true, power: "power-saver", rgb: { effect: "static", hue: 30, brightness: 25, speed: 0 }, fan: null, gpu: null },
  { id: "custom", name: "Custom", icon: "sliders", builtin: true, power: "balanced", rgb: null, fan: null, gpu: null },
];

export const DEMO_AUTOMATION: AutomationConfig = {
  enabled: false,
  rules: [
    { id: "steam-gaming", trigger: { type: "processRunning", process: "steam" }, profileId: "gaming", enabled: true },
    { id: "code-coding", trigger: { type: "processRunning", process: "code" }, profileId: "coding", enabled: true },
    { id: "obs-streaming", trigger: { type: "processRunning", process: "obs" }, profileId: "streaming", enabled: true },
    { id: "low-battery", trigger: { type: "batteryBelow", percent: 20 }, profileId: "battery-saver", enabled: true },
  ],
};
