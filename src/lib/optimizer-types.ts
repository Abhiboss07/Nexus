/** TS mirror of src-tauri/src/optimizer.rs — Linux Optimizer. */

export interface MemoryInfo {
  totalBytes: number;
  freeBytes: number;
  availableBytes: number;
  cachedBytes: number;
  buffersBytes: number;
  sreclaimableBytes: number;
  swapTotalBytes: number;
  swapUsedBytes: number;
  reclaimableBytes: number;
}

export interface OrphanPackages {
  supported: boolean;
  manager: string;
  count: number;
  names: string[];
}

export interface JournalInfo {
  supported: boolean;
  sizeBytes: number;
  human: string;
}

export interface CleanupTarget {
  id: string;
  label: string;
  path: string;
  sizeBytes: number;
  userLevel: boolean;
  note: string;
}

export interface StartupItem {
  id: string;
  name: string;
  kind: "service" | "autostart";
  enabled: boolean;
  detail: string;
}

export interface OptimizerReport {
  memory: MemoryInfo;
  temp: CleanupTarget[];
  orphans: OrphanPackages;
  journal: JournalInfo;
  startup: StartupItem[];
  reclaimableBytes: number;
  pkexecAvailable: boolean;
}
