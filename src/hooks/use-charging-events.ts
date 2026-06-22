import { useEffect } from "react";
import { useTelemetryStore } from "@/store/telemetry-store";
import { pushToast } from "@/store/toast-store";
import { notify } from "@/store/notification-store";
import { isCharging } from "@/lib/battery-types";
import { useBatteryEventsStore } from "@/store/battery-events-store";
import { playSound } from "@/lib/sound";

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
      const charging = isCharging(bat.status);

      if (prev === null) {
        prev = charging;
        return;
      }
      if (charging === prev) return;
      prev = charging;

      // Diagnostics for AC/charging transitions (helps confirm real hardware state).
      console.info(
        `[charging] ${charging ? "AC connected" : "AC disconnected"} — status="${bat.status}" charge=${bat.chargePercent.toFixed(0)}%`,
      );

      const prefs = useBatteryEventsStore.getState();
      const sound = (choice: "connect" | "disconnect") => {
        if (!prefs.soundEnabled) return;
        if (choice === "connect") playSound(prefs.connectSound, prefs.connectCustom, prefs.volume);
        else playSound(prefs.disconnectSound, prefs.disconnectCustom, prefs.volume);
      };

      if (charging) {
        pushToast({
          tone: "success",
          icon: "charging",
          electric: prefs.connectAnim === "electric" || prefs.connectAnim === "neon",
          title: "AC Power Connected",
          body: `Charging · ${bat.chargePercent.toFixed(0)}%`,
        });
        notify({ kind: "battery", severity: "info", title: "AC power connected", body: "Charging started." });
        sound("connect");
      } else {
        pushToast({
          tone: "info",
          icon: "battery",
          title: "Running on Battery",
          body: `${bat.chargePercent.toFixed(0)}% · unplugged`,
        });
        notify({ kind: "battery", severity: "info", title: "Running on battery", body: "Unplugged from AC." });
        sound("disconnect");
      }
    });
    return () => unsub();
  }, []);
}
