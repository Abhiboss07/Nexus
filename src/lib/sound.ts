import type { SoundChoice } from "@/store/battery-events-store";

/**
 * Tiny sound engine for Battery Events. The built-in presets are *synthesized*
 * with Web Audio (no bundled assets — keeps the app light), and "custom" plays a
 * user-supplied wav/ogg/mp3 (stored as a data URL). All playback is best-effort
 * and silent on failure (autoplay policy, no AudioContext, etc.).
 */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

type Note = [freq: number, offset: number, dur: number];

const PRESETS: Record<"chime" | "blip" | "power", { type: OscillatorType; notes: Note[] }> = {
  // Ascending two-note — "plugged in".
  chime: { type: "sine", notes: [[660, 0, 0.13], [988, 0.1, 0.2]] },
  // Single short blip.
  blip: { type: "square", notes: [[880, 0, 0.09]] },
  // Descending — "unplugged / power down".
  power: { type: "sawtooth", notes: [[720, 0, 0.16], [360, 0.12, 0.24]] },
};

function playPreset(name: "chime" | "blip" | "power", volume: number) {
  const ac = audio();
  if (!ac) return;
  const { type, notes } = PRESETS[name];
  const now = ac.currentTime;
  const peak = 0.0001 + 0.32 * Math.max(0, Math.min(1, volume));
  for (const [freq, offset, dur] of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const start = now + offset;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(start);
    osc.stop(start + dur + 0.03);
  }
}

/** Play the configured sound for a battery event. */
export function playSound(choice: SoundChoice, customUrl: string | null, volume: number) {
  if (choice === "none" || volume <= 0) return;
  if (choice === "custom") {
    if (!customUrl) return;
    try {
      const a = new Audio(customUrl);
      a.volume = Math.max(0, Math.min(1, volume));
      void a.play().catch(() => {});
    } catch {
      /* ignore */
    }
    return;
  }
  playPreset(choice, volume);
}
