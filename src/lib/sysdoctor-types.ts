/** TS mirror of src-tauri/src/sysdoctor.rs — deep System Doctor scan. */

/** Real-world impact ladder: ok < info < low < warning < high < critical. */
export type Severity = "ok" | "info" | "low" | "warning" | "high" | "critical";

export interface Finding {
  severity: Severity;
  title: string;
  detail: string;
  fix: string;
  /** "service" | "journal" | "coredump" | "package" | "" */
  kind: string;
  /** systemd unit this finding refers to (for Restart/Logs/Status). */
  unit: string | null;
  /** True for --user units (no pkexec needed). */
  userScope: boolean;
  /** Plain-language cause. Optional (older payloads / demo data may omit). */
  why?: string;
  /** Consequence in human terms. */
  impact?: string;
  /** Check confidence, 0–100. */
  confidence?: number;
}

export interface ScanCategory {
  id: string;
  label: string;
  status: Severity;
  summary: string;
  findings: Finding[];
}

export interface FileEntry {
  path: string;
  sizeBytes: number;
}

export interface StorageAnalysis {
  home: string;
  largestFiles: FileEntry[];
  largestFolders: FileEntry[];
  recommendations: Finding[];
}

export interface SystemScan {
  categories: ScanCategory[];
  storage: StorageAnalysis;
  score: number;
  generatedMs: number;
}
