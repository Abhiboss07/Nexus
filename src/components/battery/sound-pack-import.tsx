import { useRef, useState } from "react";
import { Package, Play, X, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { playSound } from "@/lib/sound";
import { readAudioFile, guessEvent } from "@/lib/sound-pack";
import { pushToast } from "@/store/toast-store";
import { useBatteryEventsStore, BATTERY_EVENTS, type BatteryEvent } from "@/store/battery-events-store";

type Slot = BatteryEvent | "skip";

interface Entry {
  name: string;
  url: string;
  event: Slot;
}

/**
 * Import a local "sound pack" — pick several audio files (or a folder) at once;
 * each is matched to a battery event by filename, with editable mapping. Applying
 * assigns them as the events' custom sounds. No CDN, no persisted pack library:
 * save a profile afterwards to keep the set as a reusable preset.
 */
export function SoundPackImport() {
  const applySoundPack = useBatteryEventsStore((s) => s.applySoundPack);
  const volume = useBatteryEventsStore((s) => s.volume);
  const fileRef = useRef<HTMLInputElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length === 0) return;
    const next: Entry[] = [];
    const errs: string[] = [];
    for (const f of files) {
      if (!f.type.startsWith("audio/") && !/\.(wav|mp3|ogg|flac)$/i.test(f.name)) continue;
      try {
        next.push({ name: f.name, url: await readAudioFile(f), event: guessEvent(f.name) ?? "skip" });
      } catch (ex) {
        errs.push(`${f.name}: ${ex instanceof Error ? ex.message : ex}`);
      }
    }
    setEntries(next);
    setErr(errs.length ? errs.join(" · ") : next.length === 0 ? "No supported audio files found." : null);
  }

  const setSlot = (i: number, event: Slot) =>
    setEntries((es) => es.map((e, k) => (k === i ? { ...e, event } : e)));

  const apply = () => {
    // Last file wins if two map to the same event.
    const mapped = entries.filter((e) => e.event !== "skip").map((e) => ({ event: e.event as BatteryEvent, url: e.url }));
    if (mapped.length === 0) {
      setErr("Map at least one file to an event.");
      return;
    }
    applySoundPack(mapped);
    setEntries([]);
    setErr(null);
    pushToast({ tone: "success", icon: "info", title: "Sound pack applied", body: `${mapped.length} sound${mapped.length > 1 ? "s" : ""} assigned` });
  };

  return (
    <div className="space-y-sm rounded-lg border border-border-subtle bg-surface-sunken/30 p-md">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-xs text-xs font-medium text-content-muted">
          <Package className="h-3.5 w-3.5" /> Sound packs
        </span>
        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
          <Package className="h-3.5 w-3.5" /> Import pack
        </Button>
      </div>

      {entries.length === 0 ? (
        <p className="text-2xs text-content-subtle">
          Pick several audio files at once — Nexus maps each to an event by name (e.g. <code>connect.mp3</code>, <code>low.wav</code>). Save a
          profile afterwards to keep the set.
        </p>
      ) : (
        <div className="space-y-xs">
          {entries.map((e, i) => (
            <div key={i} className="flex items-center gap-xs">
              <span className="min-w-0 flex-1 truncate text-2xs text-content" title={e.name}>
                {e.name}
              </span>
              <button
                onClick={() => playSound("custom", e.url, volume)}
                className="rounded-md border border-border p-1 text-content-subtle transition-colors hover:text-content"
                title="Preview"
              >
                <Play className="h-3 w-3" />
              </button>
              <select
                value={e.event}
                onChange={(ev) => setSlot(i, ev.target.value as Slot)}
                className="rounded-md border border-border bg-surface-sunken px-sm py-1 text-2xs text-content outline-none focus:border-accent/60"
              >
                {BATTERY_EVENTS.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
                <option value="skip">Skip</option>
              </select>
            </div>
          ))}
          <div className="flex items-center gap-xs pt-1">
            <Button size="sm" onClick={apply}>
              <Check className="h-3.5 w-3.5" /> Apply pack
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEntries([]); setErr(null); }}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          </div>
        </div>
      )}

      {err && <p className="text-2xs text-danger">{err}</p>}
      <input ref={fileRef} type="file" accept="audio/*,.wav,.ogg,.mp3,.flac" multiple hidden onChange={pick} />
    </div>
  );
}
