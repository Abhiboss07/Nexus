import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { BatteryGlyph, type GlyphOverride } from "@/components/battery/battery-glyph";
import { effectDurationMs } from "@/components/battery/effect-layers";
import {
  useBatteryEventsStore,
  BATTERY_EVENTS,
  type BatteryEvent,
} from "@/store/battery-events-store";
import { useReduceMotion } from "@/store/prefs-store";

/**
 * The on-demand desktop overlay. A transparent, click-through window the backend
 * spawns when a battery event fires; it renders the event's configured animation,
 * then fades out and destroys its own window. Zero footprint between events.
 *
 * Animation-only: sound is played by the main window (its AudioContext is
 * unlocked after a user gesture and survives hide-to-tray), because this freshly
 * spawned webview has no gesture and the autoplay policy would block it.
 */

interface OverlayPayload {
  event: BatteryEvent;
  pct: number;
}

function payload(): OverlayPayload {
  const g = (window as unknown as { __NEXUS_OVERLAY?: OverlayPayload }).__NEXUS_OVERLAY;
  if (g && typeof g.event === "string") return { event: g.event, pct: Number.isFinite(g.pct) ? g.pct : 72 };
  // Dev fallback when overlay.html is opened directly in a browser.
  const url = new URLSearchParams(window.location.search);
  return { event: (url.get("event") as BatteryEvent) || "connect", pct: Number(url.get("pct")) || 72 };
}

async function destroySelf() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
  } catch {
    /* not in Tauri (dev preview) — leave the page up */
  }
}

const HOLD_MS = 2400;
const FADE_MS = 450;

export function OverlayApp() {
  const { event, pct } = payload();
  const reduce = useReduceMotion();
  const meta = BATTERY_EVENTS.find((e) => e.id === event) ?? BATTERY_EVENTS[0];

  const cfg = useBatteryEventsStore((s) => s.events[event]);
  const customEffects = useBatteryEventsStore((s) => s.customEffects);

  const effect = cfg.effectId ? customEffects.find((e) => e.id === cfg.effectId) ?? null : null;
  const [nonce, setNonce] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    // Trigger the one-shot animation on mount. Sound is the main window's job.
    setNonce(1);

    // Hold long enough for the configured animation, then fade out and destroy.
    const animMs = effect ? effectDurationMs(effect) : 0;
    const hold = Math.max(HOLD_MS, animMs + 400);
    const fadeAt = window.setTimeout(() => setVisible(false), hold);
    const killAt = window.setTimeout(() => void destroySelf(), hold + FADE_MS);
    return () => {
      window.clearTimeout(fadeAt);
      window.clearTimeout(killAt);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const override: GlyphOverride = { anim: cfg.anim, kind: meta.kind, nonce, effect };

  return (
    <div className="grid h-screen w-screen place-items-end justify-end p-3">
      <motion.div
        className="glass glass-edge flex items-center gap-3 rounded-2xl p-3 pr-4"
        initial={reduce ? { opacity: 1 } : { opacity: 0, y: 12, scale: 0.96 }}
        animate={visible ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 8, scale: 0.98 }}
        transition={{ duration: reduce ? 0 : FADE_MS / 1000, ease: "easeOut" }}
      >
        <div className="scale-[0.62]">
          <BatteryGlyph level={pct} charging={meta.kind === "continuous"} override={override} />
        </div>
        <div className="pr-1">
          <p className="text-sm font-semibold text-content">{meta.label}</p>
          <p className="text-2xs text-content-muted">{pct.toFixed(0)}%</p>
        </div>
      </motion.div>
    </div>
  );
}
