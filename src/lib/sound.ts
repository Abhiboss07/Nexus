import { type SoundChoice, type SoundFx, defaultFx } from "@/store/battery-events-store";

/**
 * Sound engine for Battery Events. Built-in presets are *synthesised* with Web
 * Audio (no bundled assets); "custom" decodes a user wav/ogg/mp3 (data URL) into
 * an AudioBuffer and plays it through a BufferSource. Both paths honour the
 * per-event SoundFx (fade in/out, trim, pitch, speed, delay, repeat). All
 * playback is best-effort and silent on failure (autoplay policy, no
 * AudioContext, undecodable file, …).
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

const clampVol = (v: number) => Math.max(0, Math.min(1, v));

type Note = [freq: number, offset: number, dur: number];

const PRESETS: Record<"chime" | "blip" | "power", { type: OscillatorType; notes: Note[] }> = {
  // Ascending two-note — "plugged in".
  chime: { type: "sine", notes: [[660, 0, 0.13], [988, 0.1, 0.2]] },
  // Single short blip.
  blip: { type: "square", notes: [[880, 0, 0.09]] },
  // Descending — "unplugged / power down".
  power: { type: "sawtooth", notes: [[720, 0, 0.16], [360, 0.12, 0.24]] },
};

/** Semitones → frequency multiplier. */
const semis = (n: number) => Math.pow(2, n / 12);

/** Schedule one rendering of a synth preset starting at absolute time `at`; returns its length in seconds. */
function playPresetAt(ac: AudioContext, name: "chime" | "blip" | "power", at: number, volume: number, fx: SoundFx): number {
  const { type, notes } = PRESETS[name];
  const peak = 0.0001 + 0.32 * clampVol(volume);
  const rate = fx.speed; // compress/stretch the note timeline
  const pitch = semis(fx.pitch);
  let length = 0;
  for (const [freq, offset, dur] of notes) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.value = freq * pitch;
    const start = at + offset / rate;
    const d = dur / rate;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.linearRampToValueAtTime(peak, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + d);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(start);
    osc.stop(start + d + 0.03);
    length = Math.max(length, offset / rate + d);
  }
  return length;
}

const bufferCache = new Map<string, AudioBuffer>();

/** Decode an audio data URL into a cached AudioBuffer (for waveform rendering). */
export async function decodeAudioUrl(url: string): Promise<AudioBuffer | null> {
  const ac = audio();
  if (!ac) return null;
  return decode(ac, url);
}

async function decode(ac: AudioContext, url: string): Promise<AudioBuffer | null> {
  const cached = bufferCache.get(url);
  if (cached) return cached;
  try {
    const res = await fetch(url); // data: URLs resolve synchronously-ish
    const arr = await res.arrayBuffer();
    const buf = await ac.decodeAudioData(arr);
    bufferCache.set(url, buf);
    return buf;
  } catch {
    return null;
  }
}

/** Schedule one rendering of a decoded buffer starting at `at`; returns its real length in seconds. */
function playBufferAt(ac: AudioContext, buf: AudioBuffer, at: number, volume: number, fx: SoundFx): number {
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = fx.speed;
  src.detune.value = fx.pitch * 100; // cents

  const offset = Math.min(fx.trimStart / 1000, buf.duration);
  const end = fx.trimEnd > 0 ? Math.min(fx.trimEnd / 1000, buf.duration) : buf.duration;
  const bufSpan = Math.max(0, end - offset);
  // Real wall-clock length: trimmed buffer span divided by the effective rate.
  const effRate = fx.speed * semis(fx.pitch);
  const real = bufSpan / (effRate || 1);

  const gain = ac.createGain();
  const vol = clampVol(volume);
  const fadeIn = Math.min(fx.fadeIn / 1000, real);
  const fadeOut = Math.min(fx.fadeOut / 1000, real);
  if (fadeIn > 0) {
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(vol, at + fadeIn);
  } else {
    gain.gain.setValueAtTime(vol, at);
  }
  if (fadeOut > 0) {
    gain.gain.setValueAtTime(vol, Math.max(at + fadeIn, at + real - fadeOut));
    gain.gain.linearRampToValueAtTime(0.0001, at + real);
  }

  src.connect(gain);
  gain.connect(ac.destination);
  src.start(at, offset, bufSpan);
  return real;
}

/** Play the configured sound for a battery event, applying its DSP. */
export function playSound(choice: SoundChoice, customUrl: string | null, volume: number, fx: SoundFx = defaultFx()) {
  if (choice === "none" || volume <= 0) return;
  const ac = audio();
  if (!ac) return;

  const repeat = Math.max(1, Math.min(5, Math.round(fx.repeat)));
  const gap = 0.06;
  const base = ac.currentTime + fx.delay / 1000;

  if (choice === "custom") {
    if (!customUrl) return;
    void decode(ac, customUrl).then((buf) => {
      if (!buf) return;
      let at = Math.max(base, ac.currentTime); // re-anchor after async decode
      for (let i = 0; i < repeat; i++) {
        const len = playBufferAt(ac, buf, at, volume, fx);
        at += len + gap;
      }
    });
    return;
  }

  let at = base;
  for (let i = 0; i < repeat; i++) {
    const len = playPresetAt(ac, choice, at, volume, fx);
    at += len + gap;
  }
}
