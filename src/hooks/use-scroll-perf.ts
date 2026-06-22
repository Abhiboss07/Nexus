import { useEffect, type RefObject } from "react";

/**
 * Marks `html[data-scrolling="true"]` while `ref` is actively scrolling, cleared
 * ~160ms after it stops. CSS uses it to drop the expensive per-frame
 * `backdrop-filter` blur (swapping in a near-identical solid fill) and pause
 * ambient motion during the scroll, restoring full fidelity the instant it
 * settles. On a long, glass-heavy page the backdrop-filter re-sample is the #1
 * compositor cost per scroll frame — suspending it for the duration of the
 * gesture is the single biggest lever for 60fps scrolling.
 */
export function useScrollPerf(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    let timer = 0;

    const onScroll = () => {
      if (root.dataset.scrolling !== "true") root.dataset.scrolling = "true";
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        root.dataset.scrolling = "false";
      }, 160);
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
      root.dataset.scrolling = "false";
    };
  }, [ref]);
}
