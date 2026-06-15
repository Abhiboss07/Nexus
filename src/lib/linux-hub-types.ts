/** TS mirror of src-tauri/src/linux_hub.rs — Linux Hub. */

export interface ServiceUnit {
  name: string;
  description: string;
  load: string;
  active: string;
  sub: string;
  enabled: string;
  user: boolean;
}

export type ServiceActionKind =
  | "start" | "stop" | "restart" | "enable" | "disable"
  | "mask" | "unmask" | "status" | "logs";

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export interface DockerImage {
  id: string;
  repo: string;
  tag: string;
  size: string;
}

export interface DockerVolume {
  name: string;
  driver: string;
}

export interface DockerOverview {
  available: boolean;
  running: boolean;
  containers: DockerContainer[];
  images: DockerImage[];
  volumes: DockerVolume[];
}

export interface FlatpakApp {
  id: string;
  name: string;
  version: string;
  size: string;
  hasUpdate: boolean;
}

export interface FlatpakOverview {
  available: boolean;
  apps: FlatpakApp[];
  runtimes: number;
  unusedRuntimes: string[];
  updates: number;
}

export interface UpdateCounts {
  pacman: number;
  aur: number;
  flatpak: number;
  aurHelper: string;
  pacmanSupported: boolean;
  flatpakSupported: boolean;
}
