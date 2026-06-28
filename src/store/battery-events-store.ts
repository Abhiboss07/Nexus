import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Battery Events preferences — how Nexus reacts to power-supply transitions.
 *
 * Persisted under `nexus.batteryEvents` (schema v2). v1 only knew about AC
 * connect/disconnect; v2 generalises to a per-event config map plus saveable
 * profiles. Each event owns an animation (rendered on the BatteryGlyph), a sound
 * (synthesised preset or user file) and an optional custom-audio data URL.
 */

/**
 * Unified animation set. The *continuous* anims drive the charging glow/shimmer
 * while plugged in; the *one-shot* anims play once on a transition edge. The
 * BatteryGlyph branches on the id, so any event may use any anim — the editor
 * just surfaces the ones that read well for that event's kind.
 */
export type AnimId =
  | "pulse"
  | "electric"
  | "neon"
  | "ripple"
  | "fade"
  | "drain"
  | "minimal"
  | "none";

export const CONTINUOUS_ANIMS: { id: AnimId; label: string }[] = [
  { id: "pulse", label: "Pulse" },
  { id: "electric", label: "Electric" },
  { id: "neon", label: "Neon" },
  { id: "minimal", label: "Minimal" },
  { id: "none", label: "None" },
];

export const ONESHOT_ANIMS: { id: AnimId; label: string }[] = [
  { id: "ripple", label: "Ripple" },
  { id: "fade", label: "Fade" },
  { id: "drain", label: "Battery Drain" },
  { id: "minimal", label: "Minimal" },
  { id: "none", label: "None" },
];

/** Built-in synthesised presets + a user file. */
export type SoundChoice = "none" | "chime" | "blip" | "power" | "custom";

export const SOUND_CHOICES: { id: SoundChoice; label: string }[] = [
  { id: "none", label: "None" },
  { id: "chime", label: "Chime" },
  { id: "blip", label: "Blip" },
  { id: "power", label: "Power" },
  { id: "custom", label: "Custom…" },
];

/** Custom audio is stored as a data URL; cap to keep persisted config small. */
export const MAX_CUSTOM_SOUND_BYTES = 1024 * 1024;

export type BatteryEvent =
  | "connect"
  | "fastCharge"
  | "slowCharge"
  | "full"
  | "disconnect"
  | "low"
  | "critical";

/** Whether an event maps to a sustained charging state or a momentary edge. */
export type EventKind = "continuous" | "oneshot";

export const BATTERY_EVENTS: {
  id: BatteryEvent;
  label: string;
  kind: EventKind;
  desc: string;
}[] = [
  { id: "connect", label: "AC Connected", kind: "continuous", desc: "Charger plugged in" },
  { id: "fastCharge", label: "Fast Charging", kind: "continuous", desc: "High-wattage charge" },
  { id: "slowCharge", label: "Slow Charging", kind: "continuous", desc: "Trickle / low-watt charge" },
  { id: "full", label: "Fully Charged", kind: "oneshot", desc: "Reached 100%" },
  { id: "disconnect", label: "Unplugged", kind: "oneshot", desc: "Running on battery" },
  { id: "low", label: "Battery Low", kind: "oneshot", desc: "Dropped below 20%" },
  { id: "critical", label: "Battery Critical", kind: "oneshot", desc: "Dropped below 10%" },
];

export interface EventConfig {
  anim: AnimId;
  sound: SoundChoice;
  /** Data URL for a user-supplied sound (null when unset). */
  custom: string | null;
}

/** The full, portable configuration — this is what profiles snapshot. */
export interface BatteryEventsConfig {
  events: Record<BatteryEvent, EventConfig>;
  soundEnabled: boolean;
  volume: number; // 0–1
}

export interface BatteryProfile {
  id: string;
  name: string;
  config: BatteryEventsConfig;
}

const DEFAULT_EVENTS: Record<BatteryEvent, EventConfig> = {
  connect: { anim: "electric", sound: "chime", custom: null },
  fastCharge: { anim: "neon", sound: "blip", custom: null },
  slowCharge: { anim: "pulse", sound: "none", custom: null },
  full: { anim: "fade", sound: "chime", custom: null },
  disconnect: { anim: "ripple", sound: "power", custom: null },
  low: { anim: "fade", sound: "blip", custom: null },
  critical: { anim: "drain", sound: "power", custom: null },
};

export function defaultConfig(): BatteryEventsConfig {
  return {
    events: structuredClone(DEFAULT_EVENTS),
    soundEnabled: true,
    volume: 0.6,
  };
}

const ANIM_IDS = new Set<AnimId>([
  "pulse",
  "electric",
  "neon",
  "ripple",
  "fade",
  "drain",
  "minimal",
  "none",
]);
const SOUND_IDS = new Set<SoundChoice>(["none", "chime", "blip", "power", "custom"]);

function genId(): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Coerce arbitrary parsed JSON into a valid config, falling back to defaults. */
function sanitizeConfig(raw: unknown): BatteryEventsConfig {
  const base = defaultConfig();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<BatteryEventsConfig>;

  if (typeof r.soundEnabled === "boolean") base.soundEnabled = r.soundEnabled;
  if (typeof r.volume === "number" && Number.isFinite(r.volume)) {
    base.volume = Math.max(0, Math.min(1, r.volume));
  }

  if (r.events && typeof r.events === "object") {
    for (const { id } of BATTERY_EVENTS) {
      const e = (r.events as Record<string, unknown>)[id];
      if (!e || typeof e !== "object") continue;
      const ev = e as Partial<EventConfig>;
      if (ev.anim && ANIM_IDS.has(ev.anim)) base.events[id].anim = ev.anim;
      if (ev.sound && SOUND_IDS.has(ev.sound)) base.events[id].sound = ev.sound;
      if (typeof ev.custom === "string" && ev.custom.startsWith("data:")) {
        base.events[id].custom = ev.custom;
      }
    }
  }
  return base;
}

interface BatteryEventsState extends BatteryEventsConfig {
  profiles: BatteryProfile[];

  setEventAnim: (event: BatteryEvent, anim: AnimId) => void;
  setEventSound: (event: BatteryEvent, sound: SoundChoice) => void;
  setEventCustom: (event: BatteryEvent, url: string | null) => void;
  setSoundEnabled: (v: boolean) => void;
  setVolume: (v: number) => void;
  resetDefaults: () => void;

  saveProfile: (name: string) => string;
  applyProfile: (id: string) => void;
  deleteProfile: (id: string) => void;
  renameProfile: (id: string, name: string) => void;

  /** Serialise the live config (or a saved profile) to a JSON string. */
  exportConfig: (profileId?: string) => string;
  /** Parse + validate a JSON config and add it as a new profile. */
  importProfile: (json: string) => { ok: true; id: string } | { ok: false; error: string };
}

export const useBatteryEventsStore = create<BatteryEventsState>()(
  persist(
    (set, get) => ({
      ...defaultConfig(),
      profiles: [],

      setEventAnim: (event, anim) =>
        set((s) => ({ events: { ...s.events, [event]: { ...s.events[event], anim } } })),
      setEventSound: (event, sound) =>
        set((s) => ({ events: { ...s.events, [event]: { ...s.events[event], sound } } })),
      setEventCustom: (event, custom) =>
        set((s) => ({ events: { ...s.events, [event]: { ...s.events[event], custom } } })),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setVolume: (volume) => set({ volume: Math.max(0, Math.min(1, volume)) }),
      resetDefaults: () => set(defaultConfig()),

      saveProfile: (name) => {
        const id = genId();
        const { events, soundEnabled, volume } = get();
        const profile: BatteryProfile = {
          id,
          name: name.trim() || "Untitled",
          config: structuredClone({ events, soundEnabled, volume }),
        };
        set((s) => ({ profiles: [...s.profiles, profile] }));
        return id;
      },
      applyProfile: (id) => {
        const p = get().profiles.find((p) => p.id === id);
        if (!p) return;
        set(structuredClone(p.config));
      },
      deleteProfile: (id) => set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) })),
      renameProfile: (id, name) =>
        set((s) => ({
          profiles: s.profiles.map((p) =>
            p.id === id ? { ...p, name: name.trim() || p.name } : p,
          ),
        })),

      exportConfig: (profileId) => {
        if (profileId) {
          const p = get().profiles.find((p) => p.id === profileId);
          if (p) return JSON.stringify({ nexusBatteryProfile: 2, name: p.name, ...p.config }, null, 2);
        }
        const { events, soundEnabled, volume } = get();
        return JSON.stringify({ nexusBatteryProfile: 2, events, soundEnabled, volume }, null, 2);
      },
      importProfile: (json) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch {
          return { ok: false, error: "That's not valid JSON." };
        }
        if (!parsed || typeof parsed !== "object") {
          return { ok: false, error: "Unexpected file contents." };
        }
        const obj = parsed as Record<string, unknown>;
        const config = sanitizeConfig(obj);
        const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "Imported";
        const id = genId();
        set((s) => ({ profiles: [...s.profiles, { id, name, config }] }));
        return { ok: true, id };
      },
    }),
    {
      name: "nexus.batteryEvents",
      version: 2,
      migrate: (persisted, version) => {
        // v0/v1 → v2: lift the old connect/disconnect-only shape into the map.
        // migrate returns only the persisted slice; zustand re-merges the actions.
        if (version >= 2) return persisted as unknown as BatteryEventsState;
        const old = (persisted ?? {}) as Record<string, unknown>;
        const cfg = defaultConfig();
        if (typeof old.soundEnabled === "boolean") cfg.soundEnabled = old.soundEnabled;
        if (typeof old.volume === "number") cfg.volume = Math.max(0, Math.min(1, old.volume));

        const lift = (
          event: BatteryEvent,
          animKey: string,
          soundKey: string,
          customKey: string,
        ) => {
          const a = old[animKey];
          if (typeof a === "string" && ANIM_IDS.has(a as AnimId)) cfg.events[event].anim = a as AnimId;
          const so = old[soundKey];
          if (typeof so === "string" && SOUND_IDS.has(so as SoundChoice)) {
            cfg.events[event].sound = so as SoundChoice;
          }
          const c = old[customKey];
          if (typeof c === "string" && c.startsWith("data:")) cfg.events[event].custom = c;
        };
        lift("connect", "connectAnim", "connectSound", "connectCustom");
        lift("disconnect", "disconnectAnim", "disconnectSound", "disconnectCustom");

        return { ...cfg, profiles: [] } as unknown as BatteryEventsState;
      },
    },
  ),
);
