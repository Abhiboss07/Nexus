import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { BatteryCharging } from "lucide-react";
import { useReduceMotion } from "@/store/prefs-store";
import {
  useBatteryEventsStore,
  type AnimId,
  type CustomEffect,
  type EventKind,
} from "@/store/battery-events-store";
import { CustomEffectLayers, effectDurationMs } from "@/components/battery/effect-layers";
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
  /** Bump to replay a one-shot anim/effect. */
  nonce: number;
  /** When set, render this custom effect instead of the built-in `anim`. */
  effect?: CustomEffect | null;
}

/**
 * Premium vertical battery: liquid fill synced to the live level, color by charge
 * band, plus a configurable animation per power event. Each event uses either a
 * built-in anim (continuous Pulse/Electric/Neon or one-shot Ripple/Fade/Drain) or
 * a composed CustomEffect (layered). All effects are gated behind reduce-motion so
 * Battery Saver / "animations off" keeps the glyph static and cheap.
 *
 * Pass `override` to preview a specific event (used by the Battery Events editor):
 * a `continuous` override shows the charging visual with that anim/effect; a
 * `oneshot` override replays it whenever `nonce` changes.
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
  const connect = useBatteryEventsStore((s) => s.events.connect);
  const disconnect = useBatteryEventsStore((s) => s.events.disconnect);
  const customEffects = useBatteryEventsStore((s) => s.customEffects);
  const resolve = (id: string | null): CustomEffect | null =>
    id ? customEffects.find((e) => e.id === id) ?? null : null;

  const tone = batteryTone(level);
  const fillPct = Math.max(3, Math.min(100, level));

  const previewContinuous = override?.kind === "continuous";
  const chargingVisual = override ? !!previewContinuous : charging;

  // Continuous animation while charging: a custom effect takes precedence.
  const contAnim = previewContinuous ? override.anim : connect.anim;
  const contEffect: CustomEffect | null = override
    ? previewContinuous
      ? override.effect ?? null
      : null
    : resolve(connect.effectId);

  const useContEffect = chargingVisual && !reduce && !!contEffect;
  const animating = chargingVisual && !reduce && !contEffect && contAnim !== "none";
  const neon = contAnim === "neon";
  const showGlow = animating && (contAnim === "pulse" || contAnim === "electric" || neon);
  const showShimmer = animating && (contAnim === "electric" || neon);
  const glow = (a: number) => `0 0 26px rgb(var(--color-${tone}) / ${a})`;

  // One-shot state: a replay counter + which anim/effect to play.
  const [shot, setShot] = useState<{ n: number; anim: AnimId; effect: CustomEffect | null }>({
    n: 0,
    anim: "none",
    effect: null,
  });
  const fireBuiltin = (anim: AnimId) => setShot((s) => ({ n: s.n + 1, anim, effect: null }));
  const fireEffect = (effect: CustomEffect) => setShot((s) => ({ n: s.n + 1, anim: "none", effect }));
  const done = () => setShot((s) => ({ ...s, n: 0 }));

  // Real page: retrigger the disconnect one-shot on each charging true→false edge.
  const prevCharging = useRef(charging);
  useEffect(() => {
    if (override) return;
    if (prevCharging.current && !charging && !reduce) {
      const eff = resolve(disconnect.effectId);
      if (eff) fireEffect(eff);
      else if (disconnect.anim !== "none") fireBuiltin(disconnect.anim);
    }
    prevCharging.current = charging;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charging, reduce, disconnect.effectId, disconnect.anim, override]);

  // Preview: replay the chosen one-shot whenever the nonce changes.
  const prevNonce = useRef(override?.nonce ?? 0);
  useEffect(() => {
    if (!override || override.kind !== "oneshot") return;
    if (override.nonce !== prevNonce.current) {
      prevNonce.current = override.nonce;
      if (reduce) return;
      if (override.effect) fireEffect(override.effect);
      else if (override.anim !== "none") fireBuiltin(override.anim);
    }
  }, [override, reduce]);

  // Auto-clear a one-shot custom effect once its longest layer has finished.
  useEffect(() => {
    if (shot.n === 0 || !shot.effect) return;
    const ms = effectDurationMs(shot.effect);
    const id = window.setTimeout(done, ms);
    return () => window.clearTimeout(id);
  }, [shot.n, shot.effect]);

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
            style={{ background: `linear-gradient(180deg, rgb(var(--color-${tone})), rgb(var(--color-${tone}) / 0.72))` }}
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

          {/* built-in one-shot: battery-drain wipe (top→down over the fill) */}
          <AnimatePresence>
            {shot.n > 0 && !shot.effect && shot.anim === "drain" && (
              <motion.div
                key={`drain-${shot.n}`}
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

        {/* continuous custom effect */}
        {useContEffect && contEffect && <CustomEffectLayers effect={contEffect} tone={tone} />}

        {/* one-shot custom effect */}
        {shot.n > 0 && shot.effect && (
          <div key={`fx-${shot.n}`} className="absolute inset-0">
            <CustomEffectLayers effect={shot.effect} tone={tone} />
          </div>
        )}

        {/* built-in one-shot: ripple ring from center */}
        <AnimatePresence>
          {shot.n > 0 && !shot.effect && shot.anim === "ripple" && (
            <motion.div
              key={`ripple-${shot.n}`}
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

      {/* built-in one-shot: fade / minimal flash over the whole glyph */}
      <AnimatePresence>
        {shot.n > 0 && !shot.effect && (shot.anim === "fade" || shot.anim === "minimal") && (
          <motion.div
            key={`fade-${shot.n}`}
            className="pointer-events-none absolute inset-0 rounded-2xl bg-canvas"
            initial={{ opacity: shot.anim === "fade" ? 0.6 : 0.3 }}
            animate={{ opacity: 0 }}
            transition={{ duration: shot.anim === "fade" ? 0.7 : 0.35 }}
            onAnimationComplete={done}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
