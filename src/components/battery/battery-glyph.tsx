import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BatteryCharging } from "lucide-react";
import { useReduceMotion } from "@/store/prefs-store";
import {
  useBatteryEventsStore,
  type AnimId,
  type EventKind,
} from "@/store/battery-events-store";
import { cn } from "@/lib/cn";

/** Level → color tone, per the design thresholds (80 green / 40 cyan / 20 amber / red). */
export function batteryTone(level: number): "success" | "iris" | "warning" | "danger" {
  if (level >= 80) return "success";
  if (level >= 40) return "iris";
  if (level >= 20) return "warning";
  return "danger";
}

/** Drives the live preview from the settings editor without touching real state. */
export interface GlyphOverride {
  anim: AnimId;
  kind: EventKind;
  /** Bump to replay a one-shot anim. */
  nonce: number;
}

/**
 * Premium vertical battery: liquid fill synced to the live level, color by charge
 * band, a configurable continuous charging animation (Pulse / Electric / Neon /
 * Minimal / None) and one-shot transition effects (Ripple / Fade / Battery Drain
 * / Minimal). All continuous + transition effects are gated behind reduce-motion
 * so Battery Saver / "animations off" keeps it static and cheap.
 *
 * Pass `override` to preview a specific event's animation (used by the Battery
 * Events editor): a `continuous` override shows the charging visual with that
 * anim; a `oneshot` override replays its anim whenever `nonce` changes.
 */
export function BatteryGlyph({
  level,
  charging,
  override,
}: {
  level: number;
  charging: boolean;
  override?: GlyphOverride;
}) {
  const reduce = useReduceMotion();
  const connectAnim = useBatteryEventsStore((s) => s.events.connect.anim);
  const disconnectAnim = useBatteryEventsStore((s) => s.events.disconnect.anim);
  const tone = batteryTone(level);
  const fillPct = Math.max(3, Math.min(100, level));

  const previewContinuous = override?.kind === "continuous";
  const chargingVisual = override ? !!previewContinuous : charging;
  const contAnim = previewContinuous ? override.anim : connectAnim;

  const animating = chargingVisual && !reduce && contAnim !== "none";
  const neon = contAnim === "neon";
  const showGlow = animating && (contAnim === "pulse" || contAnim === "electric" || neon);
  const showShimmer = animating && (contAnim === "electric" || neon);
  const glow = (a: number) => `0 0 26px rgb(var(--color-${tone}) / ${a})`;

  // One-shot effect: a counter (replay key) + the anim to play.
  const [disc, setDisc] = useState(0);
  const [discAnim, setDiscAnim] = useState<AnimId>("none");
  const fire = (anim: AnimId) => {
    setDiscAnim(anim);
    setDisc((n) => n + 1);
  };
  const done = () => setDisc(0);

  // Real page: retrigger the disconnect one-shot on each charging true→false edge.
  const prevCharging = useRef(charging);
  useEffect(() => {
    if (override) return;
    if (prevCharging.current && !charging && !reduce && disconnectAnim !== "none") {
      fire(disconnectAnim);
    }
    prevCharging.current = charging;
  }, [charging, reduce, disconnectAnim, override]);

  // Preview: replay the chosen one-shot whenever the nonce changes.
  const prevNonce = useRef(override?.nonce ?? 0);
  useEffect(() => {
    if (!override || override.kind !== "oneshot") return;
    if (override.nonce !== prevNonce.current) {
      prevNonce.current = override.nonce;
      if (!reduce && override.anim !== "none") fire(override.anim);
    }
  }, [override, reduce]);

  return (
    <div className="relative grid shrink-0 place-items-center">
      {/* terminal nub */}
      <div className="h-2 w-7 rounded-t-md bg-border-strong" />
      <motion.div
        className="relative h-36 w-20 rounded-2xl border-2 bg-surface-sunken"
        style={{ borderColor: neon ? `rgb(var(--color-${tone}))` : "rgb(var(--color-border-strong))" }}
        animate={showGlow ? { boxShadow: [glow(0), glow(neon ? 0.85 : 0.55), glow(0)] } : { boxShadow: glow(0) }}
        transition={showGlow ? { duration: neon ? 1.3 : 2, repeat: Infinity, ease: "easeInOut" } : { duration: 0.4 }}
      >
        {/* fill track */}
        <div className="absolute inset-1.5 overflow-hidden rounded-xl">
          <motion.div
            className="absolute inset-x-0 bottom-0"
            style={{
              background: `linear-gradient(180deg, rgb(var(--color-${tone})), rgb(var(--color-${tone}) / 0.72))`,
            }}
            initial={false}
            animate={{ height: `${fillPct}%` }}
            transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="absolute inset-x-0 top-0 h-1.5 bg-white/30" />
            {showShimmer && (
              <motion.div
                className="absolute inset-x-0 h-10 bg-gradient-to-t from-transparent via-white/25 to-transparent"
                initial={{ y: "120%" }}
                animate={{ y: "-130%" }}
                transition={{ duration: neon ? 1.2 : 1.7, repeat: Infinity, ease: "easeInOut" }}
              />
            )}
          </motion.div>

          {/* one-shot: battery-drain wipe (top→down over the fill) */}
          <AnimatePresence>
            {disc > 0 && discAnim === "drain" && (
              <motion.div
                key={`drain-${disc}`}
                className="absolute inset-x-0 top-0 bg-surface-sunken"
                initial={{ height: "0%" }}
                animate={{ height: "100%" }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.6, ease: "easeIn" }}
                onAnimationComplete={done}
              />
            )}
          </AnimatePresence>
        </div>

        {/* one-shot: ripple ring from center */}
        <AnimatePresence>
          {disc > 0 && discAnim === "ripple" && (
            <motion.div
              key={`ripple-${disc}`}
              className="pointer-events-none absolute inset-0 m-auto h-6 w-6 rounded-full border-2"
              style={{ borderColor: `rgb(var(--color-${tone}))` }}
              initial={{ scale: 0.3, opacity: 0.85 }}
              animate={{ scale: 4.2, opacity: 0 }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              onAnimationComplete={done}
            />
          )}
        </AnimatePresence>

        {/* charging bolt */}
        {chargingVisual && (
          <BatteryCharging
            className={cn(
              "absolute inset-0 z-10 m-auto h-9 w-9 text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.5)]",
              neon && "drop-shadow-[0_0_8px_rgba(255,255,255,0.7)]",
            )}
          />
        )}
      </motion.div>

      {/* one-shot: fade / minimal flash over the whole glyph */}
      <AnimatePresence>
        {disc > 0 && (discAnim === "fade" || discAnim === "minimal") && (
          <motion.div
            key={`fade-${disc}`}
            className="pointer-events-none absolute inset-0 rounded-2xl bg-canvas"
            initial={{ opacity: discAnim === "fade" ? 0.6 : 0.3 }}
            animate={{ opacity: 0 }}
            transition={{ duration: discAnim === "fade" ? 0.7 : 0.35 }}
            onAnimationComplete={done}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
