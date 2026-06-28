//! On-demand desktop overlay for battery events.
//!
//! When the backend engine fires an event it spawns a transparent, click-through,
//! always-on-top window in the bottom-right corner that plays the configured
//! animation (and sound) then destroys itself. There is **no overlay between
//! events** — zero idle footprint. Window creation is marshalled onto the main
//! thread because the engine runs on the telemetry thread.

use tauri::{AppHandle, LogicalPosition, WebviewUrl, WebviewWindowBuilder};

const W: f64 = 280.0;
const H: f64 = 150.0;
const MARGIN: f64 = 16.0;
const BOTTOM_GAP: f64 = 56.0; // clear a typical taskbar / panel

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

/// Spawn an overlay for `event_id` showing `pct`%. Safe to call from any thread.
pub fn show(app: &AppHandle, event_id: &str, pct: f32) {
    let handle = app.clone();
    let id = event_id.to_string();
    let _ = app.run_on_main_thread(move || build(&handle, &id, pct));
}

fn build(app: &AppHandle, event_id: &str, pct: f32) {
    let label = format!("battery-overlay-{}", now_ms());
    // Runs before the page's own scripts, so the overlay reads it on first paint.
    let init = format!(
        "window.__NEXUS_OVERLAY = {{ event: {event_id:?}, pct: {pct} }};",
    );

    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("overlay.html".into()))
        .title("Nexus Battery Overlay")
        .inner_size(W, H)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .shadow(false)
        .initialization_script(&init)
        .build();

    match built {
        Ok(win) => {
            // Click-through: never intercept the cursor (games, other apps stay usable).
            let _ = win.set_ignore_cursor_events(true);
            position_bottom_right(app, &win);
        }
        Err(e) => eprintln!("[overlay] failed to create window: {e}"),
    }
}

fn position_bottom_right(app: &AppHandle, win: &tauri::WebviewWindow) {
    let monitor = win
        .current_monitor()
        .ok()
        .flatten()
        .or_else(|| app.primary_monitor().ok().flatten());
    if let Some(m) = monitor {
        let scale = m.scale_factor();
        let size = m.size().to_logical::<f64>(scale);
        let x = (size.width - W - MARGIN).max(0.0);
        let y = (size.height - H - BOTTOM_GAP).max(0.0);
        let _ = win.set_position(LogicalPosition::new(x, y));
    }
}
