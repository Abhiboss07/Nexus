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
