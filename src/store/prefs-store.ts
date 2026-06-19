import { create } from "zustand";
import { persist } from "zustand/middleware";

/**
 * App-level UX preferences (separate from theme + telemetry). Persisted under
 * `nexus.prefs` and applied to the document root so plain CSS can react.
 */
export type AnimationLevel = "off" | "low" | "normal" | "extreme";

interface PrefsState {
  /** Motion budget. off = none, low = transitions only, normal = default,
   *  extreme = default + ambient flourish. */
  animations: AnimationLevel;
  /** Show the live FPS / performance overlay. */
  perfOverlay: boolean;

  setAnimations: (a: AnimationLevel) => void;
  setPerfOverlay: (v: boolean) => void;
}

/** Mirror the level onto <html data-animations> so base.css can halt motion. */
export function applyAnimationsToDOM(level: AnimationLevel) {
  document.documentElement.setAttribute("data-animations", level);
}

export const usePrefsStore = create<PrefsState>()(
  persist(
    (set) => ({
      animations: "normal",
      perfOverlay: false,
      setAnimations: (animations) => {
        applyAnimationsToDOM(animations);
        set({ animations });
      },
      setPerfOverlay: (perfOverlay) => set({ perfOverlay }),
    }),
    {
      name: "nexus.prefs",
      onRehydrateStorage: () => (state) => {
        if (state) applyAnimationsToDOM(state.animations);
      },
    },
  ),
);

/** Derived: suppress non-essential motion (off or low). */
export const useReduceMotion = () =>
  usePrefsStore((s) => s.animations === "off" || s.animations === "low");
