import { useEffect } from "react";
import { useTelemetryStore } from "@/store/telemetry-store";
import { pushToast } from "@/store/toast-store";
import { notify } from "@/store/notification-store";

/**
 * Detects AC connect / disconnect (charging-state edges) from live telemetry and
 * fires the "battery event experience": a transient toast (with an electric
 * flourish on connect, gated by reduce-motion in the Toaster) plus a persistent
 * Notification Center entry. The first reading only seeds the baseline, so we
 * never toast on launch. Renders nothing.
 */
export function useChargingEvents() {
  useEffect(() => {
    let prev: boolean | null = null;
    const unsub = useTelemetryStore.subscribe((s) => {
      const bat = s.snapshot?.battery;
      if (!bat) return;
      const st = (bat.status ?? "").toLowerCase();
      const charging = st.includes("charg") && !st.includes("dis");

      if (prev === null) {
        prev = charging;
        return;
      }
      if (charging === prev) return;
      prev = charging;

      if (charging) {
        pushToast({
          tone: "success",
          icon: "charging",
          electric: true,
          title: "AC Power Connected",
          body: `Charging · ${bat.chargePercent.toFixed(0)}%`,
        });
        notify({ kind: "battery", severity: "info", title: "AC power connected", body: "Charging started." });
      } else {
        pushToast({
          tone: "info",
          icon: "battery",
          title: "Running on Battery",
          body: `${bat.chargePercent.toFixed(0)}% · unplugged`,
        });
        notify({ kind: "battery", severity: "info", title: "Running on battery", body: "Unplugged from AC." });
      }
    });
    return () => unsub();
  }, []);
}
