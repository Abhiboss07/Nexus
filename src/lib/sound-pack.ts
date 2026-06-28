import { MAX_CUSTOM_SOUND_BYTES, type BatteryEvent } from "@/store/battery-events-store";

/** Read an audio File into a data URL, enforcing the per-file size cap. */
export function readAudioFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_CUSTOM_SOUND_BYTES) {
      reject(new Error("File too large — max 1 MB."));
      return;
    }
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

/**
 * Guess which battery event a pack file belongs to from its name. Ordered most-
 * specific first so "fast-charge.mp3" beats the generic "charge" → connect rule,
 * and "unplug.wav" maps to disconnect before connect's "plug" can claim it.
 */
const MATCHERS: { event: BatteryEvent; keys: string[] }[] = [
  { event: "fastCharge", keys: ["fast"] },
  { event: "slowCharge", keys: ["slow", "trickle"] },
  { event: "full", keys: ["full", "charged", "complete", "100"] },
  { event: "critical", keys: ["critical", "crit", "danger", "empty"] },
  { event: "low", keys: ["low", "warn"] },
  { event: "disconnect", keys: ["disconnect", "unplug", "discharge", "battery", "off"] },
  { event: "connect", keys: ["connect", "plug", "charging", "charger", "charge", "ac", "on"] },
];

export function guessEvent(filename: string): BatteryEvent | null {
  const n = filename.toLowerCase();
  for (const m of MATCHERS) {
    if (m.keys.some((k) => n.includes(k))) return m.event;
  }
  return null;
}
