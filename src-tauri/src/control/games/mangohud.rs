//! MangoHud performance overlay — detection + config presets. The config file
//! (`~/.config/MangoHud/MangoHud.conf`) is a user file, so writing presets is
//! safe and capability-gated on MangoHud actually being installed.

use std::path::PathBuf;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MangoHudPreset {
    pub name: String,
    pub description: String,
    pub config: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MangoHudStatus {
    pub available: bool,
    pub config_path: String,
    pub config_exists: bool,
    pub current_config: Option<String>,
    pub presets: Vec<MangoHudPreset>,
}

fn command_exists(bin: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(bin).is_file()))
        .unwrap_or(false)
}

pub fn available() -> bool {
    command_exists("mangohud")
}

fn config_path() -> PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())).join(".config")
        });
    base.join("MangoHud").join("MangoHud.conf")
}

/// Logging keys appended to every preset so a running game continuously writes
/// FPS rows that Nexus' frame-rate source (`telemetry::fps`) can read back live.
/// `autostart_log=1` begins logging 1s after the overlay attaches; the 1s
/// `log_interval` matches our 5s store cadence with headroom to spare.
fn logging_keys() -> String {
    let dir = crate::telemetry::fps::log_dir();
    format!(
        "output_folder={}\nlog_interval=1000\nautostart_log=1\n",
        dir.to_string_lossy()
    )
}

pub fn presets() -> Vec<MangoHudPreset> {
    let log = logging_keys();
    vec![
        MangoHudPreset {
            name: "Minimal".into(),
            description: "Just FPS".into(),
            config: format!("fps\nfps_limit=0\nposition=top-left\nfont_size=22\n{log}"),
        },
        MangoHudPreset {
            name: "Standard".into(),
            description: "FPS, frametime, CPU/GPU".into(),
            config: format!("fps\nframetime\ncpu_stats\ncpu_temp\ngpu_stats\ngpu_temp\nram\nvram\nposition=top-left\nfont_size=20\nbackground_alpha=0.4\n{log}"),
        },
        MangoHudPreset {
            name: "Full".into(),
            description: "Everything: FPS, frametime, CPU, GPU, RAM, VRAM, graphs".into(),
            config: format!("fps\nframetime\nframe_timing\ncpu_stats\ncpu_temp\ncpu_power\ngpu_stats\ngpu_temp\ngpu_core_clock\ngpu_mem_clock\ngpu_power\nram\nvram\nio_stats\nposition=top-left\nfont_size=20\nbackground_alpha=0.5\ngpu_load_change\ncpu_load_change\n{log}"),
        },
    ]
}

pub fn status() -> MangoHudStatus {
    let path = config_path();
    let current_config = std::fs::read_to_string(&path).ok();
    MangoHudStatus {
        available: available(),
        config_path: path.to_string_lossy().to_string(),
        config_exists: path.exists(),
        current_config,
        presets: presets(),
    }
}

/// Write a config string to `MangoHud.conf` (creating the directory). Also
/// ensures the FPS log folder exists — MangoHud will not create `output_folder`
/// itself and silently skips logging if it's missing, which would break the
/// frame-rate source.
pub fn write_config(config: &str) -> Result<(), String> {
    let path = config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let _ = std::fs::create_dir_all(crate::telemetry::fps::log_dir());
    std::fs::write(&path, config).map_err(|e| e.to_string())
}
