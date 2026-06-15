//! Nexus Control Center — Tauri backend entry point.
//!
//! Boots logging + the telemetry engine, streams snapshots over the
//! `telemetry://snapshot` event, runs the automation watcher, exposes the IPC
//! command surface, and provides production desktop integration: system tray,
//! single-instance, autostart, close-to-tray, and crash detection.

mod commands;
mod control;
mod diagnostics;
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
use telemetry::{ProcessMonitor, TelemetryService};

/// Event channel the frontend subscribes to for live telemetry frames.
pub const TELEMETRY_EVENT: &str = "telemetry://snapshot";

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
            commands::get_setup_state,
            commands::set_setup_complete,
            commands::get_autostart,
            commands::set_autostart,
            commands::app_update_info,
            commands::check_for_update,
            commands::install_update,
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
            std::thread::spawn(move || loop {
                let snapshot = svc.lock().ok().map(|mut s| s.collect());
                if let Some(snapshot) = snapshot {
                    let _ = handle.emit(TELEMETRY_EVENT, &snapshot);
                }
                let ms = iv.load(Ordering::Relaxed).max(250);
                std::thread::sleep(Duration::from_millis(ms));
            });

            // ----- Automation watcher (opt-in) -----
            let auto_handle = app.handle().clone();
            std::thread::spawn(move || {
                let mut last_applied: Option<String> = None;
                loop {
                    std::thread::sleep(Duration::from_secs(6));
                    let svc = auto_handle.state::<ControlService>();
                    let cfg = svc.get_automation();
                    if !cfg.enabled {
                        last_applied = None;
                        continue;
                    }
                    let ctx = control::automation::gather_context();
                    if let Some(id) = control::automation::evaluate(&cfg, &ctx) {
                        if last_applied.as_deref() != Some(id.as_str()) {
                            let _ = svc.apply_nexus_profile(&id);
                            last_applied = Some(id);
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

    app.run(|_app, event| {
        if let RunEvent::ExitRequested { .. } = event {
            logging::shutdown();
        }
    });
}
