//! Frame-rate source — live FPS read from MangoHud's CSV logs.
//!
//! MangoHud is the de-facto FPS overlay on Linux and the only broadly-available
//! source that works across Steam/Proton, native, Vulkan and OpenGL titles.
//! There is no live IPC/socket API, but when configured with `output_folder` +
//! `log_interval` + `autostart_log` it appends one CSV row per interval to
//! `<output_folder>/<app>_<timestamp>.csv` for the lifetime of a running game.
//!
//! We tail the **newest active** log (one whose mtime is within a freshness
//! window) and parse the last few `fps` values. No game running → no fresh log
//! → `None`, and the telemetry store simply records `None` (FPS columns stay 0).
//! This is read-only and side-effect free apart from opportunistic pruning of
//! stale logs so the folder doesn't grow without bound.
//!
//! The Nexus MangoHud presets (see `control/games/mangohud.rs`) point logging at
//! [`log_dir`], so enabling the overlay through Nexus closes the loop end to end.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

/// A log written/touched within this window counts as "a game is running now".
/// Generous enough to cover a 1s `log_interval` plus disk-flush latency without
/// latching onto a stale file from a previous session.
const FRESH_WINDOW: Duration = Duration::from_secs(8);

/// Average the FPS over the last N data rows for a steadier reading than a
/// single instantaneous frame would give.
const SMOOTH_ROWS: usize = 5;

/// CSV logs older than this are pruned on scan — keeps the folder bounded
/// without a dedicated maintenance task.
const PRUNE_AGE: Duration = Duration::from_secs(24 * 60 * 60);

fn config_home() -> PathBuf {
    std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())).join(".config")
        })
}

/// Where Nexus tells MangoHud to write logs (and where we read them from). If
/// the user has set their own `output_folder` in `MangoHud.conf`, honour that;
/// otherwise default to `<config>/MangoHud/logs`.
pub fn log_dir() -> PathBuf {
    let conf = config_home().join("MangoHud").join("MangoHud.conf");
    if let Ok(text) = fs::read_to_string(&conf) {
        if let Some(folder) = parse_output_folder(&text) {
            return PathBuf::from(expand_home(&folder));
        }
    }
    config_home().join("MangoHud").join("logs")
}

/// Extract `output_folder=...` from a MangoHud config (last assignment wins,
/// ignoring `#` comments). Returns `None` if unset/blank.
fn parse_output_folder(conf: &str) -> Option<String> {
    let mut found = None;
    for line in conf.lines() {
        let line = line.trim();
        if line.starts_with('#') {
            continue;
        }
        if let Some(rest) = line.strip_prefix("output_folder") {
            let val = rest.trim_start_matches([' ', '\t', '=']).trim();
            if !val.is_empty() {
                found = Some(val.to_string());
            }
        }
    }
    found
}

fn expand_home(p: &str) -> String {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return format!("{home}/{rest}");
        }
    }
    p.to_string()
}

/// The current FPS if a game is actively logging, else `None`.
pub fn current_fps() -> Option<f32> {
    let dir = log_dir();
    let newest = newest_active_csv(&dir, SystemTime::now())?;
    let content = fs::read_to_string(&newest).ok()?;
    parse_recent_fps(&content)
}

/// Find the most-recently-modified `*.csv` in `dir` whose mtime is within the
/// freshness window. Prunes clearly-stale logs as a side effect.
fn newest_active_csv(dir: &Path, now: SystemTime) -> Option<PathBuf> {
    let entries = fs::read_dir(dir).ok()?;
    let mut best: Option<(SystemTime, PathBuf)> = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("csv") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(mtime) = meta.modified() else { continue };

        // Opportunistic cleanup: drop logs from sessions long past.
        if now.duration_since(mtime).map(|a| a > PRUNE_AGE).unwrap_or(false) {
            let _ = fs::remove_file(&path);
            continue;
        }

        let fresh = now.duration_since(mtime).map(|a| a <= FRESH_WINDOW).unwrap_or(false);
        if fresh && best.as_ref().map(|(t, _)| mtime > *t).unwrap_or(true) {
            best = Some((mtime, path));
        }
    }
    best.map(|(_, p)| p)
}

/// Parse a MangoHud CSV body and return the smoothed recent FPS.
///
/// MangoHud logs begin with a hardware-info line, then a header row whose first
/// column is `fps`, then data rows `fps,frametime,…`. We average the `fps`
/// field of the last [`SMOOTH_ROWS`] *numeric* rows; non-numeric lines (the
/// hardware/header rows) are skipped because their first field doesn't parse.
fn parse_recent_fps(content: &str) -> Option<f32> {
    let mut recent: Vec<f32> = Vec::new();
    for line in content.lines().rev() {
        let first = line.split(',').next().unwrap_or("").trim();
        match first.parse::<f32>() {
            Ok(v) if v.is_finite() && v >= 0.0 => {
                recent.push(v);
                if recent.len() >= SMOOTH_ROWS {
                    break;
                }
            }
            // Stop once we hit the header/hardware preamble after collecting at
            // least one sample; otherwise keep scanning past trailing blanks.
            _ if !recent.is_empty() => break,
            _ => continue,
        }
    }
    if recent.is_empty() {
        return None;
    }
    let avg = recent.iter().sum::<f32>() / recent.len() as f32;
    Some(avg)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "os,cpu,gpu,ram,kernel,driver,cpuscheduler\n\
Arch,AMD Ryzen,NVIDIA RTX,16GB,6.0,nvidia,none\n\
fps,frametime,cpu_load,gpu_load,cpu_temp,gpu_temp,elapsed\n\
120.5,8.3,40,88,65,72,1000000\n\
118.0,8.5,42,90,66,73,2000000\n\
122.0,8.1,41,89,65,72,3000000\n";

    #[test]
    fn averages_recent_fps_rows() {
        // Only one numeric row beyond header here → averaged over available rows.
        let fps = parse_recent_fps(SAMPLE).unwrap();
        // mean(120.5, 118.0, 122.0) = 120.166…
        assert!((fps - 120.1667).abs() < 0.01, "got {fps}");
    }

    #[test]
    fn smooths_over_at_most_n_rows() {
        let mut body = String::from("fps,frametime\n");
        for i in 0..50 {
            body.push_str(&format!("{},8.0\n", 100 + i));
        }
        // last 5 rows are 145..149 → mean 147
        let fps = parse_recent_fps(&body).unwrap();
        assert!((fps - 147.0).abs() < 0.01, "got {fps}");
    }

    #[test]
    fn header_only_yields_none() {
        assert_eq!(parse_recent_fps("fps,frametime,elapsed\n"), None);
        assert_eq!(parse_recent_fps(""), None);
    }

    #[test]
    fn tolerates_trailing_blank_lines() {
        let body = "fps,frametime\n90.0,11.0\n\n\n";
        assert_eq!(parse_recent_fps(body), Some(90.0));
    }

    #[test]
    fn parses_output_folder_last_wins_ignoring_comments() {
        let conf = "# comment\noutput_folder=/tmp/old\nfps\noutput_folder = /tmp/new\n";
        assert_eq!(parse_output_folder(conf), Some("/tmp/new".to_string()));
        assert_eq!(parse_output_folder("#output_folder=/x\nfps\n"), None);
    }

    #[test]
    fn newest_active_csv_picks_fresh_file_and_skips_stale() {
        use std::io::Write;
        let dir = std::env::temp_dir().join(format!("nexus-fps-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let active = dir.join("game_now.csv");
        let mut f = fs::File::create(&active).unwrap();
        writeln!(f, "fps\n100.0").unwrap();
        drop(f);

        // A file with a clearly-old mtime should be ignored by the freshness test.
        let now = SystemTime::now();
        let picked = newest_active_csv(&dir, now);
        assert_eq!(picked.as_deref(), Some(active.as_path()));

        // Pretend "now" is far in the future → the file is no longer fresh.
        let future = now + Duration::from_secs(3600);
        assert_eq!(newest_active_csv(&dir, future), None);

        let _ = fs::remove_dir_all(&dir);
    }
}
