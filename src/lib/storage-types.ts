/** TS mirror of src-tauri/src/storage.rs — Storage Analyzer Pro. */

export interface ScanRoot {
  id: string;
  label: string;
  path: string;
  sizeBytes: number;
}

export interface TreeNode {
  name: string;
  path: string;
  sizeBytes: number;
  isDir: boolean;
}

export interface TreeLevel {
  path: string;
  sizeBytes: number;
  children: TreeNode[];
}

export interface FileInfo {
  name: string;
  path: string;
  sizeBytes: number;
  modified: number;
  ext: string;
}

export interface DupGroup {
  sizeBytes: number;
  files: FileInfo[];
  wastedBytes: number;
}

export interface AppUsage {
  app: string;
  totalBytes: number;
  configBytes: number;
  cacheBytes: number;
  dataBytes: number;
  present: boolean;
}

export type DupCategory = "generic" | "images" | "videos" | "archives" | "isos";
