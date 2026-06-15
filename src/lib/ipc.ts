/**
 * Thin IPC client. Everything funnels through here so the rest of the app never
 * imports Tauri APIs directly — and so browser dev (no Tauri) degrades cleanly.
 */
import type { HardwareProfile, HistoryPoint, ProcInfo, Snapshot } from "./telemetry-types";
import type {
  ControlAction,
  ControlOutcome,
  DriverInfo,
  HardwareCapabilities,
  RgbProfile,
  RgbRequest,
  RgbState,
} from "./capability-types";
import type {
  AutomationConfig,
  NexusProfile,
  PowerInfo,
} from "./power-types";
import type { BatteryReport, BatterySample, ChargeLimitEvidence } from "./battery-types";
import type { StorageAnalysis, SystemScan } from "./sysdoctor-types";
import type { Plugin } from "./plugins-types";
import type { OptimizerReport } from "./optimizer-types";
import type { CurvePoint, FanInfo, FanProfile, ThermalReport } from "./fan-types";
import type { GpuCapabilities, GpuInfo, GpuIntelligence } from "./gpu-types";
import type {
  Game,
  GameLaunch,
  GameProfile,
  LauncherStatus,
  MangoHudStatus,
} from "./games-types";
import type { Integration } from "./integrations-types";
import type { CommandResult, IntelligenceReport } from "./intelligence-types";
import type {
  CompatibilityReport,
  HealthCheck,
  Permissions,
  SetupState,
  UpdateInfo,
  UpdateStatus,
} from "./system-types";

/** True when running inside the Tauri webview (v2 injects __TAURI_INTERNALS__). */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const TELEMETRY_EVENT = "telemetry://snapshot";

export async function getSnapshot(): Promise<Snapshot> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<Snapshot>("get_snapshot");
}

export async function getHistory(): Promise<HistoryPoint[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<HistoryPoint[]>("get_history");
}

export async function getHardwareProfile(): Promise<HardwareProfile> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<HardwareProfile>("get_hardware_profile");
}

export async function setPollInterval(ms: number): Promise<void> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke("set_poll_interval", { ms });
}

export async function getLatency(host?: string): Promise<number | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<number | null>("get_latency", { host });
}

export async function listProcesses(limit?: number): Promise<ProcInfo[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ProcInfo[]>("list_processes", { limit });
}

export type ProcessAction = "terminate" | "force-kill" | "stop" | "continue";
export async function processAction(pid: number, action: ProcessAction): Promise<string> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string>("process_action", { pid, action });
}
export async function getProcessExe(pid: number): Promise<string | null> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<string | null>("get_process_exe", { pid });
}

export async function getCapabilities(): Promise<HardwareCapabilities> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<HardwareCapabilities>("get_capabilities");
}

export async function getActiveDrivers(): Promise<DriverInfo[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<DriverInfo[]>("get_active_drivers");
}

/** Validate + describe a control action without applying it (Phase 2B dry-run). */
export async function previewControlAction(
  action: ControlAction,
): Promise<ControlOutcome> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ControlOutcome>("preview_control_action", { action });
}

/* ----- RGB control (Phase 3.1) ----- */

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(cmd, args);
}

export const rgbApply = (request: RgbRequest) =>
  invoke<ControlOutcome>("rgb_apply", { request });
export const rgbOff = () => invoke<ControlOutcome>("rgb_off");
export const rgbState = () => invoke<RgbState | null>("rgb_state");
export const rgbPresets = () => invoke<RgbProfile[]>("rgb_presets");
export const rgbListProfiles = () => invoke<RgbProfile[]>("rgb_list_profiles");
export const rgbSaveProfile = (profile: RgbProfile) =>
  invoke<void>("rgb_save_profile", { profile });
export const rgbApplyProfile = (name: string) =>
  invoke<ControlOutcome>("rgb_apply_profile", { name });
export const rgbDeleteProfile = (name: string) =>
  invoke<void>("rgb_delete_profile", { name });
export const rgbExportProfile = (name: string) =>
  invoke<string>("rgb_export_profile", { name });
export const rgbImportProfile = (json: string) =>
  invoke<RgbProfile>("rgb_import_profile", { json });

/* ----- Power & profiles & automation (Phase 3.2) ----- */

export const getPowerInfo = () => invoke<PowerInfo>("get_power_info");
export const setProfile = (name: string) =>
  invoke<ControlOutcome>("set_profile", { name });
export const listNexusProfiles = () =>
  invoke<NexusProfile[]>("list_nexus_profiles");
export const getActiveProfile = () => invoke<string | null>("get_active_profile");
export const applyNexusProfile = (id: string) =>
  invoke<ControlOutcome>("apply_nexus_profile", { id });
export const saveNexusProfile = (profile: NexusProfile) =>
  invoke<void>("save_nexus_profile", { profile });
export const deleteNexusProfile = (id: string) =>
  invoke<void>("delete_nexus_profile", { id });
export const getAutomation = () => invoke<AutomationConfig>("get_automation");
export const setAutomation = (config: AutomationConfig) =>
  invoke<void>("set_automation", { config });

/* ----- Battery & thermal intelligence (Phase 3.3A / 3.4A) ----- */

export const getBatteryReport = () => invoke<BatteryReport | null>("get_battery_report");
export const getBatteryHistory = () => invoke<BatterySample[]>("get_battery_history");
export const exportBatteryReport = () => invoke<string | null>("export_battery_report");
export const getChargeLimitEvidence = () =>
  invoke<ChargeLimitEvidence>("get_charge_limit_evidence");
export const setChargeLimit = (percent: number) =>
  invoke<string>("set_charge_limit", { percent });
export const getFanInfo = () => invoke<FanInfo>("get_fan_info");
export const getThermalReport = () => invoke<ThermalReport>("get_thermal_report");

/* ----- Fan control (Phase 3.4B — real writes) ----- */

export const fanSetThermalProfile = (profile: string) =>
  invoke<ControlOutcome>("fan_set_thermal_profile", { profile });
export const fanSetCurve = (points: CurvePoint[]) =>
  invoke<ControlOutcome>("fan_set_curve", { points });
export const fanSetMaxFan = (on: boolean) =>
  invoke<ControlOutcome>("fan_set_max_fan", { on });
export const fanDisableCurve = () => invoke<ControlOutcome>("fan_disable_curve");
export const fanListProfiles = () => invoke<FanProfile[]>("fan_list_profiles");
export const fanApplyProfile = (name: string) =>
  invoke<ControlOutcome>("fan_apply_profile", { name });
export const fanSaveProfile = (profile: FanProfile) =>
  invoke<void>("fan_save_profile", { profile });
export const fanDeleteProfile = (name: string) =>
  invoke<void>("fan_delete_profile", { name });
export const fanExportProfile = (name: string) =>
  invoke<string>("fan_export_profile", { name });
export const fanImportProfile = (json: string) =>
  invoke<FanProfile>("fan_import_profile", { json });

/* ----- GPU & Gaming (Phase 4.0) ----- */

export const getGpuInfo = () => invoke<GpuInfo | null>("get_gpu_info");
export const getGpuCapabilities = () => invoke<GpuCapabilities>("get_gpu_capabilities");
export const getGpuIntelligence = (cpuUtil?: number) =>
  invoke<GpuIntelligence | null>("get_gpu_intelligence", { cpuUtil });

export const scanGames = (includeTools: boolean) =>
  invoke<Game[]>("scan_games", { includeTools });
export const getGameLaunchers = () => invoke<LauncherStatus>("get_game_launchers");
export const getGameProfile = (gameId: string) =>
  invoke<GameProfile>("get_game_profile", { gameId });
export const saveGameProfile = (profile: GameProfile) =>
  invoke<void>("save_game_profile", { profile });
export const deleteGameProfile = (gameId: string) =>
  invoke<void>("delete_game_profile", { gameId });
export const gameLaunchInfo = (gameId: string) =>
  invoke<GameLaunch | null>("game_launch_info", { gameId });
export const applyGameProfile = (gameId: string) =>
  invoke<ControlOutcome>("apply_game_profile", { gameId });

export const getMangoHudStatus = () => invoke<MangoHudStatus>("get_mangohud_status");
export const mangohudApply = (config: string) =>
  invoke<void>("mangohud_apply", { config });

/* ----- System integrations (Phase 4.5) ----- */

export const getIntegrations = () => invoke<Integration[]>("get_integrations");
/** One-click flatpak install (user-level). Returns the install log. */
export const installIntegration = (flatpakId: string) =>
  invoke<string>("install_integration", { flatpakId });

/* ----- System Doctor: deep scan + storage analyzer ----- */

export const runSystemScan = () => invoke<SystemScan>("run_system_scan");
export const getStorageAnalysis = () => invoke<StorageAnalysis>("get_storage_analysis");
export const deleteFile = (path: string) => invoke<string>("delete_file", { path });
export const moveFile = (src: string, dest: string) =>
  invoke<string>("move_file", { src, dest });
export const revealFile = (path: string) => invoke<string>("reveal_file", { path });

/* ----- Plugins ----- */

export const listPlugins = () => invoke<Plugin[]>("list_plugins");
export const setPluginEnabled = (id: string, enabled: boolean) =>
  invoke<boolean>("set_plugin_enabled", { id, enabled });
export const getPluginsDir = () => invoke<string>("get_plugins_dir");

/* ----- Linux Optimizer ----- */

export const optimizerScan = () => invoke<OptimizerReport>("optimizer_scan");
export const optimizerDropCaches = (level: number) =>
  invoke<string>("optimizer_drop_caches", { level });
export const optimizerRemoveOrphans = () =>
  invoke<string>("optimizer_remove_orphans");
export const optimizerVacuumJournal = (days: number) =>
  invoke<string>("optimizer_vacuum_journal", { days });
export const optimizerCleanTemp = (id: string) =>
  invoke<string>("optimizer_clean_temp", { id });
export const optimizerSetStartup = (id: string, kind: string, enabled: boolean) =>
  invoke<string>("optimizer_set_startup", { id, kind, enabled });

/* ----- Intelligence Core (Phase 5.0) ----- */

export const getIntelligence = (cpuUtil?: number) =>
  invoke<IntelligenceReport>("get_intelligence", { cpuUtil });
export const nlpCommand = (input: string) =>
  invoke<CommandResult>("nlp_command", { input });

/* ----- Production: diagnostics / setup / autostart / update (Phase 5.5) ----- */

export const runHealthCheck = () => invoke<HealthCheck>("run_health_check");
export const checkPermissions = () => invoke<Permissions>("check_permissions");
export const getCompatibility = () =>
  invoke<CompatibilityReport>("get_compatibility");
export const exportDiagnostics = () => invoke<string>("export_diagnostics");
export const getSetupState = () => invoke<SetupState>("get_setup_state");
export const setSetupComplete = () => invoke<void>("set_setup_complete");
export const getAutostart = () => invoke<boolean>("get_autostart");
export const setAutostart = (enabled: boolean) =>
  invoke<void>("set_autostart", { enabled });
export const appUpdateInfo = () => invoke<UpdateInfo>("app_update_info");
/** Query the signed updater feed for a newer release (read-only). */
export const checkForUpdate = () => invoke<UpdateStatus>("check_for_update");
/** Download + install the latest signed update, then restart to apply. */
export const installUpdate = () => invoke<boolean>("install_update");

/** Subscribe to streamed telemetry frames. Returns an unlisten function. */
export async function onTelemetry(
  handler: (snapshot: Snapshot) => void,
): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<Snapshot>(TELEMETRY_EVENT, (e) => handler(e.payload));
}
