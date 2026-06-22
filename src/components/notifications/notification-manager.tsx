import { useEffect } from "react";
import { onNotification } from "@/lib/ipc";
import { useNotificationStore } from "@/store/notification-store";
import { useSystemAlerts } from "@/hooks/use-system-alerts";

/**
 * Mounted once (AppProviders). Loads persisted notifications, subscribes to the
 * single global `notification://new` event so every event lands in the store
 * regardless of the current page, and runs the telemetry alert watcher.
 */
export function NotificationManager() {
  const load = useNotificationStore((s) => s.load);
  const ingest = useNotificationStore((s) => s.ingest);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    onNotification((n) => ingest(n)).then((u) => {
      if (cancelled) u();
      else unlisten = u;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ingest]);

  useSystemAlerts();
  return null;
}
