import { useEffect } from "react";
import { useTelemetryStore } from "@/store/telemetry-store";
import {
  getCapabilities,
  getHardwareProfile,
  getHistory,
  getPowerInfo,
  listNexusProfiles,
  getActiveProfile,
  getAutomation,
  isTauri,
  onTelemetry,
  setPollInterval,
} from "@/lib/ipc";

/** Backend poll cadence while the window is hidden/minimized — a tray app
 *  shouldn't keep polling sysfs/nvidia-smi every 1.5s when nobody's looking. */
const IDLE_POLL_MS = 10_000;
import { createDemoStream, DEMO_PROFILE } from "@/lib/mock-telemetry";
import { DEMO_CAPABILITIES } from "@/lib/mock-capabilities";
import {
  useControlStore,
  DEMO_POWER_INFO,
  DEMO_NEXUS_PROFILES,
  DEMO_AUTOMATION,
} from "@/store/control-store";

/**
 * Bridges the telemetry engine to the store. Under Tauri it loads the hardware
 * profile + history, then subscribes to streamed frames (source = "live").
 * In a plain browser it runs the demo generator (source = "demo"). The rest of
 * the app reads only from the store and is agnostic to which path is active.
 */
export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  const { setSource, setProfile, setCapabilities, setHistory, ingest } =
    useTelemetryStore();
  const control = useControlStore();

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let demoTimer: number | undefined;
    let cancelled = false;

    async function connectLive() {
      try {
        const [profile, history, capabilities] = await Promise.all([
          getHardwareProfile(),
          getHistory(),
          getCapabilities(),
        ]);
        if (cancelled) return;
        setProfile(profile);
        setHistory(history);
        setCapabilities(capabilities);

        // Control state (power / profiles / automation) — best-effort.
        try {
          const [power, profiles, active, automation] = await Promise.all([
            getPowerInfo(),
            listNexusProfiles(),
            getActiveProfile(),
            getAutomation(),
          ]);
          control.setPowerInfo(power);
          control.setNexusProfiles(profiles);
          control.setActiveProfile(active);
          control.setAutomation(automation);
        } catch (err) {
          console.warn("[control] fetch failed:", err);
        }

        // Drop frames while the window is hidden — no telemetry-driven renders
        // when nobody's watching (the backend is also slowed; see below).
        unlisten = await onTelemetry((snap) => {
          if (!document.hidden) ingest(snap);
        });
        setSource("live");
      } catch (err) {
        console.warn("[telemetry] live connect failed, using demo:", err);
        if (!cancelled) startDemo();
      }
    }

    function startDemo() {
      setProfile(DEMO_PROFILE);
      setCapabilities(DEMO_CAPABILITIES);
      control.setPowerInfo(DEMO_POWER_INFO);
      control.setNexusProfiles(DEMO_NEXUS_PROFILES);
      control.setAutomation(DEMO_AUTOMATION);
      setSource("demo");
      const next = createDemoStream();
      // Prime a few frames so charts aren't empty on first paint.
      for (let i = 0; i < 40; i++) ingest(next());
      demoTimer = window.setInterval(() => {
        if (!document.hidden) ingest(next());
      }, 1500);
    }

    // Slow the *backend* collection while the window is hidden; restore the
    // user's chosen cadence when it returns. (Tauri only.)
    function onVisibility() {
      if (!isTauri()) return;
      const base = useTelemetryStore.getState().pollIntervalMs;
      setPollInterval(document.hidden ? IDLE_POLL_MS : base).catch(() => {});
    }
    document.addEventListener("visibilitychange", onVisibility);

    if (isTauri()) {
      connectLive();
    } else {
      startDemo();
    }

    return () => {
      cancelled = true;
      unlisten?.();
      if (demoTimer) window.clearInterval(demoTimer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
