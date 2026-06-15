//! Deep system diagnostics (System Doctor). Runs a battery of real, bounded
//! scans across hardware, storage, permissions, drivers, startup, services,
//! thermals, the gaming stack, containers, security and power management — plus
//! a storage analyzer (largest files/folders) with safe file operations.
//!
//! Everything here shells out to standard, already-present tools (df, du, find,
//! systemctl, journalctl, pacman, lsmod) at *scan time* — never in the hot
//! telemetry loop. Scopes are bounded (maxdepth, head -n) so a scan stays fast.

use std::process::Command;

use serde::Serialize;

use crate::control::ControlService;
use crate::diagnostics;

fn home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/root".into())
}

/// Run a command, returning stdout (trimmed) or None on failure.
fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    if out.status.success() || !out.stdout.is_empty() {
        Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        None
    }
}

fn has(cmd: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(cmd).is_file()))
        .unwrap_or(false)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// ok | info | warning | critical
    pub severity: String,
    pub title: String,
    pub detail: String,
    /// Optional remediation command/hint.
    pub fix: String,
}

fn f(severity: &str, title: &str, detail: impl Into<String>, fix: &str) -> Finding {
    Finding {
        severity: severity.into(),
        title: title.into(),
        detail: detail.into(),
        fix: fix.into(),
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanCategory {
    pub id: String,
    pub label: String,
    /// Worst severity across findings: ok | info | warning | critical
    pub status: String,
    pub summary: String,
    pub findings: Vec<Finding>,
}

impl ScanCategory {
    fn new(id: &str, label: &str, findings: Vec<Finding>) -> Self {
        let status = worst(&findings);
        let issues = findings
            .iter()
            .filter(|x| x.severity == "warning" || x.severity == "critical")
            .count();
        let summary = if issues == 0 {
            format!("{} checks · all clear", findings.len())
        } else {
            format!("{issues} issue(s) across {} checks", findings.len())
        };
        ScanCategory {
            id: id.into(),
            label: label.into(),
            status,
            summary,
            findings,
        }
    }
}

fn worst(findings: &[Finding]) -> String {
    let rank = |s: &str| match s {
        "critical" => 3,
        "warning" => 2,
        "info" => 1,
        _ => 0,
    };
    findings
        .iter()
        .map(|x| x.severity.as_str())
        .max_by_key(|s| rank(s))
        .unwrap_or("ok")
        .to_string()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageAnalysis {
    pub home: String,
    pub largest_files: Vec<FileEntry>,
    pub largest_folders: Vec<FileEntry>,
    pub recommendations: Vec<Finding>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemScan {
    pub categories: Vec<ScanCategory>,
    pub storage: StorageAnalysis,
    /// Overall 0–100 health derived from category severities.
    pub score: u8,
    pub generated_ms: u64,
}

/* ----------------------------- category scans ----------------------------- */

fn scan_hardware(control: &ControlService) -> ScanCategory {
    let p = control.profile();
    let gpu = control.gpu_capabilities();
    let mut out = vec![
        f("ok", "CPU", &p.cpu_model, ""),
        f(
            "ok",
            "Vendor",
            format!("{} · {}", p.vendor_label, p.product_name),
            "",
        ),
    ];
    if gpu.present {
        out.push(f(
            "ok",
            "GPU",
            format!("{} (CUDA {})", p.gpu_name, gpu.cuda_version),
            "",
        ));
    } else if p.has_nvidia {
        out.push(f(
            "warning",
            "GPU",
            "NVIDIA GPU present but nvidia-smi did not respond — driver issue?",
            "Check the nvidia kernel module is loaded.",
        ));
    }
    out.push(if p.has_battery {
        f("ok", "Battery", "Battery detected", "")
    } else {
        f("info", "Battery", "No battery (desktop)", "")
    });
    ScanCategory::new("hardware", "Hardware", out)
}

fn scan_storage_health() -> ScanCategory {
    let mut out = Vec::new();
    // Per-filesystem usage from df (real, bytes).
    if let Some(df) = run(
        "df",
        &[
            "-B1",
            "--output=target,pcent,used,size",
            "-x",
            "tmpfs",
            "-x",
            "devtmpfs",
        ],
    ) {
        for line in df.lines().skip(1) {
            let cols: Vec<&str> = line.split_whitespace().collect();
            if cols.len() < 2 {
                continue;
            }
            let target = cols[0];
            let pct: u32 = cols[1].trim_end_matches('%').parse().unwrap_or(0);
            // Only report real mount points, not every btrfs subvolume noise.
            if !(target == "/"
                || target.starts_with("/home")
                || target.starts_with("/mnt")
                || target.starts_with("/var"))
            {
                continue;
            }
            let sev = if pct >= 92 {
                "critical"
            } else if pct >= 80 {
                "warning"
            } else {
                "ok"
            };
            out.push(f(
                sev,
                target,
                format!("{pct}% used"),
                if pct >= 80 {
                    "Free space with the Storage Analyzer below."
                } else {
                    ""
                },
            ));
        }
    }
    if out.is_empty() {
        out.push(f("info", "Disk usage", "Could not read df output", ""));
    }
    ScanCategory::new("storage", "Storage", out)
}

fn scan_permissions(control: &ControlService) -> ScanCategory {
    let perms = diagnostics::permissions(control);
    let mut out = vec![
        if perms.in_input_group {
            f("ok", "Control group", "Member of input/nexus group", "")
        } else {
            f(
                "warning",
                "Control group",
                "Not in the input/nexus group — RGB & fan writes blocked",
                "sudo usermod -aG input $USER",
            )
        },
        if perms.rgb_writable {
            f("ok", "RGB nodes", "Writable", "")
        } else {
            f(
                "info",
                "RGB nodes",
                "Not writable (needs group membership)",
                "",
            )
        },
        if perms.fan_writable {
            f("ok", "Fan nodes", "Writable", "")
        } else {
            f(
                "info",
                "Fan nodes",
                "Not writable (needs group membership)",
                "",
            )
        },
    ];
    // RAPL energy readability (CPU package power telemetry).
    if !std::path::Path::new("/sys/class/powercap/intel-rapl:0/energy_uj").exists() {
        out.push(f("info", "RAPL", "No Intel RAPL energy node", ""));
    }
    ScanCategory::new("permissions", "Permissions", out)
}

fn scan_drivers(control: &ControlService) -> ScanCategory {
    let p = control.profile();
    let modules = std::fs::read_to_string("/proc/modules").unwrap_or_default();
    let loaded = |m: &str| {
        modules
            .lines()
            .any(|l| l.split_whitespace().next() == Some(m))
    };
    let mut out = Vec::new();

    if p.has_nvidia {
        out.push(if loaded("nvidia") {
            f("ok", "nvidia", "Kernel module loaded", "")
        } else {
            f(
                "warning",
                "nvidia",
                "NVIDIA GPU present but the nvidia module is not loaded",
                "Install/enable the proprietary driver (nvidia-dkms).",
            )
        });
    }
    out.push(
        if std::path::Path::new("/sys/devices/platform/omen-rgb-keyboard").exists() {
            f(
                "ok",
                "omen-rgb-keyboard",
                "Loaded (RGB + Victus-S fan interface)",
                "",
            )
        } else {
            f(
                "info",
                "omen-rgb-keyboard",
                "Not loaded (RGB/fan control unavailable)",
                "",
            )
        },
    );
    // Missing-driver heuristic: fan sensors absent and no platform driver.
    if !loaded("coretemp") && p.cpu_vendor.contains("Intel") {
        out.push(f(
            "warning",
            "coretemp",
            "Intel CPU but coretemp not loaded — no core temps",
            "sudo modprobe coretemp",
        ));
    }
    ScanCategory::new("drivers", "Drivers", out)
}

fn scan_startup() -> ScanCategory {
    let mut out = Vec::new();
    if has("systemctl") {
        if let Some(failed) = run(
            "systemctl",
            &["--failed", "--no-legend", "--plain", "--user"],
        ) {
            let n = failed.lines().filter(|l| !l.trim().is_empty()).count();
            out.push(if n == 0 {
                f("ok", "User services", "No failed user units", "")
            } else {
                f(
                    "warning",
                    "User services",
                    format!(
                        "{n} failed user unit(s): {}",
                        failed.lines().take(3).collect::<Vec<_>>().join(", ")
                    ),
                    "systemctl --user --failed",
                )
            });
        }
    }
    // Autostart entries.
    let autostart_dir = format!("{}/.config/autostart", home());
    let count = std::fs::read_dir(&autostart_dir)
        .map(|d| {
            d.flatten()
                .filter(|e| e.path().extension().is_some_and(|x| x == "desktop"))
                .count()
        })
        .unwrap_or(0);
    out.push(f(
        "info",
        "Autostart entries",
        format!("{count} desktop autostart entr(ies)"),
        "",
    ));
    if out.is_empty() {
        out.push(f("info", "Startup", "systemctl unavailable", ""));
    }
    ScanCategory::new("startup", "Startup", out)
}

fn scan_services() -> ScanCategory {
    let mut out = Vec::new();
    if has("systemctl") {
        if let Some(failed) = run("systemctl", &["--failed", "--no-legend", "--plain"]) {
            let units: Vec<&str> = failed
                .lines()
                .filter_map(|l| l.split_whitespace().next())
                .filter(|s| !s.is_empty())
                .collect();
            out.push(if units.is_empty() {
                f("ok", "System services", "No failed system units", "")
            } else {
                f(
                    "critical",
                    "Failed services",
                    format!(
                        "{}: {}",
                        units.len(),
                        units.iter().take(5).cloned().collect::<Vec<_>>().join(", ")
                    ),
                    "systemctl --failed  ·  journalctl -xe -u <unit>",
                )
            });
        }
    } else {
        out.push(f("info", "Services", "systemctl unavailable", ""));
    }
    ScanCategory::new("services", "Services", out)
}

fn scan_thermals(control: &ControlService) -> ScanCategory {
    let t = control.thermal_report();
    let sev = if t.score >= 80 {
        "ok"
    } else if t.score >= 55 {
        "warning"
    } else {
        "critical"
    };
    let mut out = vec![f(
        sev,
        "Thermal health",
        format!("Score {}/100 · {}", t.score, t.grade),
        "",
    )];
    if let Some(c) = t.cpu_c {
        out.push(f(
            if c >= 90.0 {
                "critical"
            } else if c >= 82.0 {
                "warning"
            } else {
                "ok"
            },
            "CPU temperature",
            format!("{c:.0}°C"),
            "",
        ));
    }
    if let Some(g) = t.gpu_c {
        out.push(f(
            if g >= 87.0 { "warning" } else { "ok" },
            "GPU temperature",
            format!("{g:.0}°C"),
            "",
        ));
    }
    ScanCategory::new("thermals", "Thermals", out)
}

fn scan_gaming(control: &ControlService) -> ScanCategory {
    let ints = control.integrations();
    let mut out = Vec::new();
    for id in ["steam", "gamemode", "mangohud", "gamescope", "lutris"] {
        if let Some(i) = ints.iter().find(|x| x.id == id) {
            out.push(if i.detected {
                f(
                    "ok",
                    &i.name,
                    if i.detail.is_empty() {
                        "installed".into()
                    } else {
                        i.detail.clone()
                    },
                    "",
                )
            } else {
                f("info", &i.name, "Not installed", &i.hint)
            });
        }
    }
    ScanCategory::new("gaming", "Gaming Stack", out)
}

fn scan_containers(control: &ControlService) -> ScanCategory {
    let ints = control.integrations();
    let mut out = Vec::new();
    for id in ["docker", "podman", "flatpak"] {
        if let Some(i) = ints.iter().find(|x| x.id == id) {
            out.push(if i.detected {
                f(
                    "ok",
                    &i.name,
                    if i.detail.is_empty() {
                        "installed".into()
                    } else {
                        i.detail.clone()
                    },
                    "",
                )
            } else {
                f("info", &i.name, "Not installed", &i.hint)
            });
        }
    }
    ScanCategory::new("containers", "Containers", out)
}

fn scan_security() -> ScanCategory {
    let mut out = Vec::new();
    // Firewall present + active?
    let fw = if has("ufw") {
        run("ufw", &["status"]).map(|s| ("ufw", s.contains("active")))
    } else if has("firewall-cmd") {
        run("firewall-cmd", &["--state"]).map(|s| ("firewalld", s.contains("running")))
    } else {
        None
    };
    match fw {
        Some((name, true)) => out.push(f("ok", "Firewall", format!("{name} active"), "")),
        Some((name, false)) => out.push(f(
            "warning",
            "Firewall",
            format!("{name} installed but inactive"),
            &format!("sudo systemctl enable --now {name}"),
        )),
        None => out.push(f(
            "info",
            "Firewall",
            "No ufw/firewalld detected",
            "Consider enabling a firewall.",
        )),
    }
    // Secure Boot.
    if std::path::Path::new("/sys/firmware/efi").exists() {
        if let Some(sb) = run("bootctl", &["status"]) {
            let on = sb.to_lowercase().contains("secure boot: enabled");
            out.push(f(
                "info",
                "Secure Boot",
                if on { "Enabled" } else { "Disabled" },
                "",
            ));
        }
    }
    // dmesg restriction (affects driver-log based detection).
    if std::fs::read_to_string("/proc/sys/kernel/dmesg_restrict")
        .map(|s| s.trim() == "1")
        .unwrap_or(false)
    {
        out.push(f(
            "info",
            "dmesg",
            "Restricted (kernel.dmesg_restrict=1) — fan-interface detection uses journald instead",
            "",
        ));
    }
    ScanCategory::new("security", "Security", out)
}

fn scan_power(control: &ControlService) -> ScanCategory {
    let caps = control.capabilities();
    let mut out = vec![if caps.power.status.controllable {
        f(
            "ok",
            "Power profiles",
            format!("Controllable via {}", caps.power.status.driver),
            "",
        )
    } else {
        f(
            "info",
            "Power profiles",
            caps.power.status.notes.clone(),
            "",
        )
    }];
    // cpufreq governor.
    if let Ok(gov) =
        std::fs::read_to_string("/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor")
    {
        out.push(f("ok", "CPU governor", gov.trim().to_string(), ""));
    }
    // Conflicting power daemons.
    if has("tlp") && std::path::Path::new("/run/systemd/system").exists() {
        out.push(f(
            "info",
            "TLP",
            "TLP installed — ensure it doesn't conflict with power-profiles-daemon",
            "",
        ));
    }
    ScanCategory::new("power", "Power Management", out)
}

/* ----------------------- scans surfaced as findings ----------------------- */

/// Journal errors, crash logs, orphan/broken packages, broken symlinks — folded
/// into a "Maintenance" category so the dedicated scans from the spec appear.
fn scan_maintenance() -> ScanCategory {
    let mut out = Vec::new();

    // Journal priority<=3 (errors) this boot.
    if has("journalctl") {
        if let Some(j) = run("journalctl", &["-p", "3", "-b", "--no-pager", "-q"]) {
            let n = j.lines().filter(|l| !l.trim().is_empty()).count();
            out.push(if n == 0 {
                f(
                    "ok",
                    "Journal errors",
                    "No priority-error journal entries this boot",
                    "",
                )
            } else {
                f(
                    if n > 40 { "warning" } else { "info" },
                    "Journal errors",
                    format!("{n} error-level journal entr(ies) this boot"),
                    "journalctl -p 3 -b",
                )
            });
        }
    }
    // Crash logs (coredumps).
    if has("coredumpctl") {
        if let Some(c) = run("coredumpctl", &["--no-pager", "list"]) {
            let n = c
                .lines()
                .filter(|l| l.contains("present") || l.contains("/"))
                .count();
            if n > 0 {
                out.push(f(
                    "warning",
                    "Crash logs",
                    format!("{n} recorded coredump(s)"),
                    "coredumpctl list",
                ));
            } else {
                out.push(f("ok", "Crash logs", "No recent coredumps", ""));
            }
        }
    }
    // Orphan packages (Arch).
    if has("pacman") {
        if let Some(orphans) = run("pacman", &["-Qtdq"]) {
            let n = orphans.lines().filter(|l| !l.trim().is_empty()).count();
            out.push(if n == 0 {
                f("ok", "Orphan packages", "None", "")
            } else {
                f(
                    "info",
                    "Orphan packages",
                    format!("{n} orphaned package(s)"),
                    "sudo pacman -Rns $(pacman -Qtdq)",
                )
            });
        }
        // Broken dependencies.
        if let Some(dk) = run("pacman", &["-Dk"]) {
            let bad = dk
                .lines()
                .filter(|l| {
                    l.to_lowercase().contains("missing") || l.to_lowercase().contains("error")
                })
                .count();
            if bad > 0 {
                out.push(f(
                    "warning",
                    "Broken packages",
                    format!("{bad} dependency issue(s)"),
                    "sudo pacman -Dk",
                ));
            } else {
                out.push(f("ok", "Package dependencies", "Consistent", ""));
            }
        }
    }
    // Broken symlinks in $HOME (shallow, bounded).
    if has("find") {
        if let Some(bs) = run("find", &[&home(), "-maxdepth", "4", "-xtype", "l"]) {
            let n = bs.lines().filter(|l| !l.trim().is_empty()).count();
            if n > 0 {
                out.push(f(
                    "info",
                    "Broken symlinks",
                    format!("{n} dangling symlink(s) under HOME"),
                    "",
                ));
            } else {
                out.push(f("ok", "Symlinks", "No broken symlinks under HOME", ""));
            }
        }
    }
    if out.is_empty() {
        out.push(f(
            "info",
            "Maintenance",
            "No maintenance tools available (journalctl/pacman/find)",
            "",
        ));
    }
    ScanCategory::new("maintenance", "Maintenance & Packages", out)
}

/* ------------------------------ storage analyzer -------------------------- */

fn parse_find_size(out: &str) -> Vec<FileEntry> {
    let mut v: Vec<FileEntry> = out
        .lines()
        .filter_map(|l| {
            let (size, path) = l.split_once('\t').or_else(|| l.split_once(' '))?;
            Some(FileEntry {
                size_bytes: size.trim().parse().ok()?,
                path: path.trim().to_string(),
            })
        })
        .collect();
    v.sort_by_key(|e| std::cmp::Reverse(e.size_bytes));
    v.truncate(20);
    v
}

pub fn storage_analysis() -> StorageAnalysis {
    let home = home();
    // Largest files: find -printf "%s\t%p" then sort. Bounded to HOME, skip hidden caches isn't possible cheaply; we keep all but cap to 20.
    let largest_files = run(
        "find",
        &[
            &home, "-xdev", "-type", "f", "-size", "+50M", "-printf", "%s\t%p\n",
        ],
    )
    .map(|s| parse_find_size(&s))
    .unwrap_or_default();

    // Largest folders: du one level deep.
    let largest_folders = run("du", &["-x", "-b", "--max-depth=1", &home])
        .map(|s| {
            let mut v: Vec<FileEntry> = s
                .lines()
                .filter_map(|l| {
                    let (size, path) = l.split_once('\t')?;
                    let p = path.trim();
                    if p == home {
                        return None;
                    }
                    Some(FileEntry {
                        size_bytes: size.trim().parse().ok()?,
                        path: p.to_string(),
                    })
                })
                .collect();
            v.sort_by_key(|e| std::cmp::Reverse(e.size_bytes));
            v.truncate(15);
            v
        })
        .unwrap_or_default();

    let mut recommendations = Vec::new();
    // Common reclaimable spots.
    for (rel, label) in [
        (".cache", "User cache"),
        (".local/share/Trash", "Trash"),
        (".cache/thumbnails", "Thumbnail cache"),
    ] {
        let path = format!("{home}/{rel}");
        if let Some(sz) = run("du", &["-sb", &path]).and_then(|s| {
            s.split_whitespace()
                .next()
                .and_then(|x| x.parse::<u64>().ok())
        }) {
            if sz > 200 * 1024 * 1024 {
                recommendations.push(f(
                    "info",
                    label,
                    format!("{} reclaimable at {path}", human(sz)),
                    &format!("rm -rf {path}/*"),
                ));
            }
        }
    }
    if has("paccache") {
        recommendations.push(f(
            "info",
            "Package cache",
            "Old package versions can be cleared",
            "sudo paccache -r",
        ));
    }
    if recommendations.is_empty() {
        recommendations.push(f("ok", "Cleanup", "No large reclaimable caches found", ""));
    }

    StorageAnalysis {
        home,
        largest_files,
        largest_folders,
        recommendations,
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

/* ------------------------------ file operations --------------------------- */

/// Guard: only operate inside the user's HOME (never system paths).
fn under_home(path: &str) -> Result<(), String> {
    let h = home();
    let canon = std::fs::canonicalize(path).map_err(|e| format!("{path}: {e}"))?;
    if canon.starts_with(&h) {
        Ok(())
    } else {
        Err("Refusing to operate outside your home directory.".into())
    }
}

/// Delete a file (HOME-scoped). For safety, directories are not removed here.
pub fn delete_path(path: &str) -> Result<String, String> {
    under_home(path)?;
    let meta = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if meta.is_dir() {
        return Err("Refusing to delete a directory from the analyzer.".into());
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok(format!("Deleted {path}"))
}

/// Move/rename a file (source must be HOME-scoped).
pub fn move_path(src: &str, dest: &str) -> Result<String, String> {
    under_home(src)?;
    std::fs::rename(src, dest).map_err(|e| e.to_string())?;
    Ok(format!("Moved to {dest}"))
}

/// Reveal a path in the file manager via xdg-open on its parent directory.
pub fn reveal_path(path: &str) -> Result<String, String> {
    let parent = std::path::Path::new(path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(home);
    Command::new("xdg-open")
        .arg(&parent)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(format!("Opened {parent}"))
}

/* --------------------------------- driver --------------------------------- */

pub fn full_scan(control: &ControlService) -> SystemScan {
    let categories = vec![
        scan_hardware(control),
        scan_storage_health(),
        scan_permissions(control),
        scan_drivers(control),
        scan_startup(),
        scan_services(),
        scan_thermals(control),
        scan_gaming(control),
        scan_containers(control),
        scan_security(),
        scan_power(control),
        scan_maintenance(),
    ];

    // Score: start at 100, subtract for issues.
    let mut score: i32 = 100;
    for c in &categories {
        for fnd in &c.findings {
            score -= match fnd.severity.as_str() {
                "critical" => 12,
                "warning" => 6,
                _ => 0,
            };
        }
    }
    let score = score.clamp(0, 100) as u8;

    SystemScan {
        categories,
        storage: storage_analysis(),
        score,
        generated_ms: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn human_sizes() {
        assert_eq!(human(512), "512.0 B");
        assert!(human(1024 * 1024).contains("MB"));
    }

    #[test]
    fn worst_severity_picks_critical() {
        let fs = vec![
            f("ok", "a", "", ""),
            f("warning", "b", "", ""),
            f("critical", "c", "", ""),
        ];
        assert_eq!(worst(&fs), "critical");
    }

    #[test]
    fn under_home_rejects_etc() {
        // /etc/hostname exists on Linux but is outside HOME.
        assert!(under_home("/etc/hostname").is_err());
    }
}
