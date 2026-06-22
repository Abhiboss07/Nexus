import { useEffect } from "react";
import { onIntegrationProgress } from "@/lib/ipc";
import { useInstallStore } from "@/store/install-store";

/**
 * Single global `integration-progress` listener. Mounted once (AppProviders), it
 * feeds every install's progress into the install store regardless of which page
 * is on screen — so a download started on the Integrations page keeps updating
 * after the user navigates away. Renders nothing.
 */
export function InstallManager() {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onIntegrationProgress((p) => useInstallStore.getState().applyProgress(p)).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
  return null;
}
