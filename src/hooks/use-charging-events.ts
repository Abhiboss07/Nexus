import { useEffect } from "react";
import { useTelemetryStore } from "@/store/telemetry-store";
import { pushToast } from "@/store/toast-store";
import { notify } from "@/store/notification-store";
import { isCharging } from "@/lib/battery-types";
import type { BatteryTelemetry } from "@/lib/telemetry-types";
import {
  useBatteryEventsStore,
  type BatteryEvent,
} from "@/store/battery-events-store";
import { playSound } from "@/lib/sound";

/**
 * Watches live battery telemetry for the events Nexus reacts to — AC connect /
 * disconnect, fast / slow charging, fully charged, and low / critical level —
 * and fires each event's configured "experience": a per-event sound, a transient
 * toast (electric flourish when the anim is electric/neon) and a persistent
 * Notification Center entry. The first reading only seeds baselines, so we never
 * fire on launch. Renders nothing.
 */

/** Charge-wattage bands for fast/slow classification (heuristic). */
const FAST_W = 45;
const SLOW_W = 18;

/** Level hysteresis so events fire on entry and don't flap at the boundary. */
const LOW_ON = 20;
const LOW_OFF = 23;
const CRIT_ON = 10;
const CRIT_OFF = 13;
const FULL_ON = 99.5;
const FULL_OFF = 97;

function isFull(bat: BatteryTelemetry): boolean {
  return (bat.status ?? "").toLowerCase() === "full" || bat.chargePercent >= FULL_ON;
}

const META: Record<
  BatteryEvent,
  {
    icon: "charging" | "battery";
    tone: "success" | "info" | "warning" | "danger";
    severity: "info" | "warning" | "critical";
    title: string;
    body: (bat: BatteryTelemetry) => string;
    notifBody: string;
  }
> = {
  connect: {
    icon: "charging",
    tone: "success",
    severity: "info",
    title: "AC Power Connected",
    body: (b) => `Charging · ${b.chargePercent.toFixed(0)}%`,
    notifBody: "Charging started.",
  },
  fastCharge: {
    icon: "charging",
    tone: "success",
    severity: "info",
    title: "Fast Charging",
    body: (b) => `${b.powerDrawW.toFixed(0)} W · ${b.chargePercent.toFixed(0)}%`,
    notifBody: "High-wattage charging detected.",
  },
  slowCharge: {
    icon: "charging",
    tone: "info",
    severity: "info",
    title: "Slow Charging",
    body: (b) => `${b.powerDrawW.toFixed(0)} W · trickle charge`,
    notifBody: "Low-wattage charging detected.",
  },
  full: {
    icon: "charging",
    tone: "success",
    severity: "info",
    title: "Fully Charged",
    body: () => "Battery at 100%",
    notifBody: "Battery reached full charge.",
  },
  disconnect: {
    icon: "battery",
    tone: "info",
    severity: "info",
    title: "Running on Battery",
    body: (b) => `${b.chargePercent.toFixed(0)}% · unplugged`,
    notifBody: "Unplugged from AC.",
  },
  low: {
    icon: "battery",
    tone: "warning",
    severity: "warning",
    title: "Battery Low",
    body: (b) => `${b.chargePercent.toFixed(0)}% remaining`,
    notifBody: "Battery dropped below 20%.",
  },
  critical: {
    icon: "battery",
    tone: "danger",
    severity: "critical",
    title: "Battery Critical",
    body: (b) => `${b.chargePercent.toFixed(0)}% — plug in soon`,
    notifBody: "Battery dropped below 10%.",
  },
};

export function useChargingEvents() {
  useEffect(() => {
    let prevCharging: boolean | null = null;
    let chargeClassFired = false; // fast/slow classified for the current session
    let inLow = false;
    let inCritical = false;
    let wasFull = false;

    const fire = (event: BatteryEvent, bat: BatteryTelemetry) => {
      const prefs = useBatteryEventsStore.getState();
      const cfg = prefs.events[event];
      const m = META[event];
      pushToast({
        tone: m.tone,
        icon: m.icon,
        electric: cfg.anim === "electric" || cfg.anim === "neon",
        title: m.title,
        body: m.body(bat),
      });
      notify({ kind: "battery", severity: m.severity, title: m.title, body: m.notifBody });
      if (prefs.soundEnabled) playSound(cfg.sound, cfg.custom, prefs.volume);
    };

    const unsub = useTelemetryStore.subscribe((s) => {
      const bat = s.snapshot?.battery;
      if (!bat?.present) return;
      const charging = isCharging(bat.status);
      const pct = bat.chargePercent;
      const full = isFull(bat);

      // Seed baselines on the first reading — never fire on launch.
      if (prevCharging === null) {
        prevCharging = charging;
        inLow = !charging && pct <= LOW_ON;
        inCritical = !charging && pct <= CRIT_ON;
        wasFull = full;
        chargeClassFired = charging;
        return;
      }

      // --- AC connect / disconnect edges ---
      if (charging !== prevCharging) {
        console.info(
          `[charging] ${charging ? "AC connected" : "AC disconnected"} — status="${bat.status}" charge=${pct.toFixed(0)}%`,
        );
        if (charging) {
          fire("connect", bat);
          chargeClassFired = false; // re-classify fast/slow for the new session
        } else {
          fire("disconnect", bat);
        }
        prevCharging = charging;
      }

      // --- fast / slow classification (once per charging session) ---
      if (charging && !chargeClassFired && bat.powerDrawW > 1) {
        chargeClassFired = true;
        if (bat.powerDrawW >= FAST_W) fire("fastCharge", bat);
        else if (bat.powerDrawW <= SLOW_W) fire("slowCharge", bat);
      }

      // --- fully charged (hysteresis) ---
      if (full && !wasFull) {
        fire("full", bat);
        wasFull = true;
      } else if (!full && wasFull && pct < FULL_OFF) {
        wasFull = false;
      }

      // --- low / critical (only while discharging, hysteresis) ---
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
        // Charging back up clears the low/critical latches.
        if (pct > LOW_OFF) inLow = false;
        if (pct > CRIT_OFF) inCritical = false;
      }
    });
    return () => unsub();
  }, []);
}
