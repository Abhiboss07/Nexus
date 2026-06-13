import { useMemo } from "react";
import { useTelemetryStore } from "@/store/telemetry-store";
import type {
  FanTelemetry,
  HistoryPoint,
  StorageTelemetry,
} from "@/lib/telemetry-types";

/**
 * Stable empty fallbacks. Zustand v5 uses a plain `useSyncExternalStore`, so a
 * selector MUST return a referentially-stable value for unchanged state — a
 * fresh `[]`/`{}` synthesized inside the selector makes `getSnapshot` differ on
 * every call and throws "Maximum update depth exceeded". Never build arrays or
 * objects inside a selector; reference these constants instead.
 */
const EMPTY_STORAGE: StorageTelemetry[] = [];
const EMPTY_FANS: FanTelemetry[] = [];

/** Latest full snapshot (null until the first frame arrives). */
export const useSnapshot = () => useTelemetryStore((s) => s.snapshot);

export const useCpu = () => useTelemetryStore((s) => s.snapshot?.cpu ?? null);
export const useGpu = () => useTelemetryStore((s) => s.snapshot?.gpu ?? null);
export const useMemory = () => useTelemetryStore((s) => s.snapshot?.memory ?? null);
export const useStorage = () =>
  useTelemetryStore((s) => s.snapshot?.storage ?? EMPTY_STORAGE);
export const useBattery = () => useTelemetryStore((s) => s.snapshot?.battery ?? null);
export const useNetwork = () => useTelemetryStore((s) => s.snapshot?.network ?? null);
export const useFans = () =>
  useTelemetryStore((s) => s.snapshot?.fans ?? EMPTY_FANS);
export const useThermals = () => useTelemetryStore((s) => s.snapshot?.thermals ?? null);

export const useHistory = () => useTelemetryStore((s) => s.history);
export const useHardwareProfile = () => useTelemetryStore((s) => s.profile);
export const useTelemetrySource = () => useTelemetryStore((s) => s.source);

/** Full capability set (null until detected). */
export const useCapabilities = () => useTelemetryStore((s) => s.capabilities);

/** One capability domain (e.g. `useCapability("fan")`). */
export function useCapability<K extends "rgb" | "fan" | "power" | "battery" | "mux">(
  domain: K,
) {
  return useTelemetryStore((s) => s.capabilities?.[domain] ?? null);
}

/**
 * Extract one numeric channel from history as a plain array (charts).
 * The selector returns ONLY `state.history` (a stable reference that changes
 * solely when a frame is ingested); the `.map` transform happens in `useMemo`
 * OUTSIDE the selector, so `getSnapshot` stays referentially stable.
 */
export function useHistorySeries(
  key: keyof Omit<HistoryPoint, "ts">,
): number[] {
  const history = useTelemetryStore((s) => s.history);
  return useMemo(() => history.map((p) => p[key]), [history, key]);
}
