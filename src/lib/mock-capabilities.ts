import type { HardwareCapabilities } from "./capability-types";

/**
 * Demo capabilities used outside Tauri. Deliberately a realistic *mix* so the
 * capability-gating is visible: power + RGB controllable, battery read-only,
 * fan + MUX unavailable — mirroring a typical OMEN config without extra drivers.
 */
export const DEMO_CAPABILITIES: HardwareCapabilities = {
  vendor: "omen",
  vendorLabel: "HP OMEN",
  rgb: {
    status: { available: true, controllable: true, driver: "openrgb", notes: "" },
    zones: 4,
    perKey: false,
    effects: ["static", "breathing", "wave", "rainbow", "aurora", "reactive"],
  },
  fan: {
    status: {
      available: false,
      controllable: false,
      driver: "",
      notes: "No fan sensors detected (needs the hp-wmi platform driver)",
    },
    fanCount: 0,
    manualPwm: false,
    modes: ["auto", "silent", "balanced", "max"],
  },
  power: {
    status: { available: true, controllable: true, driver: "platform_profile", notes: "" },
    profiles: ["low-power", "balanced", "performance"],
    currentProfile: "balanced",
    tunableTdp: true,
  },
  battery: {
    status: {
      available: true,
      controllable: false,
      driver: "power_supply",
      notes: "Charge threshold not exposed by this firmware",
    },
    chargeLimit: false,
    conservationMode: false,
    limitRange: null,
  },
  mux: {
    status: {
      available: false,
      controllable: false,
      driver: "",
      notes: "No GPU MUX/switching interface found",
    },
    modes: ["integrated", "hybrid", "discrete"],
    currentMode: null,
    requiresReboot: true,
  },
};
