/** TS mirror of src-tauri/src/control/integrations.rs (Phase 4.5). */

export type IntegrationCategory =
  | "gaming"
  | "hardware"
  | "launchers"
  | "containers"
  | "development"
  | "ai"
  | "system";

export interface Integration {
  id: string;
  name: string;
  category: IntegrationCategory;
  detected: boolean;
  detail: string;
  hint: string;
  docUrl: string;
  /** Non-empty when the tool can be installed one-click via Flatpak. */
  flatpakId: string;
}

/** Flatpak readiness — drives the "Add Flathub" prompt and per-card states. */
export interface FlatpakHealth {
  flatpakInstalled: boolean;
  flathubRemote: boolean;
}

/** Live install phases (real backend steps — emitted on `integration-progress`). */
export type InstallPhase =
  | "queued"
  | "preparing"
  | "installing"
  | "verifying"
  | "installed"
  | "failed";

export interface InstallProgress {
  flatpakId: string;
  phase: InstallPhase;
  version: string | null;
}
