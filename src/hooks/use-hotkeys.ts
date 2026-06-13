import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useUIStore } from "@/store/ui-store";

/**
 * Global keyboard layer.
 *   - Ctrl/Cmd+K        → toggle command palette
 *   - Ctrl/Cmd+B        → toggle sidebar
 *   - g then d/p/a/s …  → jump to page (Linear-style leader key)
 */
const LEADER_MAP: Record<string, string> = {
  d: "/",
  p: "/performance",
  r: "/rgb",
  b: "/battery",
  t: "/tasks",
  i: "/intelligence",
  s: "/settings",
  g: "/game",
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    el.isContentEditable ||
    el.getAttribute("role") === "textbox"
  );
}

export function useGlobalHotkeys() {
  const navigate = useNavigate();
  const togglePalette = useUIStore((s) => s.toggleCommandPalette);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const leaderActive = useRef(false);
  const leaderTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        togglePalette();
        return;
      }
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      if (isTypingTarget(e.target) || mod || e.altKey) return;

      // Leader key: press "g", then a destination key.
      if (leaderActive.current) {
        const dest = LEADER_MAP[e.key.toLowerCase()];
        leaderActive.current = false;
        window.clearTimeout(leaderTimer.current);
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
        return;
      }
      if (e.key.toLowerCase() === "g") {
        leaderActive.current = true;
        leaderTimer.current = window.setTimeout(() => {
          leaderActive.current = false;
        }, 1200);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, togglePalette, toggleSidebar]);
}
