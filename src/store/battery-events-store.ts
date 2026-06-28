import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * Battery Events preferences — how Nexus reacts to power-supply transitions.
 *
 * Persisted under `nexus.batteryEvents`. Schema history:
 *   v1 — AC connect/disconnect only.
 *   v2 — per-event config map (connect/fast/slow/full/disconnect/low/critical)
 *        + saveable profiles.
 *   v3 — a custom-effect library: events may reference a composed CustomEffect
 *        (layered animation) instead of a built-in anim.
 *
 * Each event owns an animation (built-in or a custom effect), a sound and an
 * optional custom-audio data URL.
 */

/**
 * Built-in animation set. The *continuous* anims drive the charging glow/shimmer
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

/* ----------------------------- Custom effects ----------------------------- */

/** Composable layer primitives the BatteryGlyph can render. */
export type LayerType = "glow" | "pulse" | "shimmer" | "ripple" | "flash" | "drain" | "spark";

export const LAYER_TYPES: { id: LayerType; label: string }[] = [
  { id: "glow", label: "Glow" },
  { id: "pulse", label: "Pulse" },
  { id: "shimmer", label: "Shimmer" },
  { id: "ripple", label: "Ripple" },
  { id: "flash", label: "Flash" },
  { id: "drain", label: "Drain" },
  { id: "spark", label: "Sparks" },
];

export type EaseId = "linear" | "easeIn" | "easeOut" | "easeInOut" | "bounce" | "elastic";

export const EASES: { id: EaseId; label: string }[] = [
  { id: "linear", label: "Linear" },
  { id: "easeIn", label: "Ease In" },
  { id: "easeOut", label: "Ease Out" },
  { id: "easeInOut", label: "Ease In·Out" },
  { id: "bounce", label: "Bounce" },
  { id: "elastic", label: "Elastic" },
];

/** Palette tokens a layer can be tinted with ("tone" = charge-band colour). */
export type ColorToken = "tone" | "accent" | "iris" | "success" | "warning" | "danger" | "white";

export const COLOR_TOKENS: { id: ColorToken; label: string }[] = [
  { id: "tone", label: "Charge tone" },
  { id: "accent", label: "Accent" },
  { id: "iris", label: "Iris" },
  { id: "success", label: "Green" },
  { id: "warning", label: "Amber" },
  { id: "danger", label: "Red" },
  { id: "white", label: "White" },
];

export interface EffectLayer {
  id: string;
  type: LayerType;
  delay: number; // ms before the layer starts
  duration: number; // ms
  ease: EaseId;
  color: ColorToken;
  intensity: number; // 0–1
  repeat: boolean; // loop continuously vs play once
}

export interface CustomEffect {
  id: string;
  name: string;
  layers: EffectLayer[];
}

const LAYER_TYPE_SET = new Set<LayerType>(["glow", "pulse", "shimmer", "ripple", "flash", "drain", "spark"]);
const EASE_SET = new Set<EaseId>(["linear", "easeIn", "easeOut", "easeInOut", "bounce", "elastic"]);
const COLOR_SET = new Set<ColorToken>(["tone", "accent", "iris", "success", "warning", "danger", "white"]);

export function defaultLayer(type: LayerType): EffectLayer {
  const continuous = type === "glow" || type === "pulse" || type === "shimmer";
  return {
    id: genId(),
    type,
    delay: 0,
    duration: continuous ? 1400 : 700,
    ease: "easeInOut",
    color: "tone",
    intensity: 0.6,
    repeat: continuous,
  };
}

/* -------------------------------- Sounds ---------------------------------- */

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

/**
 * Per-event sound DSP. Times are in ms; pitch in semitones (−12…+12); speed is a
 * playback-rate multiplier (0.5…2). Trim applies to custom files (`trimEnd === 0`
 * means "to the end"). Fades apply to custom files and the synth master.
 */
export interface SoundFx {
  fadeIn: number;
  fadeOut: number;
  trimStart: number;
  trimEnd: number;
  pitch: number;
  speed: number;
  delay: number;
  repeat: number;
}

export function defaultFx(): SoundFx {
  return { fadeIn: 0, fadeOut: 0, trimStart: 0, trimEnd: 0, pitch: 0, speed: 1, delay: 0, repeat: 1 };
}

/* -------------------------------- Events ---------------------------------- */

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
  /** Built-in animation (used when `effectId` is null). */
  anim: AnimId;
  /** When set, a custom effect from the library overrides `anim`. */
  effectId: string | null;
  sound: SoundChoice;
  /** Data URL for a user-supplied sound (null when unset). */
  custom: string | null;
  /** Sound DSP applied to this event's sound. */
  fx: SoundFx;
}

/** The portable per-profile configuration. */
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
  connect: { anim: "electric", effectId: null, sound: "chime", custom: null, fx: defaultFx() },
  fastCharge: { anim: "neon", effectId: null, sound: "blip", custom: null, fx: defaultFx() },
  slowCharge: { anim: "pulse", effectId: null, sound: "none", custom: null, fx: defaultFx() },
  full: { anim: "fade", effectId: null, sound: "chime", custom: null, fx: defaultFx() },
  disconnect: { anim: "ripple", effectId: null, sound: "power", custom: null, fx: defaultFx() },
  low: { anim: "fade", effectId: null, sound: "blip", custom: null, fx: defaultFx() },
  critical: { anim: "drain", effectId: null, sound: "power", custom: null, fx: defaultFx() },
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
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function sanitizeFx(raw: unknown): SoundFx {
  const fx = defaultFx();
  if (!raw || typeof raw !== "object") return fx;
  const r = raw as Partial<SoundFx>;
  const num = (v: unknown, lo: number, hi: number, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
  fx.fadeIn = num(r.fadeIn, 0, 5000, fx.fadeIn);
  fx.fadeOut = num(r.fadeOut, 0, 5000, fx.fadeOut);
  fx.trimStart = num(r.trimStart, 0, 10000, fx.trimStart);
  fx.trimEnd = num(r.trimEnd, 0, 10000, fx.trimEnd);
  fx.pitch = num(r.pitch, -12, 12, fx.pitch);
  fx.speed = num(r.speed, 0.5, 2, fx.speed);
  fx.delay = num(r.delay, 0, 5000, fx.delay);
  fx.repeat = Math.round(num(r.repeat, 1, 5, fx.repeat));
  return fx;
}

/** Coerce arbitrary parsed JSON into a valid config, falling back to defaults. */
function sanitizeConfig(raw: unknown): BatteryEventsConfig {
  const base = defaultConfig();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Partial<BatteryEventsConfig>;

  if (typeof r.soundEnabled === "boolean") base.soundEnabled = r.soundEnabled;
  if (typeof r.volume === "number" && Number.isFinite(r.volume)) base.volume = clamp01(r.volume);

  if (r.events && typeof r.events === "object") {
    for (const { id } of BATTERY_EVENTS) {
      const e = (r.events as Record<string, unknown>)[id];
      if (!e || typeof e !== "object") continue;
      const ev = e as Partial<EventConfig>;
      if (ev.anim && ANIM_IDS.has(ev.anim)) base.events[id].anim = ev.anim;
      if (ev.sound && SOUND_IDS.has(ev.sound)) base.events[id].sound = ev.sound;
      if (typeof ev.effectId === "string") base.events[id].effectId = ev.effectId;
      if (typeof ev.custom === "string" && ev.custom.startsWith("data:")) base.events[id].custom = ev.custom;
      if (ev.fx) base.events[id].fx = sanitizeFx(ev.fx);
    }
  }
  return base;
}

function sanitizeLayer(raw: unknown): EffectLayer | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<EffectLayer>;
  if (!r.type || !LAYER_TYPE_SET.has(r.type)) return null;
  const base = defaultLayer(r.type);
  if (typeof r.id === "string") base.id = r.id;
  if (typeof r.delay === "number" && Number.isFinite(r.delay)) base.delay = Math.max(0, Math.min(5000, r.delay));
  if (typeof r.duration === "number" && Number.isFinite(r.duration)) {
    base.duration = Math.max(100, Math.min(8000, r.duration));
  }
  if (r.ease && EASE_SET.has(r.ease)) base.ease = r.ease;
  if (r.color && COLOR_SET.has(r.color)) base.color = r.color;
  if (typeof r.intensity === "number" && Number.isFinite(r.intensity)) base.intensity = clamp01(r.intensity);
  if (typeof r.repeat === "boolean") base.repeat = r.repeat;
  return base;
}

function sanitizeEffects(raw: unknown): CustomEffect[] {
  if (!Array.isArray(raw)) return [];
  const out: CustomEffect[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Partial<CustomEffect>;
    if (typeof e.id !== "string" || typeof e.name !== "string") continue;
    const layers = Array.isArray(e.layers)
      ? e.layers.map(sanitizeLayer).filter((l): l is EffectLayer => l !== null)
      : [];
    out.push({ id: e.id, name: e.name, layers });
  }
  return out;
}

interface BatteryEventsState extends BatteryEventsConfig {
  profiles: BatteryProfile[];
  customEffects: CustomEffect[];

  setEventAnim: (event: BatteryEvent, anim: AnimId) => void;
  setEventEffect: (event: BatteryEvent, effectId: string | null) => void;
  setEventSound: (event: BatteryEvent, sound: SoundChoice) => void;
  setEventCustom: (event: BatteryEvent, url: string | null) => void;
  setEventFx: (event: BatteryEvent, patch: Partial<SoundFx>) => void;
  /** Bulk-assign custom sounds to events (sound-pack import). */
  applySoundPack: (entries: { event: BatteryEvent; url: string }[]) => void;
  setSoundEnabled: (v: boolean) => void;
  setVolume: (v: number) => void;
  resetDefaults: () => void;

  // Custom-effect library
  createEffect: (name: string) => string;
  renameEffect: (id: string, name: string) => void;
  deleteEffect: (id: string) => void;
  addLayer: (effectId: string, type: LayerType) => void;
  updateLayer: (effectId: string, layerId: string, patch: Partial<EffectLayer>) => void;
  removeLayer: (effectId: string, layerId: string) => void;
  moveLayer: (effectId: string, layerId: string, dir: -1 | 1) => void;

  saveProfile: (name: string) => string;
  applyProfile: (id: string) => void;
  deleteProfile: (id: string) => void;
  renameProfile: (id: string, name: string) => void;

  /** Serialise the live config (or a saved profile) + effect library to JSON. */
  exportConfig: (profileId?: string) => string;
  /** Parse + validate a JSON config, merge any effects, add it as a profile. */
  importProfile: (json: string) => { ok: true; id: string } | { ok: false; error: string };
}

const mapEffect = (
  effects: CustomEffect[],
  id: string,
  fn: (e: CustomEffect) => CustomEffect,
): CustomEffect[] => effects.map((e) => (e.id === id ? fn(e) : e));

export const useBatteryEventsStore = create<BatteryEventsState>()(
  persist(
    (set, get) => ({
      ...defaultConfig(),
      profiles: [],
      customEffects: [],

      setEventAnim: (event, anim) =>
        set((s) => ({ events: { ...s.events, [event]: { ...s.events[event], anim, effectId: null } } })),
      setEventEffect: (event, effectId) =>
        set((s) => ({ events: { ...s.events, [event]: { ...s.events[event], effectId } } })),
      setEventSound: (event, sound) =>
        set((s) => ({ events: { ...s.events, [event]: { ...s.events[event], sound } } })),
      setEventCustom: (event, custom) =>
        set((s) => ({ events: { ...s.events, [event]: { ...s.events[event], custom } } })),
      setEventFx: (event, patch) =>
        set((s) => ({ events: { ...s.events, [event]: { ...s.events[event], fx: { ...s.events[event].fx, ...patch } } } })),
      applySoundPack: (entries) =>
        set((s) => {
          const events = { ...s.events };
          for (const { event, url } of entries) {
            events[event] = { ...events[event], sound: "custom", custom: url };
          }
          return { events };
        }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setVolume: (volume) => set({ volume: clamp01(volume) }),
      resetDefaults: () => set({ ...defaultConfig() }),

      createEffect: (name) => {
        const id = genId();
        const effect: CustomEffect = {
          id,
          name: name.trim() || "Custom effect",
          layers: [defaultLayer("glow")],
        };
        set((s) => ({ customEffects: [...s.customEffects, effect] }));
        return id;
      },
      renameEffect: (id, name) =>
        set((s) => ({ customEffects: mapEffect(s.customEffects, id, (e) => ({ ...e, name: name.trim() || e.name })) })),
      deleteEffect: (id) =>
        set((s) => ({
          customEffects: s.customEffects.filter((e) => e.id !== id),
          // Clear any event still pointing at the deleted effect.
          events: Object.fromEntries(
            Object.entries(s.events).map(([k, v]) => [k, v.effectId === id ? { ...v, effectId: null } : v]),
          ) as Record<BatteryEvent, EventConfig>,
        })),
      addLayer: (effectId, type) =>
        set((s) => ({
          customEffects: mapEffect(s.customEffects, effectId, (e) => ({ ...e, layers: [...e.layers, defaultLayer(type)] })),
        })),
      updateLayer: (effectId, layerId, patch) =>
        set((s) => ({
          customEffects: mapEffect(s.customEffects, effectId, (e) => ({
            ...e,
            layers: e.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)),
          })),
        })),
      removeLayer: (effectId, layerId) =>
        set((s) => ({
          customEffects: mapEffect(s.customEffects, effectId, (e) => ({
            ...e,
            layers: e.layers.filter((l) => l.id !== layerId),
          })),
        })),
      moveLayer: (effectId, layerId, dir) =>
        set((s) => ({
          customEffects: mapEffect(s.customEffects, effectId, (e) => {
            const i = e.layers.findIndex((l) => l.id === layerId);
            const j = i + dir;
            if (i < 0 || j < 0 || j >= e.layers.length) return e;
            const layers = [...e.layers];
            [layers[i], layers[j]] = [layers[j], layers[i]];
            return { ...e, layers };
          }),
        })),

      saveProfile: (name) => {
        const id = genId();
        const { events, soundEnabled, volume } = get();
        set((s) => ({
          profiles: [
            ...s.profiles,
            { id, name: name.trim() || "Untitled", config: structuredClone({ events, soundEnabled, volume }) },
          ],
        }));
        return id;
      },
      applyProfile: (id) => {
        const p = get().profiles.find((p) => p.id === id);
        if (p) set(structuredClone(p.config));
      },
      deleteProfile: (id) => set((s) => ({ profiles: s.profiles.filter((p) => p.id !== id) })),
      renameProfile: (id, name) =>
        set((s) => ({
          profiles: s.profiles.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p)),
        })),

      exportConfig: (profileId) => {
        const { events, soundEnabled, volume, customEffects, profiles } = get();
        const cfg = profileId ? profiles.find((p) => p.id === profileId)?.config : { events, soundEnabled, volume };
        const name = profileId ? profiles.find((p) => p.id === profileId)?.name : undefined;
        const payload = { nexusBatteryProfile: 3, ...(name ? { name } : {}), ...(cfg ?? { events, soundEnabled, volume }), customEffects };
        return JSON.stringify(payload, null, 2);
      },
      importProfile: (json) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(json);
        } catch {
          return { ok: false, error: "That's not valid JSON." };
        }
        if (!parsed || typeof parsed !== "object") return { ok: false, error: "Unexpected file contents." };
        const obj = parsed as Record<string, unknown>;
        const config = sanitizeConfig(obj);
        const incoming = sanitizeEffects(obj.customEffects);
        const name = typeof obj.name === "string" && obj.name.trim() ? obj.name.trim() : "Imported";
        const id = genId();
        set((s) => {
          // Merge in any effects this profile references that we don't have yet.
          const have = new Set(s.customEffects.map((e) => e.id));
          const merged = [...s.customEffects, ...incoming.filter((e) => !have.has(e.id))];
          return { customEffects: merged, profiles: [...s.profiles, { id, name, config }] };
        });
        return { ok: true, id };
      },
    }),
    {
      name: "nexus.batteryEvents",
      version: 4,
      migrate: (persisted, version) => {
        const old = (persisted ?? {}) as Record<string, unknown>;
        const cfg = defaultConfig();
        if (typeof old.soundEnabled === "boolean") cfg.soundEnabled = old.soundEnabled;
        if (typeof old.volume === "number") cfg.volume = clamp01(old.volume);

        if (version < 2) {
          // v0/v1 → lift the old connect/disconnect-only shape into the map.
          const lift = (event: BatteryEvent, animKey: string, soundKey: string, customKey: string) => {
            const a = old[animKey];
            if (typeof a === "string" && ANIM_IDS.has(a as AnimId)) cfg.events[event].anim = a as AnimId;
            const so = old[soundKey];
            if (typeof so === "string" && SOUND_IDS.has(so as SoundChoice)) cfg.events[event].sound = so as SoundChoice;
            const c = old[customKey];
            if (typeof c === "string" && c.startsWith("data:")) cfg.events[event].custom = c;
          };
          lift("connect", "connectAnim", "connectSound", "connectCustom");
          lift("disconnect", "disconnectAnim", "disconnectSound", "disconnectCustom");
        } else if (old.events && typeof old.events === "object") {
          // v2 → carry events forward; sanitize fills in the new effectId field.
          cfg.events = sanitizeConfig({ events: old.events, soundEnabled: cfg.soundEnabled, volume: cfg.volume }).events;
        }

        const profiles = Array.isArray(old.profiles) ? (old.profiles as BatteryProfile[]) : [];
        const customEffects = sanitizeEffects(old.customEffects);
        return { ...cfg, profiles, customEffects } as unknown as BatteryEventsState;
      },
    },
  ),
);
