import { create } from "zustand";
import type {
  HardwareProfile,
  HistoryPoint,
  Snapshot,
  TelemetrySource,
} from "@/lib/telemetry-types";
import type { HardwareCapabilities } from "@/lib/capability-types";

const HISTORY_CAP = 120;

interface TelemetryState {
  source: TelemetrySource;
  snapshot: Snapshot | null;
  history: HistoryPoint[];
  profile: HardwareProfile | null;
  capabilities: HardwareCapabilities | null;

  setSource: (s: TelemetrySource) => void;
  setProfile: (p: HardwareProfile) => void;
  setCapabilities: (c: HardwareCapabilities) => void;
  setHistory: (h: HistoryPoint[]) => void;
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

  setSource: (source) => set({ source }),
  setProfile: (profile) => set({ profile }),
  setCapabilities: (capabilities) => set({ capabilities }),
  setHistory: (history) => set({ history: history.slice(-HISTORY_CAP) }),
  ingest: (snapshot) =>
    set((state) => {
      const history = [...state.history, toPoint(snapshot)];
      if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);
      return { snapshot, history };
    }),
}));
