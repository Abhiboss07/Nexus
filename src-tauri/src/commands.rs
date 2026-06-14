//! Tauri IPC surface. Thin wrappers over the telemetry service; all heavy work
//! lives in the engine. Commands never block on long operations beyond a single
//! cheap collect.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_autostart::ManagerExt;

use crate::diagnostics::{self, HealthCheck, Permissions};
use crate::logging;

use crate::control::automation::AutomationConfig;
use crate::control::battery::{BatteryReport, BatterySample};
use crate::control::fan::{CurvePoint, FanInfo, FanProfile, ThermalReport};
use crate::control::games::profiles::GameLaunch;
use crate::control::games::{Game, GameProfile, LauncherStatus, MangoHudStatus};
use crate::control::gpu::{GpuCapabilities, GpuInfo, GpuIntelligence};
use crate::control::integrations::Integration;
use crate::control::intelligence::{CommandResult, IntelligenceReport};
use crate::control::nexus::NexusProfile;
use crate::control::power::PowerInfo;
use crate::control::registry::DriverInfo;
use crate::control::rgb::RgbProfile;
use crate::control::traits::{ControlError, ControlOutcome, RgbRequest, RgbState};
use crate::control::{ControlAction, ControlService, HardwareCapabilities};
use crate::telemetry::processes::{ProcInfo, ProcessMonitor};
use crate::telemetry::{collectors, HardwareProfile, HistoryPoint, Snapshot, TelemetryService};

/// Shared application state managed by Tauri and the polling thread.
pub struct AppState {
    pub service: Arc<Mutex<TelemetryService>>,
    pub interval_ms: Arc<AtomicU64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: &'static str,
    pub version: &'static str,
    pub tagline: &'static str,
}

#[tauri::command]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "Nexus Control Center",
        version: env!("CARGO_PKG_VERSION"),
        tagline: "The next-generation Linux control center",
    }
}

/// Latest telemetry frame. Returns the cached frame from the poller, or collects
/// a fresh one if the loop hasn't produced one yet.
#[tauri::command]
pub fn get_snapshot(state: State<'_, AppState>) -> Result<Snapshot, String> {
    let mut svc = state.service.lock().map_err(|e| e.to_string())?;
    if let Some(snapshot) = svc.latest() {
        return Ok(snapshot);
    }
    Ok(svc.collect())
}

#[tauri::command]
pub fn get_history(state: State<'_, AppState>) -> Result<Vec<HistoryPoint>, String> {
    let svc = state.service.lock().map_err(|e| e.to_string())?;
    Ok(svc.history())
}

#[tauri::command]
pub fn get_hardware_profile(state: State<'_, AppState>) -> Result<HardwareProfile, String> {
    let svc = state.service.lock().map_err(|e| e.to_string())?;
    Ok(svc.profile())
}

/// Adjust the streaming poll interval at runtime (clamped to a sane range).
#[tauri::command]
pub fn set_poll_interval(state: State<'_, AppState>, ms: u64) {
    state.interval_ms.store(ms.clamp(250, 10_000), Ordering::Relaxed);
}

/// On-demand network latency probe (kept out of the hot loop).
#[tauri::command]
pub fn get_latency(host: Option<String>) -> Option<f32> {
    collectors::ping_latency(host.as_deref().unwrap_or("1.1.1.1"))
}

/// Top processes by CPU/memory (read-only — no process control).
#[tauri::command]
pub fn list_processes(
    monitor: State<'_, Mutex<ProcessMonitor>>,
    limit: Option<usize>,
) -> Vec<ProcInfo> {
    monitor
        .lock()
        .map(|mut m| m.sample(limit.unwrap_or(40)))
        .unwrap_or_default()
}

/* ----- Hardware control (Phase 2B: capability discovery + dry-run only) ----- */

/// The machine's detected control capabilities. The UI gates controls on this.
#[tauri::command]
pub fn get_capabilities(control: State<'_, ControlService>) -> HardwareCapabilities {
    control.capabilities()
}

/// Which driver backs each control domain (diagnostics).
#[tauri::command]
pub fn get_active_drivers(control: State<'_, ControlService>) -> Vec<DriverInfo> {
    control.drivers()
}

/// Multi-hardware compatibility & write-safety report (finding C1). Tells the
/// UI/diagnostics which write paths are enabled and why on this exact machine.
#[tauri::command]
pub fn get_compatibility(control: State<'_, ControlService>) -> crate::control::CompatibilityReport {
    control.compatibility_report()
}

/// Validate + describe a control action without applying it. The only write
/// surface in Phase 2B — real writes land in Phase 3.
#[tauri::command]
pub fn preview_control_action(
    control: State<'_, ControlService>,
    action: ControlAction,
) -> Result<ControlOutcome, ControlError> {
    control.preview(&action)
}

/* ----- RGB control (Phase 3.1: real hardware writes) ----- */

#[tauri::command]
pub fn rgb_apply(
    control: State<'_, ControlService>,
    request: RgbRequest,
) -> Result<ControlOutcome, ControlError> {
    control.rgb_apply(&request)
}

#[tauri::command]
pub fn rgb_off(control: State<'_, ControlService>) -> Result<ControlOutcome, ControlError> {
    control.rgb_off()
}

#[tauri::command]
pub fn rgb_state(control: State<'_, ControlService>) -> Option<RgbState> {
    control.rgb_state()
}

#[tauri::command]
pub fn rgb_presets(control: State<'_, ControlService>) -> Vec<RgbProfile> {
    control.rgb_presets()
}

#[tauri::command]
pub fn rgb_list_profiles(control: State<'_, ControlService>) -> Vec<RgbProfile> {
    control.rgb_list_profiles()
}

#[tauri::command]
pub fn rgb_save_profile(
    control: State<'_, ControlService>,
    profile: RgbProfile,
) -> Result<(), ControlError> {
    control.rgb_save_profile(&profile)
}

#[tauri::command]
pub fn rgb_apply_profile(
    control: State<'_, ControlService>,
    name: String,
) -> Result<ControlOutcome, ControlError> {
    control.rgb_apply_profile(&name)
}

#[tauri::command]
pub fn rgb_delete_profile(
    control: State<'_, ControlService>,
    name: String,
) -> Result<(), ControlError> {
    control.rgb_delete_profile(&name)
}

#[tauri::command]
pub fn rgb_export_profile(
    control: State<'_, ControlService>,
    name: String,
) -> Result<String, ControlError> {
    control.rgb_export_profile(&name)
}

#[tauri::command]
pub fn rgb_import_profile(
    control: State<'_, ControlService>,
    json: String,
) -> Result<RgbProfile, ControlError> {
    control.rgb_import_profile(&json)
}

/* ----- Power & performance (Phase 3.2) ----- */

#[tauri::command]
pub fn get_power_info(control: State<'_, ControlService>) -> PowerInfo {
    control.power_info()
}

#[tauri::command]
pub fn get_current_profile(control: State<'_, ControlService>) -> Option<String> {
    control.power_current()
}

#[tauri::command]
pub fn get_available_profiles(control: State<'_, ControlService>) -> Vec<String> {
    control.power_available()
}

#[tauri::command]
pub fn set_profile(
    control: State<'_, ControlService>,
    name: String,
) -> Result<ControlOutcome, ControlError> {
    control.power_set(&name)
}

/* ----- Nexus profiles ----- */

#[tauri::command]
pub fn list_nexus_profiles(control: State<'_, ControlService>) -> Vec<NexusProfile> {
    control.list_nexus_profiles()
}

#[tauri::command]
pub fn get_active_profile(control: State<'_, ControlService>) -> Option<String> {
    control.active_nexus_profile()
}

#[tauri::command]
pub fn apply_nexus_profile(
    control: State<'_, ControlService>,
    id: String,
) -> Result<ControlOutcome, ControlError> {
    control.apply_nexus_profile(&id)
}

#[tauri::command]
pub fn save_nexus_profile(
    control: State<'_, ControlService>,
    profile: NexusProfile,
) -> Result<(), ControlError> {
    control.save_nexus_profile(&profile)
}

#[tauri::command]
pub fn delete_nexus_profile(
    control: State<'_, ControlService>,
    id: String,
) -> Result<(), ControlError> {
    control.delete_nexus_profile(&id)
}

/* ----- Automation ----- */

#[tauri::command]
pub fn get_automation(control: State<'_, ControlService>) -> AutomationConfig {
    control.get_automation()
}

#[tauri::command]
pub fn set_automation(control: State<'_, ControlService>, config: AutomationConfig) {
    control.set_automation(config)
}

/* ----- Battery intelligence (Phase 3.3A) ----- */

#[tauri::command]
pub fn get_battery_report(control: State<'_, ControlService>) -> Option<BatteryReport> {
    control.battery_report()
}

#[tauri::command]
pub fn get_battery_history(control: State<'_, ControlService>) -> Vec<BatterySample> {
    control.battery_history()
}

#[tauri::command]
pub fn export_battery_report(control: State<'_, ControlService>) -> Option<String> {
    control.battery_export()
}

/* ----- Fan & thermal intelligence (Phase 3.4A — read-only) ----- */

#[tauri::command]
pub fn get_fan_info(control: State<'_, ControlService>) -> FanInfo {
    control.fan_info()
}

#[tauri::command]
pub fn get_thermal_report(control: State<'_, ControlService>) -> ThermalReport {
    control.thermal_report()
}

/* ----- Fan control (Phase 3.4B — real writes; Victus-S verified) ----- */

#[tauri::command]
pub fn fan_set_thermal_profile(
    control: State<'_, ControlService>,
    profile: String,
) -> Result<ControlOutcome, ControlError> {
    control.fan_set_thermal_profile(&profile)
}

#[tauri::command]
pub fn fan_set_curve(
    control: State<'_, ControlService>,
    points: Vec<CurvePoint>,
) -> Result<ControlOutcome, ControlError> {
    control.fan_set_curve(points)
}

#[tauri::command]
pub fn fan_set_max_fan(
    control: State<'_, ControlService>,
    on: bool,
) -> Result<ControlOutcome, ControlError> {
    control.fan_set_max_fan(on)
}

#[tauri::command]
pub fn fan_disable_curve(
    control: State<'_, ControlService>,
) -> Result<ControlOutcome, ControlError> {
    control.fan_disable_curve()
}

#[tauri::command]
pub fn fan_list_profiles(control: State<'_, ControlService>) -> Vec<FanProfile> {
    control.fan_list_profiles()
}

#[tauri::command]
pub fn fan_apply_profile(
    control: State<'_, ControlService>,
    name: String,
) -> Result<ControlOutcome, ControlError> {
    control.fan_apply_profile(&name)
}

#[tauri::command]
pub fn fan_save_profile(
    control: State<'_, ControlService>,
    profile: FanProfile,
) -> Result<(), ControlError> {
    control.fan_save_profile(&profile)
}

#[tauri::command]
pub fn fan_delete_profile(
    control: State<'_, ControlService>,
    name: String,
) -> Result<(), ControlError> {
    control.fan_delete_profile(&name)
}

#[tauri::command]
pub fn fan_export_profile(
    control: State<'_, ControlService>,
    name: String,
) -> Result<String, ControlError> {
    control.fan_export_profile(&name)
}

#[tauri::command]
pub fn fan_import_profile(
    control: State<'_, ControlService>,
    json: String,
) -> Result<FanProfile, ControlError> {
    control.fan_import_profile(&json)
}

/* ----- GPU discovery & intelligence (Phase 4.0) ----- */

#[tauri::command]
pub fn get_gpu_info(control: State<'_, ControlService>) -> Option<GpuInfo> {
    control.gpu_info()
}

#[tauri::command]
pub fn get_gpu_capabilities(control: State<'_, ControlService>) -> GpuCapabilities {
    control.gpu_capabilities()
}

#[tauri::command]
pub fn get_gpu_intelligence(
    control: State<'_, ControlService>,
    cpu_util: Option<f32>,
) -> Option<GpuIntelligence> {
    control.gpu_intelligence(cpu_util)
}

/* ----- Gaming Center (Phase 4.0) ----- */

#[tauri::command]
pub fn scan_games(control: State<'_, ControlService>, include_tools: bool) -> Vec<Game> {
    control.scan_games(include_tools)
}

#[tauri::command]
pub fn get_game_launchers(control: State<'_, ControlService>) -> LauncherStatus {
    control.game_launchers()
}

#[tauri::command]
pub fn get_game_profile(control: State<'_, ControlService>, game_id: String) -> GameProfile {
    control.get_game_profile(&game_id)
}

#[tauri::command]
pub fn save_game_profile(
    control: State<'_, ControlService>,
    profile: GameProfile,
) -> Result<(), ControlError> {
    control.save_game_profile(&profile)
}

#[tauri::command]
pub fn delete_game_profile(
    control: State<'_, ControlService>,
    game_id: String,
) -> Result<(), ControlError> {
    control.delete_game_profile(&game_id)
}

#[tauri::command]
pub fn game_launch_info(
    control: State<'_, ControlService>,
    game_id: String,
) -> Option<GameLaunch> {
    control.game_launch_info(&game_id)
}

#[tauri::command]
pub fn apply_game_profile(
    control: State<'_, ControlService>,
    game_id: String,
) -> Result<ControlOutcome, ControlError> {
    control.apply_game_profile(&game_id)
}

/* ----- MangoHud overlay ----- */

#[tauri::command]
pub fn get_mangohud_status(control: State<'_, ControlService>) -> MangoHudStatus {
    control.mangohud_status()
}

#[tauri::command]
pub fn mangohud_apply(
    control: State<'_, ControlService>,
    config: String,
) -> Result<(), ControlError> {
    control.mangohud_apply(&config)
}

/* ----- System integrations (Phase 4.5) ----- */

#[tauri::command]
pub fn get_integrations(control: State<'_, ControlService>) -> Vec<Integration> {
    control.integrations()
}

/* ----- Intelligence Core (Phase 5.0) ----- */

#[tauri::command]
pub fn get_intelligence(
    app: State<'_, AppState>,
    control: State<'_, ControlService>,
    cpu_util: Option<f32>,
) -> Result<IntelligenceReport, String> {
    let (snapshot, history) = {
        let svc = app.service.lock().map_err(|e| e.to_string())?;
        (svc.latest().unwrap_or_default(), svc.history())
    };
    Ok(control.intelligence_report(&snapshot, &history, cpu_util))
}

#[tauri::command]
pub fn nlp_command(
    app: State<'_, AppState>,
    control: State<'_, ControlService>,
    input: String,
) -> CommandResult {
    let snapshot = app.service.lock().ok().and_then(|s| s.latest());
    control.nlp_command(&input, snapshot.as_ref())
}

/* ----- Production: diagnostics, health, permissions, setup, autostart, update ----- */

fn telemetry_ok(app: &State<'_, AppState>) -> bool {
    app.service.lock().ok().and_then(|s| s.latest()).is_some()
}

#[tauri::command]
pub fn run_health_check(
    app: State<'_, AppState>,
    control: State<'_, ControlService>,
) -> HealthCheck {
    diagnostics::health_check(&control, telemetry_ok(&app))
}

#[tauri::command]
pub fn check_permissions(control: State<'_, ControlService>) -> Permissions {
    diagnostics::permissions(&control)
}

#[tauri::command]
pub fn export_diagnostics(
    app: State<'_, AppState>,
    control: State<'_, ControlService>,
) -> String {
    diagnostics::report_markdown(&control, telemetry_ok(&app))
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SetupState {
    pub completed: bool,
}

fn setup_path() -> PathBuf {
    logging::data_dir().join("setup.json")
}

#[tauri::command]
pub fn get_setup_state() -> SetupState {
    std::fs::read_to_string(setup_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_setup_complete() {
    let _ = std::fs::create_dir_all(logging::data_dir());
    if let Ok(json) = serde_json::to_string(&SetupState { completed: true }) {
        let _ = std::fs::write(setup_path(), json);
    }
    logging::line("INFO", "First-run setup completed");
}

#[tauri::command]
pub fn get_autostart(app: AppHandle) -> bool {
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[tauri::command]
pub fn set_autostart(app: AppHandle, enabled: bool) -> Result<(), String> {
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| e.to_string())
    } else {
        mgr.disable().map_err(|e| e.to_string())
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current_version: String,
    pub channel: String,
    pub update_available: bool,
    pub latest_version: Option<String>,
    pub notes: String,
}

/// Update architecture: reports the current build + channel. The signed,
/// minisign-verified in-app updater (`tauri-plugin-updater`) performs the actual
/// availability check via the configured release endpoint; this command exposes
/// the local build identity to the UI/diagnostics. No fake "update available"
/// is ever synthesized here.
#[tauri::command]
pub fn app_update_info() -> UpdateInfo {
    UpdateInfo {
        current_version: env!("CARGO_PKG_VERSION").to_string(),
        channel: "beta".into(),
        update_available: false,
        latest_version: None,
        notes: "Signed in-app updates are enabled (minisign-verified). The updater checks the release endpoint on launch; packages are also published as deb/rpm/AppImage.".into(),
    }
}

/// Live result of querying the signed updater feed.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub available: bool,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub notes: Option<String>,
}

/// Query the signed updater endpoint for a newer, minisign-verified release.
/// Read-only: never downloads or installs — that is an explicit user action via
/// `install_update`.
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateStatus, String> {
    use tauri_plugin_updater::UpdaterExt;
    let current = env!("CARGO_PKG_VERSION").to_string();
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateStatus {
            available: true,
            current_version: current,
            latest_version: Some(update.version.clone()),
            notes: update.body.clone(),
        }),
        Ok(None) => Ok(UpdateStatus { available: false, current_version: current, latest_version: None, notes: None }),
        Err(e) => Err(e.to_string()),
    }
}

/// Download + install the latest signed update (verified against the pinned
/// minisign public key by the plugin), then signal the caller to restart.
#[tauri::command]
pub async fn install_update(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await.map_err(|e| e.to_string())? {
        Some(update) => {
            update
                .download_and_install(|_chunk, _total| {}, || {})
                .await
                .map_err(|e| e.to_string())?;
            Ok(true)
        }
        None => Ok(false),
    }
}
