//! Lightweight file logging, panic capture, crash detection, and signal-aware
//! clean shutdown. No external logging crate — appends timestamped lines to the
//! app data dir and installs a panic hook so crashes leave a trace + a marker
//! the UI can surface.
//!
//! ## Shutdown / crash model
//!
//! Two on-disk markers under the data dir distinguish *how* the previous
//! session ended:
//!
//! - `running.lock` — written at startup, removed on any clean shutdown. If it
//!   survives into the next launch, the previous session did **not** shut down
//!   cleanly (SIGKILL, power loss, a native crash, or a panic under
//!   `panic=abort`).
//! - `crash.flag` — written **only** by the panic hook or a fatal-signal handler
//!   (SIGSEGV/SIGABRT/…). Its presence at startup means the previous session
//!   ended in a *genuine crash*.
//!
//! This lets us be precise about the four termination classes:
//!
//! | Cause                         | running.lock | crash.flag | Treated as |
//! |-------------------------------|:------------:|:----------:|------------|
//! | Normal exit (tray quit/Exit)  | removed      | —          | clean      |
//! | SIGINT (Ctrl+C in `tauri dev`)| removed      | —          | clean      |
//! | SIGTERM (logout/system halt)  | removed      | —          | clean      |
//! | SIGKILL / power loss          | **left**     | —          | abrupt     |
//! | Panic / fatal signal (SIGSEGV)| **left**     | **set**    | **crash**  |
//!
//! Only the last row drives the user-facing "recovered from a crash" warning.
//! A bare leftover `running.lock` (an abrupt kill) is logged at INFO and is
//! **not** reported as a crash — this is what previously caused the false
//! "did not shut down cleanly" warning every time `cargo tauri dev` was
//! interrupted with Ctrl+C.

use std::ffi::CString;
use std::fs::OpenOptions;
use std::io::{BufRead, Write};
use std::os::raw::c_int;
use std::path::PathBuf;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::OnceLock;
use std::time::{SystemTime, UNIX_EPOCH};

static LOG_PATH: OnceLock<PathBuf> = OnceLock::new();
/// `running.lock` path as a C string, for async-signal-safe `unlink(2)`.
static MARKER_C: OnceLock<CString> = OnceLock::new();
/// `crash.flag` path as a C string, for async-signal-safe `open(2)`.
static CRASH_C: OnceLock<CString> = OnceLock::new();
/// Write end of the self-pipe the graceful signal handler pokes.
static SIG_PIPE_W: AtomicI32 = AtomicI32::new(-1);

pub fn data_dir() -> PathBuf {
    let base = std::env::var("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
                .join(".local/share")
        });
    base.join("com.nexus.controlcenter")
}

fn marker_path() -> PathBuf {
    data_dir().join("running.lock")
}

fn crash_flag_path() -> PathBuf {
    data_dir().join("crash.flag")
}

fn now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Compact UTC-ish HH:MM:SS over the day plus epoch for ordering.
    let h = (secs / 3600) % 24;
    let m = (secs / 60) % 60;
    let s = secs % 60;
    format!("{h:02}:{m:02}:{s:02} ({secs})")
}

/// Outcome of inspecting the previous session's markers at startup.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PriorExit {
    /// Previous session shut down cleanly (or this is a first run).
    Clean,
    /// Terminated without a clean shutdown but with no crash signature
    /// (SIGKILL / power loss). Not a crash.
    Abrupt,
    /// A genuine crash — a Rust panic or a fatal signal (SIGSEGV/SIGABRT/…).
    Crashed,
}

/// Classify the previous exit from the two markers (pure, testable). A genuine
/// crash (crash.flag) takes precedence; a bare leftover marker is abrupt — never
/// a crash, so an interrupted `cargo tauri dev` is not misreported.
fn classify(had_marker: bool, had_crash: bool) -> PriorExit {
    if had_crash {
        PriorExit::Crashed
    } else if had_marker {
        PriorExit::Abrupt
    } else {
        PriorExit::Clean
    }
}

/// Initialize logging, install the panic hook, classify the previous exit, and
/// arm a fresh `running.lock`. Returns whether the previous session **crashed**
/// (panic / fatal signal) — the only case the UI should treat as recovery.
pub fn init() -> bool {
    let dir = data_dir().join("logs");
    let _ = std::fs::create_dir_all(&dir);
    let _ = LOG_PATH.set(dir.join("nexus.log"));
    rotate_if_large();

    // Cache C-string paths for use inside async-signal-safe handlers.
    if let Ok(c) = CString::new(marker_path().to_string_lossy().as_bytes()) {
        let _ = MARKER_C.set(c);
    }
    if let Ok(c) = CString::new(crash_flag_path().to_string_lossy().as_bytes()) {
        let _ = CRASH_C.set(c);
    }

    // Classify how the previous session ended.
    let prior = classify(marker_path().exists(), crash_flag_path().exists());
    // Consume the crash flag so it never carries over to a later launch.
    let _ = std::fs::remove_file(crash_flag_path());

    match prior {
        PriorExit::Crashed => line(
            "WARN",
            "Previous session ended in a crash (panic/fatal signal) — recovered.",
        ),
        PriorExit::Abrupt => line(
            "INFO",
            "Previous session was terminated abruptly (SIGKILL/power loss) — not a crash.",
        ),
        PriorExit::Clean => {}
    }

    // Arm a fresh marker for this session.
    let _ = std::fs::write(marker_path(), b"running");

    // Panic hook records a genuine crash (runs before abort under panic=abort).
    std::panic::set_hook(Box::new(|info| {
        let loc = info
            .location()
            .map(|l| format!("{}:{}", l.file(), l.line()))
            .unwrap_or_default();
        line("PANIC", &format!("{info} @ {loc}"));
        let _ = std::fs::write(crash_flag_path(), b"panic");
    }));

    line(
        "INFO",
        &format!("Nexus {} starting", env!("CARGO_PKG_VERSION")),
    );
    prior == PriorExit::Crashed
}

/// Mark a clean shutdown (removes the `running.lock` marker).
pub fn shutdown() {
    shutdown_with("Nexus shutting down cleanly");
}

/// Clean shutdown with a specific reason (e.g. the signal that triggered it).
pub fn shutdown_with(reason: &str) {
    line("INFO", reason);
    let _ = std::fs::remove_file(marker_path());
}

/* --------------------------- signal handling ----------------------------- */

/// Graceful-termination signals: a clean shutdown, never a crash.
const GRACEFUL: [c_int; 3] = [libc::SIGINT, libc::SIGTERM, libc::SIGHUP];
/// Fatal signals that indicate a real native crash.
const FATAL: [c_int; 5] = [
    libc::SIGSEGV,
    libc::SIGABRT,
    libc::SIGBUS,
    libc::SIGILL,
    libc::SIGFPE,
];

/// Handler for graceful signals (SIGINT/SIGTERM/SIGHUP). Async-signal-safe:
/// pokes a self-pipe; the real shutdown work happens on a normal thread.
extern "C" fn on_graceful(sig: c_int) {
    let fd = SIG_PIPE_W.load(Ordering::Relaxed);
    if fd >= 0 {
        let byte = [sig as u8];
        unsafe { libc::write(fd, byte.as_ptr() as *const libc::c_void, 1) };
    }
}

/// Handler for fatal signals. Async-signal-safe: writes the `crash.flag` via a
/// single `open(O_CREAT)` syscall, then restores the default disposition and
/// re-raises so the process dies (and can dump core) with the right status.
extern "C" fn on_fatal(sig: c_int) {
    if let Some(path) = CRASH_C.get() {
        unsafe {
            let fd = libc::open(
                path.as_ptr(),
                libc::O_CREAT | libc::O_WRONLY | libc::O_TRUNC,
                0o644,
            );
            if fd >= 0 {
                let _ = libc::write(fd, b"crash".as_ptr() as *const libc::c_void, 5);
                libc::close(fd);
            }
            libc::signal(sig, libc::SIG_DFL);
            libc::raise(sig);
        }
    }
}

/// Install POSIX signal handlers so that:
/// - SIGINT (Ctrl+C in `cargo tauri dev`), SIGTERM (logout / `systemctl`/`kill`),
///   and SIGHUP perform a **clean** shutdown — removing the marker so the next
///   launch is not flagged as a crash.
/// - SIGSEGV/SIGABRT/… record a `crash.flag` before dying.
///
/// SIGKILL cannot be caught (by design); that path is reported as "abrupt", not
/// a crash. Called once from `run()` after `init()`.
pub fn install_signal_handlers() {
    unsafe {
        let mut fds = [0 as c_int; 2];
        if libc::pipe(fds.as_mut_ptr()) != 0 {
            line(
                "WARN",
                "Could not create signal pipe; clean-shutdown-on-signal disabled.",
            );
            return;
        }
        let (read_fd, write_fd) = (fds[0], fds[1]);
        SIG_PIPE_W.store(write_fd, Ordering::Relaxed);

        for &sig in &GRACEFUL {
            libc::signal(
                sig,
                on_graceful as extern "C" fn(c_int) as libc::sighandler_t,
            );
        }
        for &sig in &FATAL {
            libc::signal(sig, on_fatal as extern "C" fn(c_int) as libc::sighandler_t);
        }

        // Drain thread: wakes on the first graceful signal, shuts down cleanly.
        std::thread::spawn(move || {
            let mut buf = [0u8; 1];
            let n = libc::read(read_fd, buf.as_mut_ptr() as *mut libc::c_void, 1);
            let sig = if n == 1 { buf[0] as c_int } else { 0 };
            let name = match sig {
                libc::SIGINT => "SIGINT (interrupt — e.g. Ctrl+C in dev)",
                libc::SIGTERM => "SIGTERM (terminate — logout/system shutdown)",
                libc::SIGHUP => "SIGHUP (hangup)",
                _ => "termination signal",
            };
            shutdown_with(&format!("Clean shutdown on {name}"));
            // Hard exit: the marker is already removed (a clean shutdown), so this
            // is correct. It bypasses GTK/webkit's orderly EGL teardown, which is
            // why a cosmetic `Gdk-WARNING: eglMakeCurrent failed` can print as the
            // process dies on Ctrl+C/SIGTERM — the OS reclaims the GPU context and
            // all memory, so there is no crash, leak, or frozen window. The tray
            // "Quit" path (app.exit) does the orderly teardown instead.
            std::process::exit(0);
        });
    }
}

/* ------------------------------- logging --------------------------------- */

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
    let Some(p) = LOG_PATH.get() else {
        return String::new();
    };
    let Ok(file) = std::fs::File::open(p) else {
        return String::new();
    };
    let lines: Vec<String> = std::io::BufReader::new(file)
        .lines()
        .map_while(Result::ok)
        .collect();
    let start = lines.len().saturating_sub(n);
    lines[start..].join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_exit_when_no_markers() {
        // Normal exit, SIGINT, or SIGTERM all remove the marker ⇒ no markers.
        assert_eq!(classify(false, false), PriorExit::Clean);
    }

    #[test]
    fn leftover_marker_alone_is_abrupt_not_crash() {
        // SIGKILL / power loss leave running.lock but no crash.flag. This is the
        // case that previously produced the false "did not shut down cleanly"
        // crash warning — it must NOT be classified as a crash.
        assert_eq!(classify(true, false), PriorExit::Abrupt);
        // init() returns `prior == Crashed`; abrupt must therefore not recover.
        assert_ne!(classify(true, false), PriorExit::Crashed);
    }

    #[test]
    fn crash_flag_means_crash() {
        // Panic or fatal signal set crash.flag (marker also typically remains).
        assert_eq!(classify(true, true), PriorExit::Crashed);
        // Even a stray crash.flag without a marker is still a crash.
        assert_eq!(classify(false, true), PriorExit::Crashed);
    }

    #[test]
    fn signal_sets_are_disjoint() {
        // A signal is never both graceful and fatal.
        for g in GRACEFUL {
            assert!(
                !FATAL.contains(&g),
                "signal {g} listed as both graceful and fatal"
            );
        }
    }
}
