import { useEffect } from "react";

/**
 * Toggles `html[data-ambient-paused]` whenever the window is hidden or
 * unfocused. CSS uses it to halt continuous background animations (aurora / mesh
 * / grid / glow) and the particle field reads it to stop its rAF loop — so the
 * app does no ambient GPU/CPU/battery work while nobody is looking at it.
 */
export function useAmbientPause() {
  useEffect(() => {
    const root = document.documentElement;
    const update = () => {
      const paused = document.hidden || !document.hasFocus();
      root.dataset.ambientPaused = paused ? "true" : "false";
    };
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
}
