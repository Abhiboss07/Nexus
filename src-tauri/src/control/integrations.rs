//! System ecosystem detection (Phase 4.5). Discovers the Linux gaming /
//! hardware / container tooling installed on the machine so Nexus can reason
//! about — and surface — what's actually available. Pure discovery: presence
//! via `$PATH`, flatpak app ids, service/socket files, and session env; version
//! strings are best-effort and only probed for tools that are present.

use std::collections::HashSet;

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Integration {
    pub id: String,
    pub name: String,
    pub category: String,
    pub detected: bool,
    /// Version / status / path when present, else empty.
    pub detail: String,
    /// Install hint shown when missing (Arch/CachyOS-flavored).
    pub hint: String,
}

fn which(bin: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path)
        .map(|d| d.join(bin))
        .find(|p| p.is_file())
        .map(|p| p.to_string_lossy().to_string())
}

fn version(bin: &str, args: &[&str]) -> Option<String> {
    let out = std::process::Command::new(bin).args(args).output().ok()?;
    let text = if !out.stdout.is_empty() {
        String::from_utf8_lossy(&out.stdout)
    } else {
        String::from_utf8_lossy(&out.stderr)
    };
    let line = text.lines().next()?.trim();
    if line.is_empty() {
        return None;
    }
    Some(line.chars().take(48).collect())
}

fn flatpak_apps() -> HashSet<String> {
    let mut set = HashSet::new();
    if which("flatpak").is_some() {
        if let Ok(out) = std::process::Command::new("flatpak")
            .args(["list", "--app", "--columns=application"])
            .output()
        {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let id = line.trim();
                if !id.is_empty() {
                    set.insert(id.to_string());
                }
            }
        }
    }
    set
}

fn home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/root".into())
}

fn service_exists(name: &str) -> bool {
    ["/usr/lib/systemd/system", "/etc/systemd/system", "/run/systemd/system"]
        .iter()
        .any(|d| std::path::Path::new(&format!("{d}/{name}")).exists())
}

fn entry(
    id: &str,
    name: &str,
    category: &str,
    detected: bool,
    detail: String,
    hint: &str,
) -> Integration {
    Integration {
        id: id.into(),
        name: name.into(),
        category: category.into(),
        detected,
        detail: if detected { detail } else { String::new() },
        hint: hint.into(),
    }
}

/// Convenience: detect a binary, optionally read its version, with a flatpak id
/// and install hint fallback.
fn tool(
    id: &str,
    name: &str,
    category: &str,
    bins: &[&str],
    ver: Option<(&str, &[&str])>,
    flatpak_id: Option<&str>,
    flatpaks: &HashSet<String>,
    hint: &str,
) -> Integration {
    let bin = bins.iter().find_map(|b| which(b).map(|p| (b.to_string(), p)));
    if let Some((b, path)) = bin {
        let detail = ver
            .and_then(|(vbin, vargs)| version(vbin, vargs))
            .unwrap_or(path.clone());
        // If we got a path back as "version", prefer the binary name + path.
        let detail = if detail == path { format!("{b} · {path}") } else { detail };
        return entry(id, name, category, true, detail, hint);
    }
    if let Some(fid) = flatpak_id {
        if flatpaks.contains(fid) {
            return entry(id, name, category, true, format!("flatpak · {fid}"), hint);
        }
    }
    entry(id, name, category, false, String::new(), hint)
}

pub fn detect_all() -> Vec<Integration> {
    let fp = flatpak_apps();
    let mut out = Vec::new();

    // ---- Gaming tools ----
    out.push(tool("mangohud", "MangoHud", "gaming", &["mangohud"], Some(("mangohud", &["--version"])), Some("org.freedesktop.Platform.VulkanLayer.MangoHud"), &fp, "sudo pacman -S mangohud"));
    out.push(tool("gamescope", "Gamescope", "gaming", &["gamescope"], Some(("gamescope", &["--version"])), None, &fp, "sudo pacman -S gamescope"));
    out.push(tool("gamemode", "GameMode", "gaming", &["gamemoderun", "gamemoded"], Some(("gamemoded", &["-v"])), None, &fp, "sudo pacman -S gamemode"));

    // ---- Hardware control ----
    out.push(tool("openrgb", "OpenRGB", "hardware", &["openrgb"], Some(("openrgb", &["--version"])), Some("org.openrgb.OpenRGB"), &fp, "sudo pacman -S openrgb"));
    {
        let detected = which("coolercontrold").is_some() || which("coolercontrol").is_some() || service_exists("coolercontrold.service");
        out.push(entry("coolercontrol", "CoolerControl", "hardware", detected,
            which("coolercontrold").or_else(|| which("coolercontrol")).map(|p| format!("daemon · {p}")).unwrap_or_else(|| "service present".into()),
            "yay -S coolercontrol"));
    }
    {
        let detected = which("lact").is_some() || which("lactd").is_some() || service_exists("lactd.service");
        out.push(entry("lact", "LACT", "hardware", detected,
            which("lactd").or_else(|| which("lact")).map(|p| format!("· {p}")).unwrap_or_else(|| "service present".into()),
            "yay -S lact"));
    }

    // ---- Game launchers ----
    out.push(tool("steam", "Steam", "launchers", &["steam"], None, Some("com.valvesoftware.Steam"), &fp, "sudo pacman -S steam"));
    out.push(tool("lutris", "Lutris", "launchers", &["lutris"], Some(("lutris", &["--version"])), Some("net.lutris.Lutris"), &fp, "sudo pacman -S lutris"));
    {
        let detected = which("heroic").is_some() || fp.contains("com.heroicgameslauncher.hgl") || std::path::Path::new(&format!("{}/.config/heroic", home())).exists();
        out.push(entry("heroic", "Heroic", "launchers", detected, "installed".into(), "flatpak install flathub com.heroicgameslauncher.hgl"));
    }
    out.push(tool("bottles", "Bottles", "launchers", &["bottles"], None, Some("com.usebottles.bottles"), &fp, "flatpak install flathub com.usebottles.bottles"));

    // ---- Containers & packaging ----
    {
        let present = which("docker").is_some();
        let running = std::path::Path::new("/run/docker.sock").exists() || std::path::Path::new("/var/run/docker.sock").exists();
        let detail = match (present, running) {
            (true, true) => version("docker", &["--version"]).map(|v| format!("{v} · running")).unwrap_or_else(|| "running".into()),
            (true, false) => version("docker", &["--version"]).map(|v| format!("{v} · stopped")).unwrap_or_else(|| "installed (stopped)".into()),
            _ => String::new(),
        };
        out.push(entry("docker", "Docker", "containers", present, detail, "sudo pacman -S docker && sudo systemctl enable --now docker"));
    }
    out.push(tool("podman", "Podman", "containers", &["podman"], Some(("podman", &["--version"])), None, &fp, "sudo pacman -S podman"));
    {
        let present = which("flatpak").is_some();
        let detail = if present {
            let v = version("flatpak", &["--version"]).unwrap_or_default();
            format!("{v} · {} apps", fp.len())
        } else {
            String::new()
        };
        out.push(entry("flatpak", "Flatpak", "containers", present, detail, "sudo pacman -S flatpak"));
    }
    out.push(tool("snap", "Snap", "containers", &["snap"], Some(("snap", &["--version"])), None, &fp, "yay -S snapd"));
    {
        let detected = which("nvidia-ctk").is_some()
            || which("nvidia-container-runtime").is_some()
            || which("nvidia-container-toolkit").is_some();
        out.push(entry("nvidia-container-toolkit", "NVIDIA Container Toolkit", "containers", detected,
            which("nvidia-ctk").or_else(|| which("nvidia-container-runtime")).map(|p| format!("· {p}")).unwrap_or_default(),
            "sudo pacman -S nvidia-container-toolkit"));
    }

    // ---- System / display ----
    {
        let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        let wayland = session.eq_ignore_ascii_case("wayland") || std::env::var("WAYLAND_DISPLAY").is_ok();
        let xorg = session.eq_ignore_ascii_case("x11");
        let xwayland = std::env::var("DISPLAY").is_ok();
        let detail = if wayland {
            if xwayland { "Wayland (XWayland available)".into() } else { "Wayland".into() }
        } else if xorg {
            "X11".into()
        } else if xwayland {
            "X11".into()
        } else {
            "unknown".into()
        };
        out.push(entry("display-server", "Display Server", "system", wayland || xorg || xwayland, detail, ""));
    }

    out
}
