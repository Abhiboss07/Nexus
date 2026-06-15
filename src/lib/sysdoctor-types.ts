/** TS mirror of src-tauri/src/sysdoctor.rs — deep System Doctor scan. */

export type Severity = "ok" | "info" | "warning" | "critical";

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
