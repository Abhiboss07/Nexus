import { useEffect, useRef, useState } from "react";

/**
 * Dev-only render diagnostics.
 *
 * `useRenderCount("Name")` tallies how many times a component commits; the
 * `<RenderCountOverlay/>` displays the live tally (sorted, highest first) so you
 * can spot components re-rendering more than expected — e.g. a card that should
 * be static but re-renders on every 1.5s telemetry tick.
 *
 * Counting happens in an effect (one per commit) rather than during render, so
 * the overlay's own re-renders never inflate other components' counts. The whole
 * module is a no-op in production builds (guarded by `import.meta.env.DEV`).
 */

const counts = new Map<string, number>();

// Expose for headless measurement (dev only): read via window.__renderCounts.
if (typeof window !== "undefined" && import.meta.env.DEV) {
  (window as unknown as { __renderCounts?: Map<string, number> }).__renderCounts = counts;
}

export function useRenderCount(name: string) {
  // Runs after every commit of the calling component (no dep array).
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  });
}

export function RenderCountOverlay() {
  const [, force] = useState(0);
  const [open, setOpen] = useState(true);
  const mounted = useRef(false);

  // Poll the tally a few times a second instead of subscribing per-increment —
  // keeps the overlay decoupled from the components it measures.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    mounted.current = true;
    const id = window.setInterval(() => force((n) => n + 1), 500);
    return () => window.clearInterval(id);
  }, []);

  if (!import.meta.env.DEV) return null;

  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: 8,
        right: 8,
        zIndex: 99999,
        maxHeight: "40vh",
        overflow: "auto",
        font: "11px/1.4 ui-monospace, monospace",
        background: "rgba(10,10,14,0.88)",
        color: "#cdd6f4",
        border: "1px solid rgba(255,255,255,0.12)",
        borderRadius: 8,
        padding: open ? "8px 10px" : "4px 8px",
        backdropFilter: "blur(4px)",
        pointerEvents: "auto",
        userSelect: "none",
      }}
    >
      <div
        onClick={() => setOpen((o) => !o)}
        style={{ cursor: "pointer", fontWeight: 700, marginBottom: open ? 6 : 0, opacity: 0.8 }}
        title="Click to collapse · render counts (dev only)"
      >
        ⟳ renders {open ? "▾" : "▸"}
        <span
          onClick={(e) => {
            e.stopPropagation();
            counts.clear();
            force((n) => n + 1);
          }}
          style={{ marginLeft: 8, opacity: 0.6, cursor: "pointer" }}
          title="Reset counts"
        >
          ⌫
        </span>
      </div>
      {open &&
        (rows.length === 0 ? (
          <div style={{ opacity: 0.5 }}>no instrumented components yet</div>
        ) : (
          rows.map(([name, n]) => (
            <div key={name} style={{ display: "flex", gap: 12, justifyContent: "space-between" }}>
              <span>{name} rendered:</span>
              <span style={{ color: n > 40 ? "#f38ba8" : n > 15 ? "#f9e2af" : "#a6e3a1" }}>{n}</span>
            </div>
          ))
        ))}
    </div>
  );
}
