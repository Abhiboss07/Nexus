import { create } from "zustand";
import type {
  HardwareProfile,
  HistoryPoint,
  Snapshot,
  TelemetrySource,
} from "@/lib/telemetry-types";
import type { HardwareCapabilities } from "@/lib/capability-types";

const HISTORY_CAP = 120;
/** Default live poll cadence (ms). Settings can override; the provider slows it
 *  further when the window is hidden. */
export const DEFAULT_POLL_MS = 1500;

interface TelemetryState {
  source: TelemetrySource;
  snapshot: Snapshot | null;
  history: HistoryPoint[];
  profile: HardwareProfile | null;
  capabilities: HardwareCapabilities | null;
  /** Desired foreground poll interval (ms). The provider restores to this when
   *  the window regains focus. */
  pollIntervalMs: number;

  setSource: (s: TelemetrySource) => void;
  setProfile: (p: HardwareProfile) => void;
  setCapabilities: (c: HardwareCapabilities) => void;
  setHistory: (h: HistoryPoint[]) => void;
  setPollIntervalMs: (ms: number) => void;
  /** Ingest a frame: store it and append a derived history point. */
  ingest: (snapshot: Snapshot) => void;
}

function toPoint(s: Snapshot): HistoryPoint {
  return {
    ts: s.timestamp,
    cpuUsage: s.cpu.usage,
    cpuTemp: s.cpu.temperatureC ?? 0,
    gpuUsage: s.gpu?.usage ?? 0,
    gpuTemp: s.gpu?.temperatureC ?? 0,
    memUsage: s.memory.usage,
    netDown: s.network.downloadBytesSec,
    netUp: s.network.uploadBytesSec,
    cpuFanRpm: s.fans.find((f) => f.label === "CPU Fan")?.rpm ?? 0,
    gpuFanRpm: s.fans.find((f) => f.label === "GPU Fan")?.rpm ?? 0,
  };
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  source: "connecting",
  snapshot: null,
  history: [],
  profile: null,
  capabilities: null,
  pollIntervalMs: DEFAULT_POLL_MS,

  setSource: (source) => set({ source }),
  setProfile: (profile) => set({ profile }),
  setCapabilities: (capabilities) => set({ capabilities }),
  setHistory: (history) => set({ history: history.slice(-HISTORY_CAP) }),
  setPollIntervalMs: (pollIntervalMs) => set({ pollIntervalMs }),
  ingest: (snapshot) =>
    set((state) => {
      const history = [...state.history, toPoint(snapshot)];
      if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
      return { snapshot, history };
    }),
}));
