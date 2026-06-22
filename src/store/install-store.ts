import { create } from "zustand";
import { isTauri, installIntegration } from "@/lib/ipc";
import { notify } from "@/store/notification-store";
import type { InstallPhase, InstallProgress } from "@/lib/integrations-types";

/**
 * Global background install manager.
 *
 * Install jobs live here — NOT in the Integrations page component — so a running
 * download/install survives navigation, Settings, Doctor, and minimizing. The
 * backend `flatpak install` already runs detached on a blocking task; this store
 * keeps the *UI state* (phase, percent, size, ETA, version) alive globally and a
 * single `<InstallManager/>` listener (mounted in AppProviders) feeds it progress
 * events. The Integrations page is just a viewer that reads `jobs[flatpakId]`.
 */

export interface InstallJob {
  flatpakId: string;
  name: string;
  phase: InstallPhase;
  percent: number | null;
  downloadBytes: number | null;
  transferredBytes: number | null;
  etaSecs: number | null;
  version: string | null;
  error: string | null;
  startedAt: number;
  updatedAt: number;
}

const ACTIVE: InstallPhase[] = ["queued", "preparing", "installing", "verifying"];
export const isActive = (j?: InstallJob | null) => !!j && ACTIVE.includes(j.phase);

interface InstallState {
  jobs: Record<string, InstallJob>;
  /** Bumped whenever a job reaches `installed`, so the Integrations page can
   *  re-run detection without each card owning that responsibility. */
  completedTick: number;
  /** Begin (or no-op if already running) an install for a flatpak app. */
  start: (flatpakId: string, name: string) => Promise<void>;
  /** Fed by the single global progress listener. */
  applyProgress: (p: InstallProgress) => void;
  /** Remove a finished (installed/failed) job from the tray. */
  dismiss: (flatpakId: string) => void;
}

function newJob(flatpakId: string, name: string): InstallJob {
  const now = Date.now();
  return {
    flatpakId,
    name,
    phase: "queued",
    percent: null,
    downloadBytes: null,
    transferredBytes: null,
    etaSecs: null,
    version: null,
    error: null,
    startedAt: now,
    updatedAt: now,
  };
}

export const useInstallStore = create<InstallState>((set, get) => ({
  jobs: {},
  completedTick: 0,

  start: async (flatpakId, name) => {
    if (!flatpakId) return;
    if (isActive(get().jobs[flatpakId])) return; // already running

    const patch = (p: Partial<InstallJob>) =>
      set((s) => {
        const prev = s.jobs[flatpakId];
        if (!prev) return s;
        return { jobs: { ...s.jobs, [flatpakId]: { ...prev, ...p, updatedAt: Date.now() } } };
      });

    set((s) => ({ jobs: { ...s.jobs, [flatpakId]: newJob(flatpakId, name) } }));

    if (!isTauri()) {
      // Browser dev: simulate a believable progression so the global UI works.
      patch({ phase: "installing", downloadBytes: 240 * 1024 * 1024 });
      let pct = 0;
      const total = 240 * 1024 * 1024;
      const timer = window.setInterval(() => {
        pct = Math.min(100, pct + 7);
        patch({
          percent: pct,
          transferredBytes: Math.round((total * pct) / 100),
          etaSecs: pct < 100 ? Math.round((100 - pct) / 7) : 0,
        });
        if (pct >= 100) {
          window.clearInterval(timer);
          patch({ phase: "installed", version: "1.0.0", percent: 100 });
          set((s) => ({ completedTick: s.completedTick + 1 }));
          notify({ kind: "integration", severity: "success", title: `${name} installed`, body: "Installed via Flatpak." });
        }
      }, 350);
      return;
    }

    try {
      patch({ phase: "preparing" });
      const text = await installIntegration(flatpakId);
      const m = text.match(/v([0-9][\w.\-]*)/);
      patch({ phase: "installed", version: m ? m[1] : get().jobs[flatpakId]?.version ?? null });
      set((s) => ({ completedTick: s.completedTick + 1 }));
    } catch (e) {
      patch({ phase: "failed", error: String(e) });
    }
  },

  applyProgress: (p) =>
    set((s) => {
      const prev = s.jobs[p.flatpakId];
      if (!prev) return s;
      // Raise a notification once, on the transition into "installed".
      if (p.phase === "installed" && prev.phase !== "installed") {
        const version = p.version ?? prev.version;
        notify({
          kind: "integration",
          severity: "success",
          title: `${prev.name} installed`,
          body: version ? `Version ${version}` : "Installed via Flathub.",
        });
      }
      const job: InstallJob = {
        ...prev,
        phase: p.phase,
        // Totals/version arrive once and must persist across later events.
        downloadBytes: p.downloadBytes ?? prev.downloadBytes,
        transferredBytes: p.transferredBytes ?? prev.transferredBytes,
        percent: p.percent ?? prev.percent,
        etaSecs: p.etaSecs ?? prev.etaSecs,
        version: p.version ?? prev.version,
        updatedAt: Date.now(),
      };
      const completedTick = p.phase === "installed" ? s.completedTick + 1 : s.completedTick;
      return { jobs: { ...s.jobs, [p.flatpakId]: job }, completedTick };
    }),

  dismiss: (flatpakId) =>
    set((s) => {
      const { [flatpakId]: _gone, ...rest } = s.jobs;
      return { jobs: rest };
    }),
}));
