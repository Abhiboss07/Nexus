//! Lightweight file logging, panic capture, and crash detection. No external
//! logging crate — appends timestamped lines to the app data dir and installs a
//! panic hook so crashes leave a trace + a marker the UI can surface.

use std::fs::OpenOptions;
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();

pub fn data_dir() -> PathBuf {
    let base = std::env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())).join(".local/share")
        });
    base.join("com.nexus.controlcenter")
}

fn marker_path() -> PathBuf {
    data_dir().join("running.lock")
}

fn now() -> String {
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    // Compact UTC-ish HH:MM:SS over the day plus epoch for ordering.
    let h = (secs / 3600) % 24;
    let m = (secs / 60) % 60;
    let s = secs % 60;
    format!("{h:02}:{m:02}:{s:02} ({secs})")
}

/// Initialize logging, install the panic hook, and return whether the previous
/// session ended uncleanly (a leftover marker ⇒ crash).
pub fn init() -> bool {
    let dir = data_dir().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let _ = LOG_PATH.set(dir.join("nexus.log"));
    rotate_if_large();

    // Detect an unclean prior shutdown.
    let crashed = marker_path().exists();
    if crashed {
        line("WARN", "Previous session did not shut down cleanly (recovered).");
    }
    let _ = std::fs::write(marker_path(), b"running");

    std::panic::set_hook(Box::new(|info| {
        let loc = info.location().map(|l| format!("{}:{}", l.file(), l.line())).unwrap_or_default();
        line("PANIC", &format!("{info} @ {loc}"));
    }));

    line("INFO", &format!("Nexus {} starting", env!("CARGO_PKG_VERSION")));
    crashed
}

/// Mark a clean shutdown (removes the crash marker).
pub fn shutdown() {
    line("INFO", "Nexus shutting down cleanly");
    let _ = std::fs::remove_file(marker_path());
}

pub fn line(level: &str, msg: &str) {
    if let Some(p) = LOG_PATH.get() {
        if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(p) {
            let _ = writeln!(f, "{} [{level}] {msg}", now());
        }
    }
    // Mirror to stderr in debug builds for `tauri dev`.
    #[cfg(debug_assertions)]
    eprintln!("[{level}] {msg}");
}

fn rotate_if_large() {
    if let Some(p) = LOG_PATH.get() {
        if let Ok(meta) = std::fs::metadata(p) {
            if meta.len() > 1_000_000 {
                let _ = std::fs::rename(p, p.with_extension("log.1"));
            }
        }
    }
}

/// The last `n` log lines (for diagnostics export).
pub fn tail(n: usize) -> String {
    let Some(p) = LOG_PATH.get() else { return String::new() };
    let Ok(file) = std::fs::File::open(p) else { return String::new() };
    let lines: Vec<String> = std::io::BufReader::new(file).lines().map_while(Result::ok).collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}
