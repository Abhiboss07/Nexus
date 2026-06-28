import { useEffect, useRef, useState } from "react";
import { decodeAudioUrl } from "@/lib/sound";

/**
 * Visual trim editor: decodes the custom sound, draws its waveform as peak bars,
 * and overlays a draggable trim region. Dragging a handle updates trimStart /
 * trimEnd (ms). Everything is local to the Battery Events settings — no telemetry
 * impact. Decode is cached, so re-opening the editor is instant.
 */
export function WaveformTrim({
  url,
  trimStart,
  trimEnd,
  onChange,
}: {
  url: string;
  trimStart: number;
  trimEnd: number;
  onChange: (patch: { trimStart?: number; trimEnd?: number }) => void;
}) {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [durMs, setDurMs] = useState(0);
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<null | "start" | "end">(null);

  useEffect(() => {
    let alive = true;
    setPeaks(null);
    setDurMs(0);
    decodeAudioUrl(url).then((buf) => {
      if (!alive || !buf) return;
      setDurMs(buf.duration * 1000);
      setPeaks(computePeaks(buf, 72));
    });
    return () => {
      alive = false;
    };
  }, [url]);

  const endMs = trimEnd > 0 ? trimEnd : durMs;
  const startPct = durMs ? Math.min(100, (trimStart / durMs) * 100) : 0;
  const endPct = durMs ? Math.min(100, (endMs / durMs) * 100) : 100;

  // Drag state read through a ref so the window listeners see fresh values.
  const st = useRef({ durMs, trimStart, endMs, onChange });
  st.current = { durMs, trimStart, endMs, onChange };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const cur = st.current;
      if (!drag.current || !cur.durMs || !wrap.current) return;
      const r = wrap.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const ms = Math.round((x * cur.durMs) / 10) * 10;
      if (drag.current === "start") cur.onChange({ trimStart: Math.max(0, Math.min(ms, cur.endMs - 50)) });
      else cur.onChange({ trimEnd: Math.min(cur.durMs, Math.max(ms, cur.trimStart + 50)) });
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);

  const start = (which: "start" | "end") => (e: React.PointerEvent) => {
    e.preventDefault();
    drag.current = which;
  };

  if (!peaks) {
    return (
      <div className="flex h-12 items-center justify-center rounded-md border border-border-subtle bg-surface-sunken/40 text-2xs text-content-subtle">
        Decoding waveform…
      </div>
    );
  }

  return (
    <div>
      <div ref={wrap} className="relative flex h-12 select-none items-end gap-px overflow-hidden rounded-md border border-border-subtle bg-surface-sunken/40 px-1">
        {peaks.map((p, i) => {
          const at = (i / peaks.length) * 100;
          const inRegion = at >= startPct && at <= endPct;
          return (
            <div
              key={i}
              className="flex-1 rounded-sm"
              style={{
                height: `${Math.max(6, p * 100)}%`,
                background: inRegion ? "rgb(var(--color-accent) / 0.8)" : "rgb(var(--color-content-subtle) / 0.3)",
              }}
            />
          );
        })}

        {/* dimmed cut regions */}
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-canvas/55" style={{ width: `${startPct}%` }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-canvas/55" style={{ width: `${100 - endPct}%` }} />

        {/* handles */}
        <Handle pct={startPct} onPointerDown={start("start")} />
        <Handle pct={endPct} onPointerDown={start("end")} />
      </div>
      <div className="mt-1 flex justify-between text-2xs tabular-nums text-content-subtle">
        <span>{(trimStart / 1000).toFixed(2)}s</span>
        <span>{(durMs / 1000).toFixed(2)}s total</span>
        <span>{(endMs / 1000).toFixed(2)}s</span>
      </div>
    </div>
  );
}

function Handle({ pct, onPointerDown }: { pct: number; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className="absolute inset-y-0 z-10 -ml-1.5 w-3 cursor-ew-resize"
      style={{ left: `${pct}%` }}
    >
      <div className="mx-auto h-full w-0.5 bg-accent" />
      <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent bg-canvas" />
    </div>
  );
}

function computePeaks(buf: AudioBuffer, n: number): number[] {
  const ch = buf.getChannelData(0);
  const block = Math.floor(ch.length / n) || 1;
  const peaks: number[] = [];
  let max = 0.0001;
  for (let i = 0; i < n; i++) {
    let p = 0;
    const startIdx = i * block;
    for (let j = 0; j < block; j++) {
      const v = Math.abs(ch[startIdx + j] ?? 0);
      if (v > p) p = v;
    }
    peaks.push(p);
    if (p > max) max = p;
  }
  return peaks.map((p) => p / max);
}
