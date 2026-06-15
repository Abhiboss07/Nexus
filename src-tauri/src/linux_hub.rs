//! Linux Hub — a control center for the whole system, not just one daemon:
//! systemd services, Docker, Flatpak, and a unified Update Center. Every
//! operation is exposed as an async command (spawn_blocking) so nothing blocks
//! the UI; privileged actions go through `pkexec` (polkit) — never a silent sudo.

use serde::Serialize;
use std::process::Command;

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

fn run_status(cmd: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new(cmd)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            format!("{cmd} failed")
        } else {
            err
        })
    }
}

fn has(cmd: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(cmd).is_file()))
        .unwrap_or(false)
}

fn pkexec(args: &[&str]) -> Result<String, String> {
    if !has("pkexec") {
        return Err("pkexec (polkit) is not installed — cannot run privileged actions.".into());
    }
    let out = Command::new("pkexec")
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else if out.status.code() == Some(126) {
        Err("Authorization was dismissed.".into())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            "Command failed.".into()
        } else {
            err
        })
    }
}

/// Validate a unit/container/app identifier: a single token with no shell
/// metacharacters. Unit names, container IDs and flatpak app IDs all qualify;
/// anything with whitespace or injection characters is rejected. Args are passed
/// to commands without a shell, so this is defense-in-depth.
fn safe_token(s: &str) -> Result<&str, String> {
    let t = s.trim();
    if t.is_empty()
        || t.split_whitespace().count() != 1
        || t.contains([';', '&', '|', '`', '$', '\n', '\\'])
    {
        return Err("Invalid identifier.".into());
    }
    Ok(t)
}

/* ------------------------------- Services -------------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ServiceUnit {
    pub name: String,
    pub description: String,
    /// loaded | not-found | masked …
    pub load: String,
    /// active | inactive | failed | activating …
    pub active: String,
    pub sub: String,
    /// enabled | disabled | masked | static | "" (unknown)
    pub enabled: String,
    pub user: bool,
}

fn enabled_map(user: bool) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    let mut args = vec![
        "list-unit-files",
        "--type=service",
        "--no-legend",
        "--no-pager",
        "--plain",
    ];
    if user {
        args.insert(0, "--user");
    }
    if let Some(out) = run("systemctl", &args) {
        for line in out.lines() {
            let mut it = line.split_whitespace();
            if let (Some(unit), Some(state)) = (it.next(), it.next()) {
                map.insert(unit.to_string(), state.to_string());
            }
        }
    }
    map
}

/// List service units for the given scope with state + enabled status.
pub fn list_services(user: bool) -> Vec<ServiceUnit> {
    let enabled = enabled_map(user);
    let mut args = vec![
        "list-units",
        "--type=service",
        "--all",
        "--no-legend",
        "--no-pager",
        "--plain",
    ];
    if user {
        args.insert(0, "--user");
    }
    let out = run("systemctl", &args).unwrap_or_default();
    let mut units: Vec<ServiceUnit> = out
        .lines()
        .filter_map(|line| {
            // UNIT LOAD ACTIVE SUB DESCRIPTION (DESCRIPTION may contain spaces)
            let mut it = line.split_whitespace();
            let name = it.next()?.to_string();
            if !name.ends_with(".service") {
                return None;
            }
            let load = it.next()?.to_string();
            let active = it.next()?.to_string();
            let sub = it.next()?.to_string();
            let description = it.collect::<Vec<_>>().join(" ");
            let en = enabled.get(&name).cloned().unwrap_or_default();
            Some(ServiceUnit {
                enabled: en,
                name,
                description,
                load,
                active,
                sub,
                user,
            })
        })
        .collect();
    // Failed/active first, then by name; bound the list.
    units.sort_by(|a, b| {
        let rank = |u: &ServiceUnit| match u.active.as_str() {
            "failed" => 0,
            "activating" => 1,
            "active" => 2,
            _ => 3,
        };
        rank(a).cmp(&rank(b)).then(a.name.cmp(&b.name))
    });
    units.truncate(400);
    units
}

/// Service action: start|stop|restart|enable|disable|mask|unmask|status|logs.
/// System-scope mutations go through pkexec; user-scope and reads run directly.
pub fn service_control(name: &str, action: &str, user: bool) -> Result<String, String> {
    let unit = safe_token(name)?;
    let scope: &[&str] = if user { &["--user"] } else { &[] };
    match action {
        "status" => {
            let mut a = scope.to_vec();
            a.extend(["status", unit, "--no-pager", "-l"]);
            Ok(run("systemctl", &a)
                .unwrap_or_default()
                .chars()
                .take(8000)
                .collect())
        }
        "logs" => {
            let mut a = scope.to_vec();
            a.extend(["-u", unit, "-n", "200", "--no-pager"]);
            Ok(run("journalctl", &a)
                .unwrap_or_default()
                .chars()
                .take(12000)
                .collect())
        }
        "start" | "stop" | "restart" | "enable" | "disable" | "mask" | "unmask" => {
            if user {
                run_status("systemctl", &["--user", action, unit])
                    .map(|_| format!("{action} {unit} ✓"))
            } else {
                pkexec(&["systemctl", action, unit]).map(|_| format!("{action} {unit} ✓"))
            }
        }
        other => Err(format!("Unknown service action '{other}'.")),
    }
}

/* -------------------------------- Docker --------------------------------- */

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DockerContainer {
    pub id: String,
    pub name: String,
    pub image: String,
    pub state: String,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DockerImage {
    pub id: String,
    pub repo: String,
    pub tag: String,
    pub size: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DockerVolume {
    pub name: String,
    pub driver: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DockerOverview {
    pub available: bool,
    pub running: bool,
    pub containers: Vec<DockerContainer>,
    pub images: Vec<DockerImage>,
    pub volumes: Vec<DockerVolume>,
}

fn json_field(v: &serde_json::Value, key: &str) -> String {
    v.get(key)
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string()
}

pub fn docker_overview() -> DockerOverview {
    if !has("docker") {
        return DockerOverview::default();
    }
    let running = run("docker", &["info", "--format", "{{.ServerVersion}}"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    if !running {
        return DockerOverview {
            available: true,
            running: false,
            ..Default::default()
        };
    }
    let parse = |out: String| -> Vec<serde_json::Value> {
        out.lines()
            .filter_map(|l| serde_json::from_str(l).ok())
            .collect()
    };
    let containers =
        parse(run("docker", &["ps", "-a", "--format", "{{json .}}"]).unwrap_or_default())
            .iter()
            .map(|v| DockerContainer {
                id: json_field(v, "ID"),
                name: json_field(v, "Names"),
                image: json_field(v, "Image"),
                state: json_field(v, "State"),
                status: json_field(v, "Status"),
            })
            .collect();
    let images = parse(run("docker", &["images", "--format", "{{json .}}"]).unwrap_or_default())
        .iter()
        .map(|v| DockerImage {
            id: json_field(v, "ID"),
            repo: json_field(v, "Repository"),
            tag: json_field(v, "Tag"),
            size: json_field(v, "Size"),
        })
        .collect();
    let volumes =
        parse(run("docker", &["volume", "ls", "--format", "{{json .}}"]).unwrap_or_default())
            .iter()
            .map(|v| DockerVolume {
                name: json_field(v, "Name"),
                driver: json_field(v, "Driver"),
            })
            .collect();
    DockerOverview {
        available: true,
        running: true,
        containers,
        images,
        volumes,
    }
}

/// Docker action. kind: container|image|volume. action: start|stop|restart|remove|logs.
pub fn docker_action(kind: &str, id: &str, action: &str) -> Result<String, String> {
    let id = safe_token(id)?;
    let argv: Vec<&str> = match (kind, action) {
        ("container", "start" | "stop" | "restart") => vec![kind, action, id],
        ("container", "remove") => vec!["rm", "-f", id],
        ("container", "logs") => {
            return Ok(run("docker", &["logs", "--tail", "200", id])
                .unwrap_or_default()
                .chars()
                .take(12000)
                .collect());
        }
        ("image", "remove") => vec!["rmi", "-f", id],
        ("volume", "remove") => vec!["volume", "rm", "-f", id],
        _ => {
            return Err(format!(
                "Unsupported docker action '{action}' for '{kind}'."
            ))
        }
    };
    run_status("docker", &argv).map(|_| format!("{kind} {action} ✓"))
}

/* -------------------------------- Flatpak -------------------------------- */

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FlatpakApp {
    pub id: String,
    pub name: String,
    pub version: String,
    pub size: String,
    pub has_update: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FlatpakOverview {
    pub available: bool,
    pub apps: Vec<FlatpakApp>,
    pub runtimes: usize,
    pub unused_runtimes: Vec<String>,
    pub updates: usize,
}

pub fn flatpak_overview() -> FlatpakOverview {
    if !has("flatpak") {
        return FlatpakOverview::default();
    }
    let updates: std::collections::HashSet<String> = run(
        "flatpak",
        &["remote-ls", "--updates", "--app", "--columns=application"],
    )
    .map(|s| {
        s.lines()
            .map(|l| l.trim().to_string())
            .filter(|l| !l.is_empty())
            .collect()
    })
    .unwrap_or_default();
    let apps: Vec<FlatpakApp> = run(
        "flatpak",
        &["list", "--app", "--columns=application,name,version,size"],
    )
    .map(|s| {
        s.lines()
            .filter_map(|l| {
                let cols: Vec<&str> = l.split('\t').collect();
                let id = cols.first()?.trim().to_string();
                if id.is_empty() {
                    return None;
                }
                Some(FlatpakApp {
                    has_update: updates.contains(&id),
                    name: cols.get(1).unwrap_or(&"").trim().to_string(),
                    version: cols.get(2).unwrap_or(&"").trim().to_string(),
                    size: cols.get(3).unwrap_or(&"").trim().to_string(),
                    id,
                })
            })
            .collect()
    })
    .unwrap_or_default();
    let runtimes = run("flatpak", &["list", "--runtime", "--columns=application"])
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0);
    let unused_runtimes = run("flatpak", &["list", "--runtime", "--columns=application"])
        .map(|_| Vec::<String>::new())
        .unwrap_or_default(); // `flatpak uninstall --unused` reports them at action time
    FlatpakOverview {
        available: true,
        apps,
        runtimes,
        unused_runtimes,
        updates: updates.len(),
    }
}

/// Flatpak action: update | remove (per app id), or clean (remove unused runtimes).
pub fn flatpak_action(id: &str, action: &str) -> Result<String, String> {
    match action {
        "clean" => run_status(
            "flatpak",
            &["uninstall", "--unused", "-y", "--noninteractive"],
        )
        .map(|o| {
            if o.is_empty() {
                "No unused runtimes.".into()
            } else {
                o
            }
        }),
        "update" => {
            let id = safe_token(id)?;
            run_status("flatpak", &["update", "-y", "--noninteractive", id])
                .map(|_| format!("Updated {id} ✓"))
        }
        "remove" => {
            let id = safe_token(id)?;
            run_status("flatpak", &["uninstall", "-y", "--noninteractive", id])
                .map(|_| format!("Removed {id} ✓"))
        }
        other => Err(format!("Unknown flatpak action '{other}'.")),
    }
}

/* ------------------------------ Update Center ---------------------------- */

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCounts {
    pub pacman: usize,
    pub aur: usize,
    pub flatpak: usize,
    /// AUR helper detected (paru/yay), or "".
    pub aur_helper: String,
    pub pacman_supported: bool,
    pub flatpak_supported: bool,
}

pub fn update_counts() -> UpdateCounts {
    let pacman_supported = has("pacman");
    // `checkupdates` (pacman-contrib) queries a temp DB without root.
    let pacman = if has("checkupdates") {
        run("checkupdates", &[])
            .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
            .unwrap_or(0)
    } else {
        0
    };
    let (aur, aur_helper) = if has("paru") {
        (
            run("paru", &["-Qua"])
                .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
                .unwrap_or(0),
            "paru".to_string(),
        )
    } else if has("yay") {
        (
            run("yay", &["-Qua"])
                .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
                .unwrap_or(0),
            "yay".to_string(),
        )
    } else {
        (0, String::new())
    };
    let flatpak_supported = has("flatpak");
    let flatpak = if flatpak_supported {
        run(
            "flatpak",
            &["remote-ls", "--updates", "--app", "--columns=application"],
        )
        .map(|s| s.lines().filter(|l| !l.trim().is_empty()).count())
        .unwrap_or(0)
    } else {
        0
    };
    UpdateCounts {
        pacman,
        aur,
        flatpak,
        aur_helper,
        pacman_supported,
        flatpak_supported,
    }
}

/// Update sources. target: pacman | flatpak. pacman is privileged (pkexec);
/// flatpak updates at user level. AUR isn't auto-run (an interactive helper).
pub fn update_run(target: &str) -> Result<String, String> {
    match target {
        "pacman" => {
            pkexec(&["pacman", "-Syu", "--noconfirm"]).map(|_| "System packages updated.".into())
        }
        "flatpak" => run_status("flatpak", &["update", "-y", "--noninteractive"])
            .map(|_| "Flatpaks updated.".into()),
        other => Err(format!("Unknown update target '{other}'.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_token_rejects_spaces() {
        assert!(safe_token("a b").is_err());
        assert!(safe_token("").is_err());
        assert!(safe_token("docker.service").is_ok());
        assert!(safe_token("com.usebottles.bottles").is_ok());
    }

    #[test]
    fn list_services_is_well_formed() {
        // On a Linux host with systemd this returns rows; on CI without it, empty.
        for s in list_services(false) {
            assert!(s.name.ends_with(".service"));
        }
    }

    #[test]
    fn update_counts_never_panics() {
        let _ = update_counts();
    }

    #[test]
    fn unknown_actions_error() {
        assert!(service_control("x.service", "frobnicate", true).is_err());
        assert!(docker_action("container", "abc", "frobnicate").is_err());
        assert!(flatpak_action("x", "frobnicate").is_err());
        assert!(update_run("npm").is_err());
    }
}
