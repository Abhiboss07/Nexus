/** TS mirror of src-tauri/src/control/integrations.rs (Phase 4.5). */

export type IntegrationCategory =
  | "gaming"
  | "hardware"
  | "launchers"
  | "containers"
  | "system";

export interface Integration {
  id: string;
  name: string;
  category: IntegrationCategory;
  detected: boolean;
  detail: string;
  hint: string;
}
