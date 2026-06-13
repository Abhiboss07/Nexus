import { useEffect, useState } from "react";
import { useThemeStore } from "@/store/theme-store";

/** The eleven effects exposed by the omen-rgb-keyboard driver. */
export type RgbEffect =
  | "static"
  | "breathing"
  | "rainbow"
  | "wave"
  | "pulse"
  | "chase"
  | "sparkle"
  | "candle"
  | "aurora"
  | "disco"
  | "gradient";

const ROWS: string[][] = [
  ["esc", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12", "del"],
  ["`", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "-", "=", "bksp"],
  ["tab", "q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "[", "]", "\\"],
  ["caps", "a", "s", "d", "f", "g", "h", "j", "k", "l", ";", "'", "enter"],
  ["shift", "z", "x", "c", "v", "b", "n", "m", ",", ".", "/", "shiftR"],
  ["ctrl", "win", "alt", "space", "altR", "fn", "ctrlR"],
];

const WIDE: Record<string, number> = {
  bksp: 2, tab: 1.5, "\\": 1.5, caps: 1.75, enter: 2.25, shift: 2.25,
  shiftR: 2.75, space: 6.25, ctrl: 1.25, win: 1.25, alt: 1.25,
  altR: 1.25, fn: 1.25, ctrlR: 1.25,
};

/**
 * Per-key RGB keyboard visualizer — the heart of RGB Studio. Computes each
 * key's HSL color from the active effect + phase, ticked at ~18fps (held still
 * under reduced-motion). Visually exceeds single-zone preview tools by
 * simulating true per-key lighting.
 */
export function KeyboardPreview({
  effect,
  hue,
  brightness,
  speed,
}: {
  effect: RgbEffect;
  hue: number;
  brightness: number;
  speed: number;
}) {
  const reduced = useThemeStore((s) => s.reducedMotion);
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(
      () => setPhase((p) => p + 0.06 * (0.4 + speed / 100)),
      55,
    );
    return () => window.clearInterval(id);
  }, [reduced, speed]);

  const l = 22 + (brightness / 100) * 36;

  function keyColor(row: number, col: number, cols: number): string {
    const pos = cols ? col / cols : 0;
    switch (effect) {
      case "static":
        return `hsl(${hue} 90% ${l}%)`;
      case "breathing": {
        const k = (Math.sin(phase * 1.4) + 1) / 2;
        return `hsl(${hue} 90% ${10 + k * l}%)`;
      }
      case "rainbow":
        return `hsl(${(phase * 40 + pos * 80) % 360} 92% ${l}%)`;
      case "wave":
        return `hsl(${(hue + (pos + row * 0.06) * 160 + phase * 30) % 360} 90% ${l}%)`;
      case "pulse": {
        // Sharper, faster breathing.
        const k = Math.pow((Math.sin(phase * 2.6) + 1) / 2, 2);
        return `hsl(${hue} 95% ${8 + k * l}%)`;
      }
      case "chase": {
        // A bright band sweeps across columns.
        const head = (phase * 0.6) % 1;
        const d = Math.abs(((pos - head + 1) % 1));
        const lit = Math.max(0, 1 - d * 4);
        return `hsl(${hue} 90% ${8 + lit * l}%)`;
      }
      case "sparkle": {
        const tw = Math.sin(phase * 3 + row * 12.9 + col * 78.2);
        const lit = tw > 0.75 ? (tw - 0.75) * 4 : 0;
        return `hsl(${hue} 80% ${6 + lit * l}%)`;
      }
      case "candle": {
        // Warm flicker around the chosen hue.
        const flick = (Math.sin(phase * 5 + col * 2.1) + Math.sin(phase * 8 + row)) / 2;
        return `hsl(${hue + flick * 8} 85% ${l * (0.7 + flick * 0.2)}%)`;
      }
      case "aurora": {
        const h = (hue + Math.sin(pos * 4 + phase) * 60 + Math.cos(row + phase * 0.7) * 40) % 360;
        return `hsl(${(h + 360) % 360} 85% ${l}%)`;
      }
      case "disco": {
        // Rapid random color per key.
        const seed = Math.floor(phase * 4) + row * 31 + col * 7;
        return `hsl(${(seed * 47) % 360} 95% ${l}%)`;
      }
      case "gradient":
        return `hsl(${(hue + pos * 120) % 360} 90% ${l}%)`;
      default:
        return `hsl(${hue} 90% ${l}%)`;
    }
  }

  return (
    <div className="select-none rounded-xl bg-black/40 p-md ring-1 ring-inset ring-white/5">
      <div className="space-y-[6px]">
        {ROWS.map((row, r) => (
          <div key={r} className="flex gap-[6px]">
            {row.map((key, c) => {
              const color = keyColor(r, c, row.length - 1);
              return (
                <div
                  key={key}
                  className="grid h-7 place-items-center rounded-[5px] text-[8px] font-medium text-white/40 transition-[background] duration-150"
                  style={{
                    flex: WIDE[key] ?? 1,
                    background: color,
                    boxShadow: `0 0 10px -2px ${color}, inset 0 1px 0 rgb(255 255 255 / 0.15)`,
                  }}
                >
                  {key.length <= 4 && !WIDE[key] ? key.toUpperCase() : ""}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
