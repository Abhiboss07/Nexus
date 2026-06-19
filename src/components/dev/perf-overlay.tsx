import { useEffect, useRef, useState } from "react";
import { usePrefsStore } from "@/store/prefs-store";

/**
 * User-facing performance overlay (Settings → Diagnostics). Measures real frame
 * rate + worst frame time via requestAnimationFrame. Renders nothing — and runs
 * no loop — unless explicitly enabled.
 */
export function PerfOverlay() {
  const enabled = usePrefsStore((s) => s.perfOverlay);
  const [fps, setFps] = useState(0);
  const [worstMs, setWorstMs] = useState(0);
  const raf = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    let frames = 0;
    let windowStart = performance.now();
    let prev = windowStart;
    let worst = 0;
    const loop = (t: number) => {
      frames++;
      const dt = t - prev;
      prev = t;
      if (dt > worst) worst = dt;
      if (t - windowStart >= 1000) {
        setFps(Math.round((frames * 1000) / (t - windowStart)));
        setWorstMs(Math.round(worst * 10) / 10);
        frames = 0;
        worst = 0;
        windowStart = t;
      }
      raf.current = requestAnimationFrame(loop);
    };
    raf.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf.current);
  }, [enabled]);

  if (!enabled) return null;
  const tone = fps >= 55 ? "#34d399" : fps >= 30 ? "#fbbf24" : "#f87171";
  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        left: 8,
        zIndex: 99998,
        font: "11px/1.3 ui-monospace, monospace",
        background: "rgba(10,10,14,0.82)",
        color: "#cdd6f4",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        padding: "6px 9px",
        pointerEvents: "none",
        userSelect: "none",
        backdropFilter: "blur(4px)",
      }}
    >
      <div style={{ color: tone, fontWeight: 700 }}>{fps} FPS</div>
      <div style={{ opacity: 0.7 }}>worst {worstMs}ms</div>
    </div>
  );
}
