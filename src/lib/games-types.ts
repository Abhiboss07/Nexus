/** TS mirror of src-tauri/src/control/games (Phase 4.0). */
import type { RgbSpec } from "./power-types";

export interface Game {
  id: string;
  name: string;
  source: string; // steam | lutris | heroic | native
  appId: string | null;
  installDir: string | null;
  sizeBytes: number;
  lastPlayed: number | null;
  isTool: boolean;
}

export interface LauncherStatus {
  steam: boolean;
  lutris: boolean;
  heroic: boolean;
  gamemode: boolean;
  gamescope: boolean;
  mangohud: boolean;
  primeRun: boolean;
}

export interface EnvVar {
  key: string;
  value: string;
}

export interface GameProfile {
  gameId: string;
  rgb: RgbSpec | null;
  power: string | null;
  fan: string | null;
  launchCommand: string | null;
  envVars: EnvVar[];
  usePrime: boolean;
  useGamemode: boolean;
  useMangohud: boolean;
}

export interface GameLaunch {
  command: string;
  steamLaunchOptions: string;
}

export interface MangoHudPreset {
  name: string;
  description: string;
  config: string;
}

export interface MangoHudStatus {
  available: boolean;
  configPath: string;
  configExists: boolean;
  currentConfig: string | null;
  presets: MangoHudPreset[];
}
