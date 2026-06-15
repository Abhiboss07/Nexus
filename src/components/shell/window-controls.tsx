import { Minus, Square, X } from "lucide-react";
import { isTauri } from "@/lib/ipc";
import { cn } from "@/lib/cn";

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/**
 * Run a window action and surface any failure. Tauri rejects window commands
 * that aren't granted in `capabilities/*.json`; without this the rejected
 * promise was swallowed and the button silently did nothing.
 */
function act(fn: (w: Awaited<ReturnType<typeof win>>) => Promise<void>) {
  return () => {
    win()
      .then(fn)
      .catch((err) => console.error("[window-controls] action failed:", err));
  };
}

/** Custom window controls (the window is decoration-less). Tauri only. */
export function WindowControls() {
  if (!isTauri()) return null;

  const btn = "no-drag grid h-8 w-9 place-items-center text-content-subtle transition-colors hover:text-content";

  return (
    <div className="no-drag ml-xs flex items-center">
      <button className={cn(btn, "hover:bg-surface-raised")} onClick={act((w) => w.minimize())} aria-label="Minimize">
        <Minus className="h-4 w-4" />
      </button>
      <button className={cn(btn, "hover:bg-surface-raised")} onClick={act((w) => w.toggleMaximize())} aria-label="Maximize">
        <Square className="h-3.5 w-3.5" />
      </button>
      <button className={cn(btn, "rounded-tr-md hover:bg-danger hover:text-white")} onClick={act((w) => w.hide())} aria-label="Close to tray">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
