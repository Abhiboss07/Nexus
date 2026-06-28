import { motion, type Transition } from "framer-motion";
import type { CustomEffect, EffectLayer, EaseId, ColorToken } from "@/store/battery-events-store";

/**
 * Renders a CustomEffect as a stack of composited motion layers over the battery
 * body. Each layer maps to one primitive (glow / pulse / shimmer / ripple /
 * flash / drain / sparks) honouring its delay, duration, ease, colour, intensity
 * and repeat. The caller is responsible for reduce-motion gating (it simply
 * doesn't mount this when motion is off) and for unmounting one-shot effects.
 */

const EASE_MAP: Record<EaseId, Transition["ease"]> = {
  linear: "linear",
  easeIn: "easeIn",
  easeOut: "easeOut",
  easeInOut: "easeInOut",
  bounce: [0.34, 1.56, 0.64, 1],
  elastic: [0.68, -0.55, 0.27, 1.55],
};

/** Longest (delay + duration) across a one-shot effect's layers, in ms. */
export function effectDurationMs(effect: CustomEffect): number {
  return effect.layers.reduce((max, l) => Math.max(max, l.delay + l.duration), 0) + 80;
}

function rgb(color: ColorToken, tone: string, alpha: number): string {
  if (color === "white") return `rgba(255,255,255,${alpha})`;
  const t = color === "tone" ? tone : color;
  return `rgb(var(--color-${t}) / ${alpha})`;
}

function trans(layer: EffectLayer): Transition {
  return {
    delay: layer.delay / 1000,
    duration: layer.duration / 1000,
    ease: EASE_MAP[layer.ease],
    repeat: layer.repeat ? Infinity : 0,
    repeatType: "loop",
  };
}

function Sparks({ layer, tone, t }: { layer: EffectLayer; tone: string; t: Transition }) {
  const n = 6;
  return (
    <div className="pointer-events-none absolute inset-0">
      {Array.from({ length: n }).map((_, k) => {
        const x = (k / (n - 1) - 0.5) * 56;
        return (
          <motion.span
            key={k}
            className="absolute left-1/2 top-1/2 h-1 w-1 rounded-full"
            style={{ background: rgb(layer.color, tone, 0.9) }}
            initial={{ x: 0, y: 0, opacity: 0 }}
            animate={{ x, y: -28 - 34 * layer.intensity, opacity: [0, 1, 0] }}
            transition={{ ...t, delay: (t.delay ?? 0) + k * 0.05 }}
          />
        );
      })}
    </div>
  );
}

function Layer({ layer, tone }: { layer: EffectLayer; tone: string }) {
  const t = trans(layer);
  const i = layer.intensity;

  switch (layer.type) {
    case "glow":
      return (
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          initial={{ boxShadow: `0 0 0px ${rgb(layer.color, tone, 0)}` }}
          animate={{
            boxShadow: [
              `0 0 0px ${rgb(layer.color, tone, 0)}`,
              `0 0 ${18 + 34 * i}px ${rgb(layer.color, tone, 0.2 + 0.6 * i)}`,
              `0 0 0px ${rgb(layer.color, tone, 0)}`,
            ],
          }}
          transition={t}
        />
      );
    case "pulse":
      return (
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-2xl border-2"
          style={{ borderColor: rgb(layer.color, tone, 0.5 + 0.4 * i) }}
          initial={{ scale: 1, opacity: 0 }}
          animate={{ scale: [1, 1 + 0.12 * i, 1], opacity: [0, 0.85, 0] }}
          transition={t}
        />
      );
    case "shimmer":
      return (
        <div className="pointer-events-none absolute inset-1.5 overflow-hidden rounded-xl">
          <motion.div
            className="absolute inset-x-0 h-10"
            style={{ background: `linear-gradient(to top, transparent, ${rgb(layer.color, tone, 0.3 + 0.4 * i)}, transparent)` }}
            initial={{ y: "130%" }}
            animate={{ y: "-130%" }}
            transition={t}
          />
        </div>
      );
    case "ripple":
      return (
        <motion.div
          className="pointer-events-none absolute inset-0 m-auto h-6 w-6 rounded-full border-2"
          style={{ borderColor: rgb(layer.color, tone, 0.85) }}
          initial={{ scale: 0.3, opacity: 0.85 }}
          animate={{ scale: 3 + 2 * i, opacity: 0 }}
          transition={t}
        />
      );
    case "flash":
      return (
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-2xl"
          style={{ background: rgb(layer.color, tone, 1) }}
          initial={{ opacity: 0.2 + 0.6 * i }}
          animate={{ opacity: 0 }}
          transition={t}
        />
      );
    case "drain":
      return (
        <div className="pointer-events-none absolute inset-1.5 overflow-hidden rounded-xl">
          <motion.div
            className="absolute inset-x-0 top-0 bg-surface-sunken"
            initial={{ height: "0%" }}
            animate={{ height: "100%" }}
            transition={t}
          />
        </div>
      );
    case "spark":
      return <Sparks layer={layer} tone={tone} t={t} />;
  }
}

export function CustomEffectLayers({ effect, tone }: { effect: CustomEffect; tone: string }) {
  return (
    <>
      {effect.layers.map((l) => (
        <Layer key={l.id} layer={l} tone={tone} />
      ))}
    </>
  );
}
