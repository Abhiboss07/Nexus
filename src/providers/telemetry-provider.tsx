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
} from "@/lib/ipc";
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

        unlisten = await onTelemetry((snap) => ingest(snap));
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
      demoTimer = window.setInterval(() => ingest(next()), 1500);
    }

    if (isTauri()) {
      connectLive();
    } else {
      startDemo();
    }

    return () => {
      cancelled = true;
      unlisten?.();
      if (demoTimer) window.clearInterval(demoTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
