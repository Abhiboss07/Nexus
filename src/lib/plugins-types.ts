/** TS mirror of src-tauri/src/control/plugins.rs. */

export interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  kind: string;
  enabled: boolean;
  source: string;
}
