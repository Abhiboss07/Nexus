import type { Transition, Variants } from "framer-motion";

/**
 * Centralized motion language. Every animated surface pulls from these so the
 * whole app shares one rhythm — subtle, premium, never excessive.
 */

export const easing = {
  smooth: [0.22, 1, 0.36, 1] as const,
  spring: [0.34, 1.56, 0.64, 1] as const,
  snap: [0.4, 0, 0.2, 1] as const,
};

export const duration = {
  fast: 0.12,
  base: 0.22,
  slow: 0.42,
};

export const springs = {
  soft: { type: "spring", stiffness: 220, damping: 28, mass: 0.9 } as Transition,
  snappy: { type: "spring", stiffness: 420, damping: 32 } as Transition,
  gentle: { type: "spring", stiffness: 140, damping: 22 } as Transition,
};

/* ----- Reusable variants ----- */

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: duration.base, ease: easing.smooth },
  },
  exit: { opacity: 0, y: -6, transition: { duration: duration.fast } },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.base } },
  exit: { opacity: 0, transition: { duration: duration.fast } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  show: {
    opacity: 1,
    scale: 1,
    transition: springs.soft,
  },
  exit: { opacity: 0, scale: 0.98, transition: { duration: duration.fast } },
};

/** Parent container that staggers its children on enter. */
export const stagger = (gap = 0.05): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: gap, delayChildren: 0.04 },
  },
});

/** Page-level route transition. */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 12, filter: "blur(6px)" },
  show: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: duration.slow, ease: easing.smooth },
  },
  exit: {
    opacity: 0,
    y: -8,
    filter: "blur(4px)",
    transition: { duration: duration.base, ease: easing.snap },
  },
};
