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
    /// Finding category so the UI can offer the right actions:
    /// "service" | "journal" | "coredump" | "package" | "".
    pub kind: String,
    /// The systemd unit this finding refers to (drives Restart/Logs/Status).
    pub unit: Option<String>,
    /// True for `--user` units (toggled via `systemctl --user`, no pkexec).
    pub user_scope: bool,
}

fn f(severity: &str, title: &str, detail: impl Into<String>, fix: &str) -> Finding {
    Finding {
        severity: severity.into(),
        title: title.into(),
        detail: detail.into(),
        fix: fix.into(),
        kind: String::new(),
        unit: None,
        user_scope: false,
    }
}

impl Finding {
    fn service(mut self, unit: &str, user_scope: bool) -> Self {
        self.kind = "service".into();
        self.unit = Some(unit.into());
        self.user_scope = user_scope;
        self
    }
    fn kind(mut self, kind: &str) -> Self {
        self.kind = kind.into();
        self
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

/// Human-readable cause for a failed unit from `systemctl show`. Separates a
/// genuine failure from a duplicate-instance / restart-loop (start-limit-hit),
/// which is usually a benign "already running / repeated too quickly" case.
fn unit_cause(unit: &str, user: bool) -> (String, bool) {
    let mut args = vec![
        "show",
        unit,
        "-p",
        "Result",
        "-p",
        "ExecMainStatus",
        "-p",
        "ActiveState",
        "--value",
    ];
    if user {
        args.insert(0, "--user");
    }
    let out = run("systemctl", &args).unwrap_or_default();
    let mut lines = out.lines();
    let result = lines.next().unwrap_or("").trim().to_string();
    let code = lines.next().unwrap_or("").trim().to_string();
    let dup = result == "start-limit-hit";
    let cause = match result.as_str() {
        "exit-code" => format!("Exited with a non-zero status (code {code})."),
        "signal" => "Killed by a signal (likely crashed).".to_string(),
        "timeout" => "Timed out while starting or stopping.".to_string(),
        "start-limit-hit" => "Restarted too many times too quickly (start-limit-hit) — often a duplicate instance or a tight restart loop.".to_string(),
        "oom-kill" => "Killed by the out-of-memory killer.".to_string(),
        "core-dump" => "Crashed and dumped core.".to_string(),
        "" => "Failed (no result reported).".to_string(),
        other => format!("Failed: {other}."),
    };
    (cause, dup)
}

fn scan_failed(user: bool, out: &mut Vec<Finding>) {
    let mut args = vec!["--failed", "--no-legend", "--plain"];
    if user {
        args.insert(0, "--user");
    }
    let Some(failed) = run("systemctl", &args) else {
        return;
    };
    let units: Vec<String> = failed
        .lines()
        .filter_map(|l| l.split_whitespace().next())
        .filter(|s| {
            s.ends_with(".service")
                || s.ends_with(".socket")
                || s.ends_with(".timer")
                || s.ends_with(".mount")
        })
        .map(String::from)
        .collect();
    let label = if user { "user" } else { "system" };
    if units.is_empty() {
        out.push(f(
            "ok",
            &format!("Failed {label} services"),
            format!("No failed {label} units"),
            "",
        ));
        return;
    }
    for unit in units {
        let (cause, dup) = unit_cause(&unit, user);
        // Duplicate-instance / restart-loop is a warning, not a hard failure.
        let sev = if dup { "warning" } else { "critical" };
        let title = if dup {
            format!("{unit} (restart loop)")
        } else {
            unit.clone()
        };
        out.push(
            f(
                sev,
                &title,
                cause,
                &format!(
                    "systemctl {}status {unit}",
                    if user { "--user " } else { "" }
                ),
            )
            .service(&unit, user),
        );
    }
}

fn scan_services() -> ScanCategory {
    let mut out = Vec::new();
    if has("systemctl") {
        scan_failed(false, &mut out);
        scan_failed(true, &mut out);
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

/// Count error entries by emitting unit (or syslog identifier) from
/// `journalctl -o json` and return the top `n` offenders.
fn top_journal_offenders(json: &str, n: usize) -> Vec<(String, usize)> {
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for line in json.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let unit = v
            .get("_SYSTEMD_UNIT")
            .and_then(|x| x.as_str())
            .or_else(|| v.get("SYSLOG_IDENTIFIER").and_then(|x| x.as_str()))
            .or_else(|| v.get("_COMM").and_then(|x| x.as_str()))
            .unwrap_or("unknown")
            .to_string();
        *counts.entry(unit).or_insert(0) += 1;
    }
    let mut v: Vec<(String, usize)> = counts.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v.truncate(n);
    v
}

/// Group `coredumpctl list` output by executable name.
fn group_coredumps(list: &str) -> Vec<(String, usize)> {
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for line in list.lines() {
        if line.starts_with("TIME") || line.trim().is_empty() {
            continue;
        }
        // The EXE column is an absolute path; take its basename.
        if let Some(exe) = line.split_whitespace().find(|t| t.starts_with('/')) {
            let app = exe.rsplit('/').next().unwrap_or(exe).to_string();
            *counts.entry(app).or_insert(0) += 1;
        }
    }
    let mut v: Vec<(String, usize)> = counts.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v
}

/// Journal errors, crash logs, orphan/broken packages, broken symlinks — folded
/// into a "Maintenance" category so the dedicated scans from the spec appear.
fn scan_maintenance() -> ScanCategory {
    let mut out = Vec::new();

    // Journal errors (priority<=3) this boot — surface the TOP OFFENDING units,
    // not just a total count.
    if has("journalctl") {
        let total = run("journalctl", &["-p", "3", "-b", "--no-pager", "-q"])
            .map(|j| j.lines().filter(|l| !l.trim().is_empty()).count())
            .unwrap_or(0);
        if total == 0 {
            out.push(f(
                "ok",
                "Journal errors",
                "No priority-error entries this boot",
                "",
            ));
        } else {
            // Count by emitting unit/identifier via the journal export field.
            let units = run("journalctl", &["-p", "3", "-b", "--no-pager", "-o", "json"])
                .map(|j| top_journal_offenders(&j, 4))
                .unwrap_or_default();
            let detail = if units.is_empty() {
                format!("{total} error-level entr(ies) this boot")
            } else {
                let list = units
                    .iter()
                    .map(|(u, c)| format!("{u} ({c})"))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("{total} this boot — top: {list}")
            };
            out.push(
                f(
                    if total > 40 { "warning" } else { "info" },
                    "Journal errors",
                    detail,
                    "journalctl -p 3 -b",
                )
                .kind("journal"),
            );
        }
    }
    // Crash logs (coredumps) grouped by application.
    if has("coredumpctl") {
        if let Some(c) = run("coredumpctl", &["--no-pager", "list", "--reverse"]) {
            let groups = group_coredumps(&c);
            if groups.is_empty() {
                out.push(f("ok", "Crash logs", "No recorded coredumps", ""));
            } else {
                let total: usize = groups.iter().map(|(_, n)| n).sum();
                let list = groups
                    .iter()
                    .take(5)
                    .map(|(app, n)| format!("{app} ×{n}"))
                    .collect::<Vec<_>>()
                    .join(", ");
                out.push(
                    f(
                        "warning",
                        "Crash logs",
                        format!("{total} coredump(s): {list}"),
                        "coredumpctl info <pid>",
                    )
                    .kind("coredump"),
                );
            }
        }
    }
    // Orphan packages (Arch) — with the names.
    if has("pacman") {
        if let Some(orphans) = run("pacman", &["-Qtdq"]) {
            let names: Vec<&str> = orphans
                .lines()
                .map(str::trim)
                .filter(|l| !l.is_empty())
                .collect();
            out.push(if names.is_empty() {
                f("ok", "Orphan packages", "None", "")
            } else {
                let preview = names.iter().take(6).cloned().collect::<Vec<_>>().join(", ");
                f(
                    "info",
                    "Orphan packages",
                    format!("{}: {preview}", names.len()),
                    "sudo pacman -Rns $(pacman -Qtdq)",
                )
                .kind("package")
            });
        }
        // Broken dependencies — name the affected packages + repair action.
        if let Some(dk) = run("pacman", &["-Dk"]) {
            let affected: Vec<String> = dk
                .lines()
                .filter(|l| {
                    let l = l.to_lowercase();
                    l.contains("missing") || l.contains("error") || l.contains("breaks dependency")
                })
                .filter_map(|l| {
                    l.split(':')
                        .next()
                        .map(|s| s.trim().replace("warning", "").trim().to_string())
                })
                .filter(|s| !s.is_empty())
                .collect();
            if affected.is_empty() {
                out.push(f("ok", "Package dependencies", "Consistent", ""));
            } else {
                let preview = affected
                    .iter()
                    .take(6)
                    .cloned()
                    .collect::<Vec<_>>()
                    .join(", ");
                out.push(
                    f(
                        "warning",
                        "Broken packages",
                        format!("{}: {preview}", affected.len()),
                        "sudo pacman -Syu  (repair: sudo pacman -S <pkg>)",
                    )
                    .kind("package"),
                );
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

/// Doctor service actions. `status`/`logs` are read-only and return text;
/// `restart` runs `systemctl restart` (via pkexec for system units, directly
/// for `--user` units). Nexus never silently escalates.
pub fn service_action(unit: &str, action: &str, user: bool) -> Result<String, String> {
    // Defend against argument injection — a unit name is a single token.
    if unit.is_empty() || unit.split_whitespace().count() != 1 {
        return Err("Invalid unit name.".into());
    }
    let scope: &[&str] = if user { &["--user"] } else { &[] };
    match action {
        "status" => {
            let mut a = scope.to_vec();
            a.extend(["status", unit, "--no-pager", "-l"]);
            let out = Command::new("systemctl")
                .args(&a)
                .output()
                .map_err(|e| e.to_string())?;
            // status exits non-zero for failed units, but stdout still has the report.
            let text = String::from_utf8_lossy(&out.stdout);
            Ok(text.chars().take(8000).collect())
        }
        "logs" => {
            let mut a = scope.to_vec();
            a.extend(["-u", unit, "-n", "200", "--no-pager"]);
            let out = Command::new("journalctl")
                .args(&a)
                .output()
                .map_err(|e| e.to_string())?;
            Ok(String::from_utf8_lossy(&out.stdout)
                .chars()
                .take(12000)
                .collect())
        }
        "restart" => {
            let out = if user {
                Command::new("systemctl")
                    .args(["--user", "restart", unit])
                    .output()
            } else {
                Command::new("pkexec")
                    .args(["systemctl", "restart", unit])
                    .output()
            }
            .map_err(|e| e.to_string())?;
            if out.status.success() {
                Ok(format!("Restarted {unit}."))
            } else {
                let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
                Err(if err.is_empty() {
                    format!("Failed to restart {unit}.")
                } else {
                    err
                })
            }
        }
        other => Err(format!("Unknown service action '{other}'.")),
    }
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
