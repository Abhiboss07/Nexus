//! Nexus Control Center — Tauri backend entry point.
//!
//! Boots logging + the telemetry engine, streams snapshots over the
//! `telemetry://snapshot` event, runs the automation watcher, exposes the IPC
//! command surface, and provides production desktop integration: system tray,
//! single-instance, autostart, close-to-tray, and crash detection.

mod commands;
mod control;
mod diagnostics;
mod linux_hub;
mod logging;
mod optimizer;
#[cfg(test)]
mod runtime_smoke;
mod storage;
mod sysdoctor;
mod telemetry;

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, RunEvent, WindowEvent};

use commands::AppState;
use control::ControlService;
use telemetry::{ProcessMonitor, TelemetryService, TelemetryStore};

/// Event channel the frontend subscribes to for live telemetry frames.
pub const TELEMETRY_EVENT: &str = "telemetry://snapshot";

/// Best-effort machine hostname for session attribution.
fn hostname() -> String {
    std::env::var("HOSTNAME")
        .ok()
        .filter(|h| !h.is_empty())
        .or_else(|| std::fs::read_to_string("/etc/hostname").ok().map(|s| s.trim().to_string()))
        .filter(|h| !h.is_empty())
        .unwrap_or_else(|| "unknown".into())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let recovered = logging::init();
    // Catch SIGINT/SIGTERM/SIGHUP for a clean shutdown (so Ctrl+C in
    // `cargo tauri dev`, logout, and `systemctl` stop don't leave a stale crash
    // marker), and SIGSEGV/SIGABRT/… to record a genuine crash.
    logging::install_signal_handlers();

    let service = Arc::new(Mutex::new(TelemetryService::new()));
    let interval_ms = Arc::new(AtomicU64::new(1500));
    let state = AppState {
        service: service.clone(),
        interval_ms: interval_ms.clone(),
    };

    // Detect control capabilities once at startup.
    let control = ControlService::detect(telemetry::hardware::detect());
    logging::line(
        "INFO",
        &format!("Hardware: {}", control.profile().vendor_label),
    );

    // ----- Persistent telemetry store -----
    // Durable history behind the in-memory ring. Degrades to an in-memory DB if
    // the file can't be opened, so persistence failure never blocks startup.
    let db_path = logging::data_dir().join("telemetry.db");
    let store = Arc::new(match TelemetryStore::open(&db_path) {
        Ok(s) => s,
        Err(e) => {
            logging::line("WARN", &format!("Telemetry store on-disk unavailable ({e}); using in-memory."));
            TelemetryStore::in_memory().expect("in-memory telemetry store")
        }
    });
    // Stamp any session left open by a prior crash, then open this run's session.
    let _ = store.close_stale_sessions();
    match store.begin_session(env!("CARGO_PKG_VERSION"), &hostname()) {
        Ok(id) => logging::line("INFO", &format!("Telemetry session #{id} started")),
        Err(e) => logging::line("WARN", &format!("Couldn't start telemetry session: {e}")),
    }

    let app = tauri::Builder::default()
        // Focus the existing window if a second instance is launched.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .manage(state)
        .manage(control)
        .manage(store.clone())
        .manage(Mutex::new(ProcessMonitor::new()))
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_snapshot,
            commands::get_history,
            commands::get_hardware_profile,
            commands::set_poll_interval,
            commands::get_latency,
            commands::list_processes,
            commands::process_action,
            commands::get_process_exe,
            commands::get_capabilities,
            commands::get_active_drivers,
            commands::get_compatibility,
            commands::preview_control_action,
            commands::rgb_apply,
            commands::rgb_off,
            commands::rgb_state,
            commands::rgb_presets,
            commands::rgb_list_profiles,
            commands::rgb_save_profile,
            commands::rgb_apply_profile,
            commands::rgb_delete_profile,
            commands::rgb_export_profile,
            commands::rgb_import_profile,
            commands::get_power_info,
            commands::get_current_profile,
            commands::get_available_profiles,
            commands::set_profile,
            commands::list_nexus_profiles,
            commands::get_active_profile,
            commands::apply_nexus_profile,
            commands::save_nexus_profile,
            commands::delete_nexus_profile,
            commands::get_automation,
            commands::set_automation,
            commands::get_battery_report,
            commands::get_battery_history,
            commands::export_battery_report,
            commands::get_fan_info,
            commands::get_thermal_report,
            commands::fan_set_thermal_profile,
            commands::fan_set_curve,
            commands::fan_set_max_fan,
            commands::fan_disable_curve,
            commands::fan_list_profiles,
            commands::fan_apply_profile,
            commands::fan_save_profile,
            commands::fan_delete_profile,
            commands::fan_export_profile,
            commands::fan_import_profile,
            commands::get_gpu_info,
            commands::get_gpu_capabilities,
            commands::get_gpu_intelligence,
            commands::scan_games,
            commands::get_game_launchers,
            commands::get_game_profile,
            commands::save_game_profile,
            commands::delete_game_profile,
            commands::game_launch_info,
            commands::apply_game_profile,
            commands::get_mangohud_status,
            commands::mangohud_apply,
            commands::list_manual_games,
            commands::add_manual_game,
            commands::update_manual_game,
            commands::delete_manual_game,
            commands::launch_manual_game,
            commands::get_integrations,
            commands::install_integration,
            commands::uninstall_integration,
            commands::open_integration,
            commands::flatpak_health,
            commands::add_flathub,
            commands::get_charge_limit_evidence,
            commands::set_charge_limit,
            commands::run_system_scan,
            commands::get_storage_analysis,
            commands::delete_file,
            commands::move_file,
            commands::reveal_file,
            commands::storage_roots,
            commands::storage_tree,
            commands::storage_largest_files,
            commands::storage_duplicates,
            commands::storage_space_by_app,
            commands::trash_file,
            commands::service_action,
            commands::hub_list_services,
            commands::hub_service_control,
            commands::hub_docker_overview,
            commands::hub_docker_action,
            commands::hub_flatpak_overview,
            commands::hub_flatpak_action,
            commands::hub_update_counts,
            commands::hub_update_run,
            commands::list_plugins,
            commands::set_plugin_enabled,
            commands::get_plugins_dir,
            commands::optimizer_scan,
            commands::optimizer_drop_caches,
            commands::optimizer_remove_orphans,
            commands::optimizer_vacuum_journal,
            commands::optimizer_clean_temp,
            commands::optimizer_set_startup,
            commands::get_intelligence,
            commands::nlp_command,
            commands::run_health_check,
            commands::check_permissions,
            commands::export_diagnostics,
            commands::read_logs,
            commands::system_uptime,
            commands::quit_app,
            commands::get_setup_state,
            commands::set_setup_complete,
            commands::get_autostart,
            commands::set_autostart,
            commands::app_update_info,
            commands::check_for_update,
            commands::install_update,
            commands::telemetry_sessions,
            commands::telemetry_session_summary,
            commands::telemetry_history,
            commands::telemetry_stats,
        ])
        .setup(move |app| {
            // ----- System tray -----
            let show = MenuItem::with_id(app, "show", "Show Nexus", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Nexus", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("Nexus Control Center")
                .menu(&menu);
            // Use the bundled window icon if present; never panic if it's absent.
            if let Some(icon) = app.default_window_icon().cloned() {
                tray = tray.icon(icon);
            }
            let _tray = tray
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "hide" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.hide();
                        }
                    }
                    "quit" => {
                        app.state::<Arc<TelemetryStore>>().end_current_session();
                        logging::shutdown();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // ----- Telemetry streaming thread -----
            let handle = app.handle().clone();
            let svc = service.clone();
            let iv = interval_ms.clone();
            let stream_store = store.clone();
            std::thread::spawn(move || {
                // Persist at a coarser cadence than the UI stream — Gaming
                // Intelligence doesn't need sub-2s resolution and we keep the DB
                // small. The live ring still streams at the full interval.
                const STORE_EVERY_MS: u128 = 5_000;
                let mut last_store = std::time::Instant::now()
                    .checked_sub(Duration::from_secs(60))
                    .unwrap_or_else(std::time::Instant::now);
                loop {
                    let snapshot = svc.lock().ok().map(|mut s| s.collect());
                    if let Some(snapshot) = snapshot {
                        let _ = handle.emit(TELEMETRY_EVENT, &snapshot);
                        if last_store.elapsed().as_millis() >= STORE_EVERY_MS {
                            if let Some(sid) = stream_store.current_session() {
                                // `None` FPS for now — a frame-rate source (e.g.
                                // MangoHud) can supply real values later without a
                                // schema change.
                                let _ = stream_store.record(sid, &snapshot, None);
                            }
                            last_store = std::time::Instant::now();
                        }
                    }
                    let ms = iv.load(Ordering::Relaxed).max(250);
                    std::thread::sleep(Duration::from_millis(ms));
                }
            });

            // ----- Telemetry maintenance thread (aggregate + retention) -----
            let maint_store = store.clone();
            std::thread::spawn(move || {
                // Settle, then roll complete hours into aggregates and prune on a
                // 10-minute cadence (cheap; only scans buckets since last run).
                std::thread::sleep(Duration::from_secs(30));
                loop {
                    let _ = maint_store.aggregate();
                    let _ = maint_store.prune();
                    std::thread::sleep(Duration::from_secs(600));
                }
            });

            // ----- Automation watcher (opt-in) -----
            let auto_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last_applied: Option<String> = None;
                // `primed` guards against writing on launch: RGB (and the rest of
                // a profile) must NEVER change just because Nexus started into an
                // already-matching condition. The first evaluation only records
                // the baseline; thereafter we apply solely on a genuine condition
                // *transition*. Re-armed whenever automation is toggled off→on.
                let mut primed = false;
                loop {
                    std::thread::sleep(Duration::from_secs(6));
                    let svc = auto_handle.state::<ControlService>();
                    let cfg = svc.get_automation();
                    if !cfg.enabled {
                        last_applied = None;
                        primed = false;
                        continue;
                    }
                    let ctx = control::automation::gather_context();
                    let matched = control::automation::evaluate(&cfg, &ctx);
                    if !primed {
                        last_applied = matched;
                        primed = true;
                        logging::line(
                            "INFO",
                            "Automation watcher primed — baseline recorded, 0 writes on startup",
                        );
                        continue;
                    }
                    if let Some(id) = matched {
                        if last_applied.as_deref() != Some(id.as_str()) {
                            let _ = svc
                                .apply_nexus_profile(&id, control::rgb::RgbSource::Automation);
                            last_applied = Some(id);
                        }
                    } else {
                        last_applied = None;
                    }
                }
            });

            // ----- Per-game automation watcher -----
            // Detects when a configured game's process appears and auto-applies
            // its profile (power + RGB + fan + launch optimizer) once, resetting
            // when the game exits so it re-applies on the next launch.
            let game_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut applied: std::collections::HashSet<String> =
                    std::collections::HashSet::new();
                // Same launch-safety contract as the automation watcher: a game
                // that was ALREADY running before Nexus started is not a "detected
                // launch" and must not auto-apply (which would write RGB). The
                // first pass seeds the baseline from currently-running games; only
                // a not-running→running transition we actually observe applies.
                // Re-armed whenever the rule set goes empty→non-empty.
                let mut primed = false;
                loop {
                    std::thread::sleep(Duration::from_secs(5));
                    let svc = game_handle.state::<ControlService>();
                    let rules = svc.game_auto_apply_rules();
                    if rules.is_empty() {
                        applied.clear();
                        primed = false;
                        continue;
                    }
                    let running = telemetry::processes::running_process_names();
                    if !primed {
                        for (game_id, proc) in &rules {
                            if running.contains(proc) {
                                applied.insert(game_id.clone());
                            }
                        }
                        primed = true;
                        logging::line(
                            "INFO",
                            "Game watcher primed — already-running games baselined, 0 writes on startup",
                        );
                        continue;
                    }
                    for (game_id, proc) in rules {
                        let is_running = running.contains(&proc);
                        if is_running && !applied.contains(&game_id) {
                            let _ = svc
                                .apply_game_profile(&game_id, control::rgb::RgbSource::Automation);
                            logging::line(
                                "INFO",
                                &format!(
                                    "Auto-applied game profile for '{game_id}' ({proc} detected)"
                                ),
                            );
                            applied.insert(game_id);
                        } else if !is_running {
                            applied.remove(&game_id);
                        }
                    }
                }
            });

            if recovered {
                logging::line(
                    "INFO",
                    "Recovered after a crash in the previous session (panic/fatal signal).",
                );
            }
            Ok(())
        })
        // Close button hides to tray — the control center keeps running for the
        // automation watcher. Quit explicitly from the tray.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Nexus Control Center");

    app.run(|app_handle, event| match event {
        RunEvent::ExitRequested { .. } | RunEvent::Exit => {
            // Stamp the telemetry session closed on the way out (idempotent;
            // close_stale_sessions covers a hard kill on the next boot).
            app_handle.state::<Arc<TelemetryStore>>().end_current_session();
            logging::shutdown();
        }
        _ => {}
    });
}
