import { useEffect } from "react";
import { useTelemetryStore } from "@/store/telemetry-store";
import { notify } from "@/store/notification-store";
import { isCharging } from "@/lib/battery-types";

/**
 * Watches live telemetry and raises edge-triggered notifications (battery low /
 * critical / full, high CPU temperature). Edge flags + the store's 3s de-dupe
 * keep it from spamming when a value hovers around a threshold. Renders nothing.
 */
export function useSystemAlerts() {
  useEffect(() => {
    let low = false;
    let crit = false;
    let full = false;
    let hot = false;

    const unsub = useTelemetryStore.subscribe((s) => {
      const snap = s.snapshot;
      if (!snap) return;

      const bat = snap.battery;
      if (bat) {
        const pct = bat.chargePercent;
        const charging = isCharging(bat.status);

        if (charging) {
          low = false;
          crit = false;
          if (pct >= 100 && !full) {
            notify({ kind: "battery", severity: "success", title: "Battery full", body: "Charged to 100%." });
            full = true;
          }
          if (pct < 98) full = false;
        } else {
          full = false;
          if (pct <= 10 && !crit) {
            notify({ kind: "battery", severity: "critical", title: "Critical battery", body: `${pct.toFixed(0)}% remaining — plug in now.` });
            crit = true;
          } else if (pct <= 20 && !low) {
            notify({ kind: "battery", severity: "warning", title: "Low battery", body: `${pct.toFixed(0)}% remaining.` });
            low = true;
          }
          if (pct > 25) {
            low = false;
            crit = false;
          }
        }
      }

      const cpuC = snap.thermals?.cpuC ?? snap.cpu?.temperatureC ?? 0;
      if (cpuC >= 92 && !hot) {
        notify({ kind: "thermal", severity: "warning", title: "High CPU temperature", body: `${cpuC.toFixed(0)}°C — thermal throttling likely.` });
        hot = true;
      }
      if (cpuC < 85) hot = false;
    });
    return () => unsub();
  }, []);
}
