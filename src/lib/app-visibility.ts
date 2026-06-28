import { isTauri, getWindowVisible } from "@/lib/ipc";

/**
 * Whether the app is "active" — the window is shown (not minimized to tray) and
 * the document is visible. Polling hooks check `isAppActive()` to skip expensive
 * backend calls (e.g. GPU/thermal reads that spawn nvidia-smi) while Nexus runs
 * as a background tray service, cutting idle CPU + wakeups. The backend emits
 * `window://visible` on show/hide; the Page Visibility API is a fallback.
 */

let tauriVisible = true;
let docHidden = typeof document !== "undefined" ? document.hidden : false;

export function isAppActive(): boolean {
  return tauriVisible && !docHidden;
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    docHidden = document.hidden;
  });
}

if (isTauri()) {
  // Seed the initial state — a `--minimized` (tray) launch never emits a hide
  // event, so we must ask rather than assume "visible".
  void getWindowVisible()
    .then((v) => {
      tauriVisible = v;
    })
    .catch(() => {});
  void import("@tauri-apps/api/event").then(({ listen }) => {
    void listen<boolean>("window://visible", (e) => {
      tauriVisible = !!e.payload;
    });
  });
}
