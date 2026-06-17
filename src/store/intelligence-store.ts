import { create } from "zustand";
import type { IntelligenceReport, Subsystem } from "@/lib/intelligence-types";

/**
 * Holds the latest intelligence report, published by the single global poller
 * (`useIntelligencePoller`, mounted once in AppProviders). Consumers subscribe
 * to narrow slices — a primitive like the health score is referentially stable
 * across polls when it hasn't changed, so an idle dashboard doesn't re-render on
 * every 4s recompute. (Mirrors the telemetry-store selector discipline.)
 */
interface IntelligenceState {
  report: IntelligenceReport | null;
  setReport: (r: IntelligenceReport | null) => void;
}

export const useIntelligenceStore = create<IntelligenceState>((set) => ({
  report: null,
  setReport: (report) => set({ report }),
}));

/** Full report (for the Intelligence page, which renders every section). */
export const useIntelligenceReport = () => useIntelligenceStore((s) => s.report);

export const useHealthScore = () =>
  useIntelligenceStore((s) => s.report?.health.overallScore ?? 0);
export const useHealthGrade = () =>
  useIntelligenceStore((s) => s.report?.health.grade ?? "…");

// Stable empty fallback — never synthesize a fresh array inside the selector.
const EMPTY_SUBS: Subsystem[] = [];
export const useHealthSubsystems = () =>
  useIntelligenceStore((s) => s.report?.health.subsystems ?? EMPTY_SUBS);
