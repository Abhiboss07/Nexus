import { useMemo } from "react";
import { useControlStore } from "@/store/control-store";
import { useTelemetrySource } from "@/hooks/use-telemetry";
import {
  setProfile as ipcSetProfile,
  getPowerInfo,
  applyNexusProfile as ipcApplyProfile,
  getActiveProfile,
  setAutomation as ipcSetAutomation,
} from "@/lib/ipc";
import type { AutomationConfig } from "@/lib/power-types";

export const usePowerInfo = () => useControlStore((s) => s.powerInfo);
export const useNexusProfiles = () => useControlStore((s) => s.nexusProfiles);
export const useActiveProfile = () => useControlStore((s) => s.activeProfile);
export const useAutomation = () => useControlStore((s) => s.automation);

export interface ActionResult {
  ok: boolean;
  msg: string;
}

/** Translate a serialized Rust ControlError into a friendly message. */
export function formatControlError(e: unknown): string {
  const err = e as { kind?: string; detail?: string };
  switch (err?.kind) {
    case "permissionDenied":
      return "Permission denied — this action needs elevated privileges.";
    case "driverUnavailable":
      return `Unavailable: ${err.detail ?? "no controller"}`;
    case "invalidParameter":
      return `Invalid: ${err.detail ?? ""}`;
    case "notImplemented":
      return "Not implemented yet.";
    default:
      return typeof e === "string" ? e : "Action failed.";
  }
}

/** Bound, optimistic control actions (no-op IPC in demo mode). */
export function useControlActions() {
  const source = useTelemetrySource();
  const live = source === "live";

  return useMemo(
    () => ({
      async setPower(name: string): Promise<ActionResult> {
        const store = useControlStore.getState();
        store.markPowerActive(name); // optimistic
        if (!live) return { ok: true, msg: `Demo — would set power profile to ${name}.` };
        try {
          const out = await ipcSetProfile(name);
          store.setPowerInfo(await getPowerInfo());
          return { ok: out.applied, msg: out.message };
        } catch (e) {
          store.setPowerInfo(await getPowerInfo().catch(() => store.powerInfo!));
          return { ok: false, msg: formatControlError(e) };
        }
      },

      async applyProfile(id: string): Promise<ActionResult> {
        const store = useControlStore.getState();
        const profile = store.nexusProfiles.find((p) => p.id === id);
        store.setActiveProfile(id);
        if (profile?.power) store.markPowerActive(profile.power);
        if (!live) return { ok: true, msg: `Demo — would apply ${profile?.name ?? id}.` };
        try {
          const out = await ipcApplyProfile(id);
          store.setPowerInfo(await getPowerInfo());
          store.setActiveProfile(await getActiveProfile());
          return { ok: out.applied, msg: out.message };
        } catch (e) {
          return { ok: false, msg: formatControlError(e) };
        }
      },

      async saveAutomation(config: AutomationConfig): Promise<ActionResult> {
        const store = useControlStore.getState();
        store.setAutomation(config); // optimistic
        if (!live) return { ok: true, msg: "Demo — automation saved locally." };
        try {
          await ipcSetAutomation(config);
          return { ok: true, msg: "Automation saved." };
        } catch (e) {
          return { ok: false, msg: formatControlError(e) };
        }
      },
    }),
    [live],
  );
}
