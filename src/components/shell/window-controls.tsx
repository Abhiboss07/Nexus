import { Minus, Square, X } from "lucide-react";
import { isTauri } from "@/lib/ipc";
import { cn } from "@/lib/cn";

async function win() {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  return getCurrentWindow();
}

/** Custom window controls (the window is decoration-less). Tauri only. */
export function WindowControls() {
  if (!isTauri()) return null;

  const btn = "no-drag grid h-8 w-9 place-items-center text-content-subtle transition-colors hover:text-content";

  return (
    <div className="no-drag ml-xs flex items-center">
      <button className={cn(btn, "hover:bg-surface-raised")} onClick={async () => (await win()).minimize()} aria-label="Minimize">
        <Minus className="h-4 w-4" />
      </button>
      <button className={cn(btn, "hover:bg-surface-raised")} onClick={async () => (await win()).toggleMaximize()} aria-label="Maximize">
        <Square className="h-3.5 w-3.5" />
      </button>
      <button className={cn(btn, "rounded-tr-md hover:bg-danger hover:text-white")} onClick={async () => (await win()).hide()} aria-label="Close to tray">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
