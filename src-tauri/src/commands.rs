//! Tauri IPC surface. Thin wrappers over the telemetry service; all heavy work
//! lives in the engine. Commands never block on long operations beyond a single
//! cheap collect.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tauri_plugin_autostart::ManagerExt;

use crate::diagnostics::{self, HealthCheck, Permissions};
use crate::logging;

use crate::control::automation::AutomationConfig;
use crate::control::battery::{BatteryReport, BatterySample, ChargeLimitEvidence};
use crate::control::fan::{CurvePoint, FanInfo, FanProfile, ThermalReport};
use crate::control::games::library::{self, ManualGame};
use crate::control::games::profiles::GameLaunch;
use crate::control::games::{Game, GameProfile, LauncherStatus, MangoHudStatus};
use crate::control::gpu::{GpuCapabilities, GpuInfo, GpuIntelligence};
use crate::control::integrations::Integration;
use crate::control::intelligence::{CommandResult, IntelligenceReport};
use crate::control::nexus::NexusProfile;
use crate::control::plugins::Plugin;
use crate::control::power::PowerInfo;
use crate::control::registry::DriverInfo;
use crate::control::rgb::{RgbProfile, RgbSource};
use crate::control::traits::{ControlError, ControlOutcome, RgbRequest, RgbState};
use crate::control::{ControlAction, ControlService, HardwareCapabilities};
use crate::linux_hub::{self, DockerOverview, FlatpakOverview, ServiceUnit, UpdateCounts};
use crate::optimizer::{self, OptimizerReport};
use crate::storage::{self, AppUsage, DupGroup, FileInfo, ScanRoot, TreeLevel};
use crate::sysdoctor::{self, StorageAnalysis, SystemScan};
use crate::telemetry::processes::{self, ProcInfo, ProcessMonitor};
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
    state
        .interval_ms
        .store(ms.clamp(250, 10_000), Ordering::Relaxed);
}

/// Dev/QA helper: fire a battery event by id without a real power-supply edge —
/// drives the exact backend path (bell record + native notification +
/// `battery://event`) so the end-to-end flow can be verified by hand. The UI
/// exposes this only behind a dev-mode affordance.
#[tauri::command]
pub fn simulate_battery_event(app: AppHandle, event: String) -> Result<(), String> {
    let ev = crate::battery_events::event_from_id(&event).ok_or_else(|| format!("unknown event '{event}'"))?;
    use crate::battery_events::Event;
    // Event-appropriate demo values so the notification text reads sensibly.
    let (pct, power, status) = match ev {
        Event::Critical => (8.0, 0.0, "Discharging"),
        Event::Low => (18.0, 0.0, "Discharging"),
        Event::Full => (100.0, 0.0, "Full"),
        Event::Disconnect => (72.0, 0.0, "Discharging"),
        Event::FastCharge => (61.0, 60.0, "Charging"),
        Event::SlowCharge => (54.0, 12.0, "Charging"),
        Event::Connect => (72.0, 45.0, "Charging"),
    };
    crate::battery_events::fire_event(&app, ev, pct, power, status);
    Ok(())
}

/// On-demand network latency probe (kept out of the hot loop).
#[tauri::command]
pub fn get_latency(host: Option<String>) -> Option<f32> {
    collectors::ping_latency(host.as_deref().unwrap_or("1.1.1.1"))
}

/// Top processes by CPU/memory with disk I/O, owner & executable path. Async so
/// the periodic /proc walk (polled every ~2s) never hitches the UI thread.
#[tauri::command]
pub async fn list_processes(
    monitor: State<'_, Mutex<ProcessMonitor>>,
    limit: Option<usize>,
) -> Result<Vec<ProcInfo>, String> {
    Ok(monitor
        .lock()
        .map(|mut m| m.sample(limit.unwrap_or(40)))
        .unwrap_or_default())
}

/// Signal a process: terminate | force-kill | stop | continue. The kernel
/// enforces permission (you can only signal your own processes unprivileged).
#[tauri::command]
pub fn process_action(pid: u32, action: String) -> Result<String, String> {
    processes::process_action(pid, &action)
}

/// Resolve a process's on-disk executable location.
#[tauri::command]
pub fn get_process_exe(pid: u32) -> Option<String> {
    processes::process_exe(pid)
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
pub fn get_compatibility(
    control: State<'_, ControlService>,
) -> crate::control::CompatibilityReport {
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
    // Invoked over IPC == explicit user action (clicked a profile in Settings).
    control.apply_nexus_profile(&id, RgbSource::User)
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
pub fn game_launch_info(control: State<'_, ControlService>, game_id: String) -> Option<GameLaunch> {
    control.game_launch_info(&game_id)
}

#[tauri::command]
pub fn apply_game_profile(
    control: State<'_, ControlService>,
    game_id: String,
) -> Result<ControlOutcome, ControlError> {
    // Invoked over IPC == explicit user action (clicked Play / Apply on a game).
    control.apply_game_profile(&game_id, RgbSource::User)
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

/* ----- Manual game library (user-added games) ----- */

#[tauri::command]
pub fn list_manual_games() -> Vec<ManualGame> {
    library::list()
}

#[tauri::command]
pub fn add_manual_game(game: ManualGame) -> Result<ManualGame, String> {
    library::add(game)
}

#[tauri::command]
pub fn update_manual_game(game: ManualGame) -> Result<(), String> {
    library::update(game)
}

#[tauri::command]
pub fn delete_manual_game(id: String) -> Result<(), String> {
    library::delete(&id)
}

/// Launch a manual game (detached). Async so spawning never blocks the UI.
#[tauri::command]
pub async fn launch_manual_game(id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || library::launch(&id))
        .await
        .map_err(|e| e.to_string())?
}

/* ----- System integrations (Phase 4.5) ----- */

/// Detection runs flatpak/systemctl/port probes — async so it never stalls the UI.
#[tauri::command]
pub async fn get_integrations() -> Result<Vec<Integration>, String> {
    tauri::async_runtime::spawn_blocking(crate::control::integrations::detect_all)
        .await
        .map_err(|e| e.to_string())
}

/// Progress event for a one-click install, emitted on `integration-progress`.
/// Phases are REAL backend steps: preparing → installing → verifying → installed
/// | failed. Sizes come from flatpak's own `remote-info`; `percent`/`eta_secs`
/// are populated only while flatpak streams a real percentage (`None` otherwise
/// — the UI falls back to an indeterminate bar, never a fabricated number).
#[derive(Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallProgress {
    flatpak_id: String,
    phase: String,
    version: Option<String>,
    /// Total bytes to download (from `remote-info`), when known.
    download_bytes: Option<u64>,
    /// Bytes downloaded so far (estimated from percent × total), when known.
    transferred_bytes: Option<u64>,
    /// Overall completion 0–100, when flatpak reports it.
    percent: Option<u32>,
    /// Estimated seconds remaining, when computable.
    eta_secs: Option<u64>,
}

/// One-click flatpak install for an integration (user-level, no sudo). Async:
/// `flatpak install` blocks for a while; keep it off the UI thread. Emits
/// `integration-progress` events so the UI can show a live state machine with
/// real download size, transferred/total, percent and ETA when available.
#[tauri::command]
pub async fn install_integration(
    app: tauri::AppHandle,
    flatpak_id: String,
) -> Result<String, String> {
    use crate::control::integrations as ig;
    use tauri::Emitter;
    tauri::async_runtime::spawn_blocking(move || {
        let emit = |progress: InstallProgress| {
            let _ = app.emit("integration-progress", progress);
        };
        let base = |phase: &str| InstallProgress {
            flatpak_id: flatpak_id.clone(),
            phase: phase.into(),
            ..Default::default()
        };

        emit(base("preparing"));
        ig::ensure_ready(&flatpak_id)?;

        // Real download size up front (flatpak's own accounting).
        let size = ig::remote_size(&flatpak_id);
        let total = size.download_bytes;
        emit(InstallProgress {
            download_bytes: total,
            ..base("installing")
        });

        let started = std::time::Instant::now();
        ig::run_install(&flatpak_id, |pct| {
            let transferred = total.map(|t| ((t as f64) * (pct as f64) / 100.0) as u64);
            let elapsed = started.elapsed().as_secs();
            let eta = if pct > 0 && pct < 100 {
                Some(elapsed.saturating_mul((100 - pct) as u64) / pct as u64)
            } else {
                None
            };
            let _ = app.emit(
                "integration-progress",
                InstallProgress {
                    flatpak_id: flatpak_id.clone(),
                    phase: "installing".into(),
                    download_bytes: total,
                    transferred_bytes: transferred,
                    percent: Some(pct),
                    eta_secs: eta,
                    version: None,
                },
            );
        })?;

        emit(base("verifying"));
        let version = ig::installed_flatpak_version(&flatpak_id);
        emit(InstallProgress {
            version: version.clone(),
            ..base("installed")
        });
        Ok(match version {
            Some(v) => format!("Installed · v{v}"),
            None => "Installed via Flathub.".into(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Uninstall a flatpak-managed integration (user-level).
#[tauri::command]
pub async fn uninstall_integration(flatpak_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::control::integrations::uninstall_integration(&flatpak_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Launch a flatpak-managed integration.
#[tauri::command]
pub fn open_integration(flatpak_id: String) -> Result<String, String> {
    crate::control::integrations::open_integration(&flatpak_id)
}

/// Flatpak readiness (is flatpak installed, is the Flathub remote configured) so
/// the UI can prompt before an install can fail.
#[tauri::command]
pub async fn flatpak_health() -> Result<crate::control::integrations::FlatpakHealth, String> {
    tauri::async_runtime::spawn_blocking(crate::control::integrations::flatpak_health)
        .await
        .map_err(|e| e.to_string())
}

/// One-click "Add Flathub" (user-scoped, idempotent).
#[tauri::command]
pub async fn add_flathub() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(crate::control::integrations::add_flathub)
        .await
        .map_err(|e| e.to_string())?
}

/* ----- Persistent telemetry store (history / sessions / aggregates) ----- */

/// Recent telemetry sessions (newest first) with rolled-up summary stats.
/// Gaming Intelligence consumes these instead of the volatile in-memory ring.
#[tauri::command]
pub async fn telemetry_sessions(
    store: State<'_, Arc<crate::telemetry::TelemetryStore>>,
    limit: Option<i64>,
) -> Result<Vec<crate::telemetry::store::SessionRow>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.sessions(limit.unwrap_or(50)))
        .await
        .map_err(|e| e.to_string())?
}

/// Summary stats for one session.
#[tauri::command]
pub async fn telemetry_session_summary(
    store: State<'_, Arc<crate::telemetry::TelemetryStore>>,
    id: i64,
) -> Result<Option<crate::telemetry::store::SessionRow>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.session_summary(id))
        .await
        .map_err(|e| e.to_string())?
}

/// Persisted time-series history for `[since, until]` (ms epoch). Resolution is
/// auto-selected: raw samples for recent windows, hourly aggregates for longer.
#[tauri::command]
pub async fn telemetry_history(
    store: State<'_, Arc<crate::telemetry::TelemetryStore>>,
    since: i64,
    until: i64,
    max_points: Option<i64>,
) -> Result<Vec<crate::telemetry::store::HistoryRow>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.history(since, until, max_points.unwrap_or(600)))
        .await
        .map_err(|e| e.to_string())?
}

/// Store-wide totals (sessions, samples, tracked time, peak temps, db size).
#[tauri::command]
pub async fn telemetry_stats(
    store: State<'_, Arc<crate::telemetry::TelemetryStore>>,
) -> Result<crate::telemetry::store::StoreStats, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.stats())
        .await
        .map_err(|e| e.to_string())?
}

/* ----- Gaming Intelligence v1 (analysis over the persistent store) ----- */

/// Full per-session analytics (avgs/peaks/mins, power, FPS stats, throttle %).
#[tauri::command]
pub async fn gaming_session_analytics(
    store: State<'_, Arc<crate::telemetry::TelemetryStore>>,
    id: i64,
) -> Result<Option<crate::telemetry::store::SessionAnalytics>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.session_analytics(id))
        .await
        .map_err(|e| e.to_string())?
}

/// Per-sample timeline for one session (FPS / thermal history charts).
#[tauri::command]
pub async fn gaming_session_series(
    store: State<'_, Arc<crate::telemetry::TelemetryStore>>,
    id: i64,
    max_points: Option<i64>,
) -> Result<Vec<crate::telemetry::store::HistoryRow>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.session_series(id, max_points.unwrap_or(600)))
        .await
        .map_err(|e| e.to_string())?
}

/// "Why FPS dropped" — limiter/bottleneck analysis for a session.
#[tauri::command]
pub async fn gaming_fps_analysis(
    store: State<'_, Arc<crate::telemetry::TelemetryStore>>,
    id: i64,
) -> Result<Option<crate::gaming::FpsAnalysis>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || crate::gaming::fps_analysis(&store, id))
        .await
        .map_err(|e| e.to_string())?
}

/// Cross-session performance trends (regressions / improvements vs the recent
/// baseline).
#[tauri::command]
pub async fn gaming_trends(
    store: State<'_, Arc<crate::telemetry::TelemetryStore>>,
    limit: Option<i64>,
) -> Result<crate::gaming::TrendReport, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || crate::gaming::trends(&store, limit.unwrap_or(10)))
        .await
        .map_err(|e| e.to_string())?
}

/* ----- Notification Center (persistent event hub) ----- */

/// Add a notification, persist it, and emit `notification://new` so the bell +
/// drawer update live. Both frontend `notify()` calls and backend events
/// (profile auto-switch, etc.) funnel through here.
#[tauri::command]
pub async fn notif_add(
    app: tauri::AppHandle,
    store: State<'_, Arc<crate::notifications::NotificationStore>>,
    kind: String,
    severity: String,
    title: String,
    body: String,
) -> Result<crate::notifications::Notification, String> {
    let store = store.inner().clone();
    let n = tauri::async_runtime::spawn_blocking(move || {
        store.add(&kind, &severity, &title, &body)
    })
    .await
    .map_err(|e| e.to_string())??;
    use tauri::Emitter;
    let _ = app.emit("notification://new", &n);
    Ok(n)
}

#[tauri::command]
pub async fn notif_list(
    store: State<'_, Arc<crate::notifications::NotificationStore>>,
    limit: Option<i64>,
) -> Result<Vec<crate::notifications::Notification>, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.list(limit.unwrap_or(100)))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn notif_unread(
    store: State<'_, Arc<crate::notifications::NotificationStore>>,
) -> Result<i64, String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.unread_count())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn notif_mark_read(
    store: State<'_, Arc<crate::notifications::NotificationStore>>,
    id: i64,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.mark_read(id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn notif_mark_all_read(
    store: State<'_, Arc<crate::notifications::NotificationStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.mark_all_read())
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn notif_clear(
    store: State<'_, Arc<crate::notifications::NotificationStore>>,
) -> Result<(), String> {
    let store = store.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.clear())
        .await
        .map_err(|e| e.to_string())?
}

/* ----- Battery charge-limit evidence (Task 4 — hardware truth) ----- */

#[tauri::command]
pub fn get_charge_limit_evidence(control: State<'_, ControlService>) -> ChargeLimitEvidence {
    control.battery_charge_limit_evidence()
}

#[tauri::command]
pub fn set_charge_limit(
    control: State<'_, ControlService>,
    percent: u8,
) -> Result<String, ControlError> {
    control.battery_set_charge_limit(percent)
}

/* ----- System Doctor: deep scan + storage analyzer ----- */
/* These shell out to df/du/find/systemctl/journalctl and can take seconds, so
 * they run as ASYNC commands — Tauri executes async commands on a worker task,
 * never the main/UI thread. The webview stays fully responsive during a scan. */

#[tauri::command]
pub async fn run_system_scan(control: State<'_, ControlService>) -> Result<SystemScan, String> {
    Ok(sysdoctor::full_scan(&control))
}

#[tauri::command]
pub async fn get_storage_analysis() -> Result<StorageAnalysis, String> {
    tauri::async_runtime::spawn_blocking(sysdoctor::storage_analysis)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_file(path: String) -> Result<String, String> {
    sysdoctor::delete_path(&path)
}

#[tauri::command]
pub fn move_file(src: String, dest: String) -> Result<String, String> {
    sysdoctor::move_path(&src, &dest)
}

#[tauri::command]
pub fn reveal_file(path: String) -> Result<String, String> {
    sysdoctor::reveal_path(&path)
}

/* ----- Storage Analyzer Pro (all async/off-thread; scans use du/find) ----- */

#[tauri::command]
pub async fn storage_roots() -> Result<Vec<ScanRoot>, String> {
    blocking(storage::scan_roots).await
}

#[tauri::command]
pub async fn storage_tree(path: String) -> Result<TreeLevel, String> {
    blocking(move || storage::tree_level(&path)).await
}

#[tauri::command]
pub async fn storage_largest_files(root: String, limit: usize) -> Result<Vec<FileInfo>, String> {
    blocking(move || storage::largest_files(&root, limit)).await
}

#[tauri::command]
pub async fn storage_duplicates(root: String, category: String) -> Result<Vec<DupGroup>, String> {
    blocking(move || storage::find_duplicates(&root, &category)).await
}

#[tauri::command]
pub async fn storage_space_by_app() -> Result<Vec<AppUsage>, String> {
    blocking(storage::space_by_app).await
}

#[tauri::command]
pub async fn trash_file(path: String) -> Result<String, String> {
    blocking(move || storage::trash_file(&path)).await?
}

/// Doctor service action: status | logs | restart. Async (restart prompts
/// pkexec; status/logs shell out) so it never blocks the UI.
#[tauri::command]
pub async fn service_action(unit: String, action: String, user: bool) -> Result<String, String> {
    blocking(move || sysdoctor::service_action(&unit, &action, user)).await?
}

/* ----- Linux Hub (services / docker / flatpak / updates) — all async ----- */

#[tauri::command]
pub async fn hub_list_services(user: bool) -> Result<Vec<ServiceUnit>, String> {
    blocking(move || linux_hub::list_services(user)).await
}

#[tauri::command]
pub async fn hub_service_control(
    name: String,
    action: String,
    user: bool,
) -> Result<String, String> {
    blocking(move || linux_hub::service_control(&name, &action, user)).await?
}

#[tauri::command]
pub async fn hub_docker_overview() -> Result<DockerOverview, String> {
    blocking(linux_hub::docker_overview).await
}

#[tauri::command]
pub async fn hub_docker_action(kind: String, id: String, action: String) -> Result<String, String> {
    blocking(move || linux_hub::docker_action(&kind, &id, &action)).await?
}

#[tauri::command]
pub async fn hub_flatpak_overview() -> Result<FlatpakOverview, String> {
    blocking(linux_hub::flatpak_overview).await
}

#[tauri::command]
pub async fn hub_flatpak_action(id: String, action: String) -> Result<String, String> {
    blocking(move || linux_hub::flatpak_action(&id, &action)).await?
}

#[tauri::command]
pub async fn hub_update_counts() -> Result<UpdateCounts, String> {
    blocking(linux_hub::update_counts).await
}

#[tauri::command]
pub async fn hub_update_run(target: String) -> Result<String, String> {
    blocking(move || linux_hub::update_run(&target)).await?
}

/* ----- Plugins ----- */

#[tauri::command]
pub fn list_plugins() -> Vec<Plugin> {
    crate::control::plugins::list()
}

#[tauri::command]
pub fn set_plugin_enabled(id: String, enabled: bool) -> bool {
    crate::control::plugins::set_enabled(&id, enabled)
}

#[tauri::command]
pub fn get_plugins_dir() -> String {
    crate::control::plugins::directory()
}

/* ----- Linux Optimizer ----- */
/* All async + spawn_blocking: the scan does `du`, and the actions run `pkexec`
 * which BLOCKS until the user answers the polkit prompt — never on the UI thread. */

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn optimizer_scan() -> Result<OptimizerReport, String> {
    blocking(optimizer::scan).await
}

#[tauri::command]
pub async fn optimizer_drop_caches(level: u8) -> Result<String, String> {
    blocking(move || optimizer::drop_caches(level)).await?
}

#[tauri::command]
pub async fn optimizer_remove_orphans() -> Result<String, String> {
    blocking(optimizer::remove_orphans).await?
}

#[tauri::command]
pub async fn optimizer_vacuum_journal(days: u32) -> Result<String, String> {
    blocking(move || optimizer::vacuum_journal(days)).await?
}

#[tauri::command]
pub async fn optimizer_clean_temp(id: String) -> Result<String, String> {
    blocking(move || optimizer::clean_temp(&id)).await?
}

#[tauri::command]
pub async fn optimizer_set_startup(
    id: String,
    kind: String,
    enabled: bool,
) -> Result<String, String> {
    blocking(move || optimizer::set_startup(&id, &kind, enabled)).await?
}

/* ----- Intelligence Core (Phase 5.0) ----- */

/// Async: the report calls nvidia-smi + sysfs reads (battery/thermal/gpu), which
/// must not run on the UI thread.
#[tauri::command]
pub async fn get_intelligence(
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
pub fn export_diagnostics(app: State<'_, AppState>, control: State<'_, ControlService>) -> String {
    diagnostics::report_markdown(&control, telemetry_ok(&app))
}

/// Recent Nexus log lines (for Settings → Diagnostics → Export Logs).
#[tauri::command]
pub fn read_logs() -> String {
    logging::tail(5000)
}

/// System uptime in seconds (from /proc/uptime). 0 if unavailable.
#[tauri::command]
pub fn system_uptime() -> u64 {
    std::fs::read_to_string("/proc/uptime")
        .ok()
        .and_then(|s| s.split_whitespace().next().and_then(|x| x.parse::<f64>().ok()))
        .map(|f| f as u64)
        .unwrap_or(0)
}

/// Fully quit Nexus (the window close button only hides to tray; this is the
/// explicit "Quit" action). Flushes logs first, mirroring the tray quit.
#[tauri::command]
pub fn quit_app(app: AppHandle) {
    app.state::<Arc<crate::telemetry::TelemetryStore>>()
        .end_current_session();
    logging::shutdown();
    app.exit(0);
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
        // The autostart entry records the *current* executable. A dev build
        // (`tauri dev` / `cargo run`) loads the frontend from the Vite devUrl
        // (http://localhost:1420), so registering it makes login launches fail
        // with "Connection refused" once the dev server is gone. Only ever
        // register the installed production binary.
        if tauri::is_dev() {
            return Err(
                "Autostart can only be enabled from an installed build, not a dev build.".into(),
            );
        }
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
        Ok(None) => Ok(UpdateStatus {
            available: false,
            current_version: current,
            latest_version: None,
            notes: None,
        }),
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
