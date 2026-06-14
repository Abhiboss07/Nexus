//! `power-profiles-daemon` integration via the `powerprofilesctl` CLI.
//!
//! Verified output on the target machine:
//!   $ powerprofilesctl get   → `balanced`
//!   $ powerprofilesctl list  → indented blocks; the active profile line begins
//!     with `*`, each block has a `CpuDriver:` line.
//!   $ powerprofilesctl set <profile>  (allowed for the active session via polkit)

use std::process::Command;

use crate::control::traits::ControlError;

#[derive(Debug, Clone)]
pub struct ProfileEntry {
    pub name: String,
    pub cpu_driver: Option<String>,
    pub active: bool,
}

fn run(args: &[&str]) -> Result<std::process::Output, ControlError> {
    Command::new("powerprofilesctl").args(args).output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            ControlError::DriverUnavailable("power-profiles-daemon not installed".into())
        } else {
            ControlError::Io(e.to_string())
        }
    })
}

pub fn available() -> bool {
    run(&["version"]).map(|o| o.status.success()).unwrap_or(false)
}

pub fn get() -> Option<String> {
    let out = run(&["get"]).ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!s.is_empty()).then_some(s)
}

pub fn list() -> Vec<ProfileEntry> {
    let Ok(out) = run(&["list"]) else { return Vec::new() };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut entries: Vec<ProfileEntry> = Vec::new();

    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.ends_with(':') && !trimmed.contains(' ') || (trimmed.ends_with(':') && line.trim_start().starts_with('*')) {
            // A profile header line, e.g. "  performance:" or "* balanced:".
            let active = line.trim_start().starts_with('*');
            let name = trimmed.trim_start_matches('*').trim().trim_end_matches(':').trim().to_string();
            if !name.is_empty() {
                entries.push(ProfileEntry { name, cpu_driver: None, active });
            }
        } else if let Some(rest) = trimmed.strip_prefix("CpuDriver:") {
            if let Some(last) = entries.last_mut() {
                last.cpu_driver = Some(rest.trim().to_string());
            }
        }
    }
    entries
}

pub fn set(name: &str) -> Result<(), ControlError> {
    let out = run(&["set", name])?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr).to_lowercase();
    if err.contains("not authorized") || err.contains("accessdenied") || err.contains("permission") {
        Err(ControlError::PermissionDenied)
    } else if err.contains("does not exist") || err.contains("invalid") {
        Err(ControlError::InvalidParameter(format!("unknown profile '{name}'")))
    } else {
        Err(ControlError::Io(err.trim().to_string()))
    }
}
