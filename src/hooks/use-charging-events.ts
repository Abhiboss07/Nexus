import { useEffect } from "react";
import { useTelemetryStore } from "@/store/telemetry-store";
import { pushToast } from "@/store/toast-store";
import { notify } from "@/store/notification-store";
import { isCharging } from "@/lib/battery-types";
import type { BatteryTelemetry } from "@/lib/telemetry-types";
import { isTauri, onBatteryEvent, type BatteryEventPayload } from "@/lib/ipc";
import { useBatteryEventsStore, type BatteryEvent } from "@/store/battery-events-store";
import { playSound } from "@/lib/sound";

/**
 * Surfaces battery events as in-app toasts + the configured per-event sound.
 *
 * Detection now lives in the **Rust backend** (`battery_events.rs`): it runs on
 * the telemetry thread regardless of window state, records the bell history and
 * fires the **native desktop notification**. This hook just listens to the
 * resulting `battery://event` stream and adds the UI flourish for an open window.
 *
 * Outside Tauri (browser demo) there is no backend, so we fall back to detecting
 * from the mock telemetry stream and also record the bell here. Renders nothing.
 */

type Ev = BatteryEvent;

/** Charge-wattage bands + level hysteresis for the demo-mode detector. */
const FAST_W = 45;
const SLOW_W = 18;
const LOW_ON = 20;
const LOW_OFF = 23;
const CRIT_ON = 10;
const CRIT_OFF = 13;
const FULL_ON = 99.5;
const FULL_OFF = 97;

const META: Record<
  Ev,
  {
    icon: "charging" | "battery";
    tone: "success" | "info" | "warning" | "danger";
    severity: "info" | "warning" | "critical";
    title: string;
    body: (pct: number, powerW: number) => string;
    notifBody: string;
  }
> = {
  connect: { icon: "charging", tone: "success", severity: "info", title: "AC Power Connected", body: (p) => `Charging · ${p.toFixed(0)}%`, notifBody: "Charging started." },
  fastCharge: { icon: "charging", tone: "success", severity: "info", title: "Fast Charging", body: (p, w) => `${w.toFixed(0)} W · ${p.toFixed(0)}%`, notifBody: "High-wattage charging detected." },
  slowCharge: { icon: "charging", tone: "info", severity: "info", title: "Slow Charging", body: (_p, w) => `${w.toFixed(0)} W · trickle charge`, notifBody: "Low-wattage charging detected." },
  full: { icon: "charging", tone: "success", severity: "info", title: "Fully Charged", body: () => "Battery at 100%", notifBody: "Battery reached full charge." },
  disconnect: { icon: "battery", tone: "info", severity: "info", title: "Running on Battery", body: (p) => `${p.toFixed(0)}% · unplugged`, notifBody: "Unplugged from AC." },
  low: { icon: "battery", tone: "warning", severity: "warning", title: "Battery Low", body: (p) => `${p.toFixed(0)}% remaining`, notifBody: "Battery dropped below 20%." },
  critical: { icon: "battery", tone: "danger", severity: "critical", title: "Battery Critical", body: (p) => `${p.toFixed(0)}% — plug in soon`, notifBody: "Battery dropped below 10%." },
};

/** In-app toast for an event. Sound is owned by the desktop overlay in Tauri
 * path mirrors this. */
function presentUx(event: Ev, pct: number, powerW: number) {
  const prefs = useBatteryEventsStore.getState();
  const cfg = prefs.events[event];
  const m = META[event];
  pushToast({
    tone: m.tone,
    icon: m.icon,
    electric: cfg.anim === "electric" || cfg.anim === "neon",
    title: m.title,
    body: m.body(pct, powerW),
  });
  // Sound plays in the MAIN window: its AudioContext is unlocked after any user
  // gesture and stays alive even hidden-to-tray. The overlay is a fresh webview
  // with no gesture, so it can't reliably autoplay — it's animation-only.
  if (prefs.soundEnabled) playSound(cfg.sound, cfg.custom, prefs.volume, cfg.fx);
}

export function useChargingEvents() {
  useEffect(() => {
    if (isTauri()) {
      // Backend owns detection + bell + native notification + overlay animation.
      // The (alive) main window adds the toast + sound.
      let unlisten = () => {};
      let cancelled = false;
      void onBatteryEvent((e: BatteryEventPayload) => presentUx(e.event, e.chargePercent, e.powerW)).then((u) => {
        if (cancelled) u();
        else unlisten = u;
      });
      return () => {
        cancelled = true;
        unlisten();
      };
    }

    // ── Demo (browser) fallback: detect from the mock telemetry stream ──
    let prevCharging: boolean | null = null;
    let chargeClassFired = false;
    let inLow = false;
    let inCritical = false;
    let wasFull = false;

    const fire = (event: Ev, bat: BatteryTelemetry) => {
      presentUx(event, bat.chargePercent, bat.powerDrawW);
      notify({ kind: "battery", severity: META[event].severity, title: META[event].title, body: META[event].notifBody });
    };

    const unsub = useTelemetryStore.subscribe((s) => {
      const bat = s.snapshot?.battery;
      if (!bat?.present) return;
      const charging = isCharging(bat.status);
      const pct = bat.chargePercent;
      const full = (bat.status ?? "").toLowerCase() === "full" || pct >= FULL_ON;

      if (prevCharging === null) {
        prevCharging = charging;
        inLow = !charging && pct <= LOW_ON;
        inCritical = !charging && pct <= CRIT_ON;
        wasFull = full;
        chargeClassFired = charging;
        return;
      }

      if (charging !== prevCharging) {
        if (charging) {
          fire("connect", bat);
          chargeClassFired = false;
        } else {
          fire("disconnect", bat);
        }
        prevCharging = charging;
      }

      if (charging && !chargeClassFired && bat.powerDrawW > 1) {
        chargeClassFired = true;
        if (bat.powerDrawW >= FAST_W) fire("fastCharge", bat);
        else if (bat.powerDrawW <= SLOW_W) fire("slowCharge", bat);
      }

      if (full && !wasFull) {
        fire("full", bat);
        wasFull = true;
      } else if (!full && wasFull && pct < FULL_OFF) {
        wasFull = false;
      }

      if (!charging) {
        if (!inCritical && pct <= CRIT_ON) {
          fire("critical", bat);
          inCritical = true;
        } else if (inCritical && pct > CRIT_OFF) {
          inCritical = false;
        }
        if (!inLow && pct <= LOW_ON && pct > CRIT_ON) {
          fire("low", bat);
          inLow = true;
        } else if (inLow && pct > LOW_OFF) {
          inLow = false;
        }
      } else {
        if (pct > LOW_OFF) inLow = false;
        if (pct > CRIT_OFF) inCritical = false;
      }
    });
    return () => unsub();
  }, []);
}
