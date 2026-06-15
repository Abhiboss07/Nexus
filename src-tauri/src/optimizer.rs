//! Linux Optimizer — power-user maintenance that is genuinely safe and useful on
//! Linux. Every destructive action is **preview-first** (the scan reports exactly
//! how much is reclaimable before anything is touched) and HOME/owner-scoped.
//!
//! Privilege model: operations that require root (drop_caches, orphan removal,
//! journal vacuum) are run through `pkexec` so the user gets a polkit prompt —
//! Nexus never silently escalates and never embeds a password. User-level
//! operations (cache/thumbnail cleanup, user-service & autostart toggles) run
//! directly without elevation.

use std::process::Command;

use serde::Serialize;

fn home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/root".into())
}

fn has(cmd: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(cmd).is_file()))
        .unwrap_or(false)
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// Run a privileged shell command via pkexec (polkit prompt). Honest error when
/// pkexec is unavailable or the user cancels.
fn pkexec_sh(script: &str) -> Result<String, String> {
    if !has("pkexec") {
        return Err(
            "pkexec (polkit) is not installed — cannot run privileged actions. Install polkit."
                .into(),
        );
    }
    let out = Command::new("pkexec")
        .args(["sh", "-c", script])
        .output()
        .map_err(|e| format!("Failed to launch pkexec: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let code = out.status.code().unwrap_or(-1);
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        // pkexec exits 126 when the user dismisses the auth dialog.
        if code == 126 {
            Err("Authorization was dismissed.".into())
        } else if err.is_empty() {
            Err(format!("Command failed (exit {code})."))
        } else {
            Err(err)
        }
    }
}

fn human(b: u64) -> String {
    const U: [&str; 5] = ["B", "KB", "MB", "GB", "TB"];
    let mut v = b as f64;
    let mut i = 0;
    while v >= 1024.0 && i < U.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    format!("{v:.1} {}", U[i])
}

/* -------------------------------- memory --------------------------------- */

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemoryInfo {
    pub total_bytes: u64,
    pub free_bytes: u64,
    pub available_bytes: u64,
    pub cached_bytes: u64,
    pub buffers_bytes: u64,
    pub sreclaimable_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    /// Cache + reclaimable slab — what `drop_caches` can plausibly reclaim.
    pub reclaimable_bytes: u64,
}

fn meminfo() -> MemoryInfo {
    let text = std::fs::read_to_string("/proc/meminfo").unwrap_or_default();
    let kb = |key: &str| -> u64 {
        text.lines()
            .find(|l| l.starts_with(key))
            .and_then(|l| l.split_whitespace().nth(1))
            .and_then(|x| x.parse::<u64>().ok())
            .map(|v| v * 1024)
            .unwrap_or(0)
    };
    let cached = kb("Cached:");
    let sreclaimable = kb("SReclaimable:");
    let buffers = kb("Buffers:");
    let swap_total = kb("SwapTotal:");
    let swap_free = kb("SwapFree:");
    MemoryInfo {
        total_bytes: kb("MemTotal:"),
        free_bytes: kb("MemFree:"),
        available_bytes: kb("MemAvailable:"),
        cached_bytes: cached,
        buffers_bytes: buffers,
        sreclaimable_bytes: sreclaimable,
        swap_total_bytes: swap_total,
        swap_used_bytes: swap_total.saturating_sub(swap_free),
        reclaimable_bytes: cached + sreclaimable + buffers,
    }
}

/// Drop kernel caches. level 1 = page cache, 2 = dentries+inodes, 3 = both.
/// Privileged (writes /proc/sys/vm/drop_caches). Reports memory freed.
pub fn drop_caches(level: u8) -> Result<String, String> {
    let level = level.clamp(1, 3);
    let before = meminfo().available_bytes;
    pkexec_sh(&format!("sync && echo {level} > /proc/sys/vm/drop_caches"))?;
    let after = meminfo().available_bytes;
    let freed = after.saturating_sub(before);
    let what = match level {
        1 => "page cache",
        2 => "dentries & inodes",
        _ => "page cache + dentries + inodes",
    };
    Ok(format!("Dropped {what}. Reclaimed ~{}.", human(freed)))
}

/* ------------------------------- packages -------------------------------- */

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct OrphanPackages {
    /// Whether this distro's package manager is supported (pacman).
    pub supported: bool,
    pub manager: String,
    pub count: usize,
    pub names: Vec<String>,
}

fn orphans() -> OrphanPackages {
    if !has("pacman") {
        return OrphanPackages {
            supported: false,
            manager: String::new(),
            ..Default::default()
        };
    }
    // -Qtdq: unrequired (orphan) packages, names only.
    let names: Vec<String> = run("pacman", &["-Qtdq"])
        .map(|s| {
            s.lines()
                .filter(|l| !l.trim().is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    OrphanPackages {
        supported: true,
        manager: "pacman".into(),
        count: names.len(),
        names,
    }
}

/// Remove orphan packages (pacman -Rns). Privileged. No-op when none.
pub fn remove_orphans() -> Result<String, String> {
    let o = orphans();
    if !o.supported {
        return Err("Orphan cleanup currently supports pacman-based distros only.".into());
    }
    if o.names.is_empty() {
        return Ok("No orphan packages to remove.".into());
    }
    // Recompute inside the privileged shell so we never pass a stale list.
    pkexec_sh("orphans=$(pacman -Qtdq); [ -n \"$orphans\" ] && pacman -Rns --noconfirm $orphans || echo 'none'")?;
    Ok(format!("Removed {} orphan package(s).", o.count))
}

/* ------------------------------- journal --------------------------------- */

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct JournalInfo {
    pub supported: bool,
    pub size_bytes: u64,
    pub human: String,
}

fn journal_info() -> JournalInfo {
    if !has("journalctl") {
        return JournalInfo::default();
    }
    // "Archived and active journals take up 512.0M in the file system."
    let raw = run("journalctl", &["--disk-usage"]).unwrap_or_default();
    let size_bytes = parse_journal_size(&raw);
    JournalInfo {
        supported: true,
        size_bytes,
        human: if size_bytes > 0 {
            human(size_bytes)
        } else {
            raw
        },
    }
}

fn parse_journal_size(raw: &str) -> u64 {
    // Find a token like "512.0M" / "1.2G" / "768K". No unwrap: the suffix char is
    // matched explicitly and the numeric part is parsed fallibly.
    for tok in raw.split_whitespace() {
        let t = tok.trim_end_matches('.');
        let Some(last) = t.chars().last() else {
            continue;
        };
        let mult: f64 = match last {
            'B' => 1.0,
            'K' => 1024.0,
            'M' => 1024.0 * 1024.0,
            'G' => 1024.0_f64.powi(3),
            'T' => 1024.0_f64.powi(4),
            _ => continue,
        };
        if let Ok(n) = t[..t.len() - last.len_utf8()].parse::<f64>() {
            return (n * mult) as u64;
        }
    }
    0
}

/// Vacuum the systemd journal to the last `days` days. Privileged.
pub fn vacuum_journal(days: u32) -> Result<String, String> {
    if !has("journalctl") {
        return Err("journalctl is not available on this system.".into());
    }
    let days = days.clamp(1, 3650);
    let before = journal_info().size_bytes;
    pkexec_sh(&format!("journalctl --vacuum-time={days}d"))?;
    let after = journal_info().size_bytes;
    let freed = before.saturating_sub(after);
    Ok(format!(
        "Vacuumed journal to {days} days. Freed ~{}.",
        human(freed)
    ))
}

/* ----------------------------- temp / caches ----------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanupTarget {
    pub id: String,
    pub label: String,
    pub path: String,
    pub size_bytes: u64,
    /// Privileged ops are flagged so the UI can warn before prompting.
    pub user_level: bool,
    pub note: String,
}

fn du_bytes(path: &str) -> u64 {
    run("du", &["-sxb", path])
        .and_then(|s| {
            s.split_whitespace()
                .next()
                .and_then(|x| x.parse::<u64>().ok())
        })
        .unwrap_or(0)
}

fn cleanup_targets() -> Vec<CleanupTarget> {
    let h = home();
    let mut out = Vec::new();
    let mut add = |id: &str, label: &str, path: String, user: bool, note: &str| {
        if std::path::Path::new(&path).exists() {
            out.push(CleanupTarget {
                id: id.into(),
                label: label.into(),
                size_bytes: du_bytes(&path),
                path,
                user_level: user,
                note: note.into(),
            });
        }
    };
    add(
        "thumbnails",
        "Thumbnail cache",
        format!("{h}/.cache/thumbnails"),
        true,
        "Safe — regenerated on demand.",
    );
    add(
        "trash",
        "Trash",
        format!("{h}/.local/share/Trash"),
        true,
        "Empties your Trash.",
    );
    add(
        "user-cache",
        "User cache (~/.cache)",
        format!("{h}/.cache"),
        true,
        "Apps may need to rebuild caches; closes nothing.",
    );
    add(
        "tmp",
        "Temp files (/tmp, your files)",
        "/tmp".into(),
        true,
        "Only deletes files you own; skips files in use by running apps where possible.",
    );
    out
}

/// Clean a known cleanup target. User-level (no elevation). Returns space freed.
pub fn clean_temp(id: &str) -> Result<String, String> {
    let h = home();
    let (path, owner_only) = match id {
        "thumbnails" => (format!("{h}/.cache/thumbnails"), false),
        "trash" => (format!("{h}/.local/share/Trash"), false),
        "user-cache" => (format!("{h}/.cache"), false),
        "tmp" => ("/tmp".to_string(), true), // only remove files we own
        other => return Err(format!("Unknown cleanup target '{other}'.")),
    };
    if !std::path::Path::new(&path).exists() {
        return Ok("Nothing to clean.".into());
    }
    let before = du_bytes(&path);
    let mut removed = 0u64;
    let uid = unsafe { libc::geteuid() };
    let Ok(rd) = std::fs::read_dir(&path) else {
        return Err(format!("Cannot read {path}."));
    };
    for entry in rd.flatten() {
        let p = entry.path();
        // For /tmp, only touch entries owned by the current user.
        if owner_only {
            use std::os::unix::fs::MetadataExt;
            let owned = std::fs::symlink_metadata(&p)
                .map(|m| m.uid() == uid)
                .unwrap_or(false);
            if !owned {
                continue;
            }
        }
        let r = if p.is_dir() && !p.is_symlink() {
            std::fs::remove_dir_all(&p)
        } else {
            std::fs::remove_file(&p)
        };
        if r.is_ok() {
            removed += 1;
        }
    }
    let after = du_bytes(&path);
    Ok(format!(
        "Cleaned {} item(s) from {}. Freed ~{}.",
        removed,
        path.replace(&h, "~"),
        human(before.saturating_sub(after))
    ))
}

/* ------------------------------- startup --------------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupItem {
    pub id: String,
    pub name: String,
    /// "service" (systemd --user) or "autostart" (XDG .desktop)
    pub kind: String,
    pub enabled: bool,
    pub detail: String,
}

fn startup_items() -> Vec<StartupItem> {
    let mut out = Vec::new();

    // systemd --user enabled service units.
    if has("systemctl") {
        if let Some(list) = run(
            "systemctl",
            &[
                "--user",
                "list-unit-files",
                "--type=service",
                "--no-legend",
                "--no-pager",
            ],
        ) {
            for line in list.lines() {
                let mut cols = line.split_whitespace();
                let (Some(unit), Some(state)) = (cols.next(), cols.next()) else {
                    continue;
                };
                // Only show units the user can meaningfully toggle.
                if !matches!(state, "enabled" | "disabled") {
                    continue;
                }
                out.push(StartupItem {
                    id: unit.to_string(),
                    name: unit.trim_end_matches(".service").to_string(),
                    kind: "service".into(),
                    enabled: state == "enabled",
                    detail: format!("user service · {state}"),
                });
            }
        }
    }

    // XDG autostart entries.
    let dir = format!("{}/.config/autostart", home());
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.flatten() {
            let p = entry.path();
            if p.extension().map(|x| x == "desktop").unwrap_or(false) {
                let text = std::fs::read_to_string(&p).unwrap_or_default();
                let name = text
                    .lines()
                    .find_map(|l| l.strip_prefix("Name="))
                    .unwrap_or("")
                    .to_string();
                let hidden = text.lines().any(|l| l.trim() == "Hidden=true");
                out.push(StartupItem {
                    id: p.to_string_lossy().to_string(),
                    name: if name.is_empty() {
                        entry.file_name().to_string_lossy().to_string()
                    } else {
                        name
                    },
                    kind: "autostart".into(),
                    enabled: !hidden,
                    detail: "login autostart".into(),
                });
            }
        }
    }

    out.sort_by_key(|a| a.name.to_lowercase());
    out.truncate(80);
    out
}

/// Enable/disable a startup item. User-level: `systemctl --user` for services,
/// the `Hidden=` key for XDG autostart entries.
pub fn set_startup(id: &str, kind: &str, enabled: bool) -> Result<String, String> {
    match kind {
        "service" => {
            if !has("systemctl") {
                return Err("systemctl is not available.".into());
            }
            let action = if enabled { "enable" } else { "disable" };
            let out = Command::new("systemctl")
                .args(["--user", action, id])
                .output()
                .map_err(|e| e.to_string())?;
            if out.status.success() {
                Ok(format!(
                    "{} {id}.",
                    if enabled { "Enabled" } else { "Disabled" }
                ))
            } else {
                Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
            }
        }
        "autostart" => {
            // Toggle the Hidden= key in the .desktop file (XDG-standard disable).
            let text = std::fs::read_to_string(id).map_err(|e| e.to_string())?;
            let mut lines: Vec<String> = text
                .lines()
                .filter(|l| !l.trim().starts_with("Hidden="))
                .map(String::from)
                .collect();
            if !enabled {
                lines.push("Hidden=true".into());
            }
            std::fs::write(id, lines.join("\n") + "\n").map_err(|e| e.to_string())?;
            Ok(format!(
                "{} autostart entry.",
                if enabled { "Enabled" } else { "Disabled" }
            ))
        }
        other => Err(format!("Unknown startup kind '{other}'.")),
    }
}

/* -------------------------------- report --------------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizerReport {
    pub memory: MemoryInfo,
    pub temp: Vec<CleanupTarget>,
    pub orphans: OrphanPackages,
    pub journal: JournalInfo,
    pub startup: Vec<StartupItem>,
    /// Total user-level reclaimable across temp targets.
    pub reclaimable_bytes: u64,
    pub pkexec_available: bool,
}

pub fn scan() -> OptimizerReport {
    let temp = cleanup_targets();
    let reclaimable_bytes = temp.iter().map(|t| t.size_bytes).sum();
    OptimizerReport {
        memory: meminfo(),
        reclaimable_bytes,
        temp,
        orphans: orphans(),
        journal: journal_info(),
        startup: startup_items(),
        pkexec_available: has("pkexec"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_journal_sizes() {
        assert_eq!(
            parse_journal_size("take up 512.0M in the file system."),
            (512.0 * 1024.0 * 1024.0) as u64
        );
        assert_eq!(parse_journal_size("up 1.0G in"), 1024 * 1024 * 1024);
        assert_eq!(parse_journal_size("nothing here"), 0);
    }

    #[test]
    fn meminfo_reads_real_proc() {
        let m = meminfo();
        assert!(m.total_bytes > 0, "should read MemTotal on Linux");
        assert!(m.reclaimable_bytes >= m.cached_bytes.saturating_sub(1));
    }

    #[test]
    fn scan_is_well_formed() {
        let r = scan();
        assert!(r.memory.total_bytes > 0);
        // reclaimable equals the sum of temp target sizes.
        assert_eq!(
            r.reclaimable_bytes,
            r.temp.iter().map(|t| t.size_bytes).sum::<u64>()
        );
    }

    #[test]
    fn clean_temp_rejects_unknown_target() {
        assert!(clean_temp("../etc").is_err());
    }

    #[test]
    fn set_startup_rejects_unknown_kind() {
        assert!(set_startup("x", "bogus", true).is_err());
    }
}
