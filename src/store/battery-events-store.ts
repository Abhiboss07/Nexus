import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Battery Events preferences — how Nexus reacts to AC connect/disconnect.
 * Persisted under `nexus.batteryEvents`. Drives the BatteryGlyph animation, the
 * connect/disconnect toasts, and the sound engine.
 */

export type ConnectAnim = "pulse" | "electric" | "neon" | "minimal" | "none";
export type DisconnectAnim = "fade" | "ripple" | "drain" | "minimal" | "none";
/** Built-in synthesized presets + a user file. */
export type SoundChoice = "none" | "chime" | "blip" | "power" | "custom";

export const CONNECT_ANIMS: { id: ConnectAnim; label: string }[] = [
  { id: "pulse", label: "Pulse" },
  { id: "electric", label: "Electric" },
  { id: "neon", label: "Neon" },
  { id: "minimal", label: "Minimal" },
  { id: "none", label: "None" },
];

export const DISCONNECT_ANIMS: { id: DisconnectAnim; label: string }[] = [
  { id: "fade", label: "Fade" },
  { id: "ripple", label: "Ripple" },
  { id: "drain", label: "Battery Drain" },
  { id: "minimal", label: "Minimal" },
  { id: "none", label: "None" },
];

export const SOUND_CHOICES: { id: SoundChoice; label: string }[] = [
  { id: "none", label: "None" },
  { id: "chime", label: "Chime" },
  { id: "blip", label: "Blip" },
  { id: "power", label: "Power" },
  { id: "custom", label: "Custom…" },
];

/** Custom audio is stored as a data URL; cap to keep persisted config small. */
export const MAX_CUSTOM_SOUND_BYTES = 1024 * 1024;

interface BatteryEventsState {
  connectAnim: ConnectAnim;
  disconnectAnim: DisconnectAnim;
  soundEnabled: boolean;
  volume: number; // 0–1
  connectSound: SoundChoice;
  disconnectSound: SoundChoice;
  /** Data URLs for user-supplied sounds (null when unset). */
  connectCustom: string | null;
  disconnectCustom: string | null;

  setConnectAnim: (a: ConnectAnim) => void;
  setDisconnectAnim: (a: DisconnectAnim) => void;
  setSoundEnabled: (v: boolean) => void;
  setVolume: (v: number) => void;
  setConnectSound: (s: SoundChoice) => void;
  setDisconnectSound: (s: SoundChoice) => void;
  setConnectCustom: (url: string | null) => void;
  setDisconnectCustom: (url: string | null) => void;
}

export const useBatteryEventsStore = create<BatteryEventsState>()(
  persist(
    (set) => ({
      connectAnim: "electric",
      disconnectAnim: "ripple",
      soundEnabled: true,
      volume: 0.6,
      connectSound: "chime",
      disconnectSound: "power",
      connectCustom: null,
      disconnectCustom: null,

      setConnectAnim: (connectAnim) => set({ connectAnim }),
      setDisconnectAnim: (disconnectAnim) => set({ disconnectAnim }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
      setConnectSound: (connectSound) => set({ connectSound }),
      setDisconnectSound: (disconnectSound) => set({ disconnectSound }),
      setConnectCustom: (connectCustom) => set({ connectCustom }),
      setDisconnectCustom: (disconnectCustom) => set({ disconnectCustom }),
    }),
    { name: "nexus.batteryEvents" },
  ),
);
