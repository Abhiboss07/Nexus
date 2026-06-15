//! System ecosystem detection. Discovers the Linux gaming / hardware / container
//! / development / AI tooling installed on the machine so Nexus can reason about
//! — and surface — what's actually available. Pure discovery: presence via
//! `$PATH`, flatpak app ids, service/socket files, well-known config dirs, and
//! session env. Version strings are best-effort and only probed for tools that
//! are present. Nothing is ever faked as "installed".

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
    /// Documentation / homepage URL.
    pub doc_url: String,
    /// Flatpak app id when the tool can be installed one-click (user-level), else "".
    pub flatpak_id: String,
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

fn dir_exists(rel: &str) -> bool {
    std::path::Path::new(&format!("{}/{rel}", home())).exists()
}

fn service_exists(name: &str) -> bool {
    [
        "/usr/lib/systemd/system",
        "/etc/systemd/system",
        "/run/systemd/system",
    ]
    .iter()
    .any(|d| std::path::Path::new(&format!("{d}/{name}")).exists())
}

/// Is a TCP port open on localhost? Best-effort, short timeout. Used to detect
/// locally running daemons (Ollama 11434, Open WebUI 8080, LM Studio 1234).
fn port_open(port: u16) -> bool {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::Duration;
    let Ok(mut addrs) = (format!("127.0.0.1:{port}")).to_socket_addrs() else {
        return false;
    };
    addrs.any(|a| TcpStream::connect_timeout(&a, Duration::from_millis(120)).is_ok())
}

#[allow(clippy::too_many_arguments)]
fn entry(
    id: &str,
    name: &str,
    category: &str,
    detected: bool,
    detail: String,
    hint: &str,
    doc_url: &str,
    flatpak_id: &str,
) -> Integration {
    Integration {
        id: id.into(),
        name: name.into(),
        category: category.into(),
        detected,
        detail: if detected { detail } else { String::new() },
        hint: hint.into(),
        doc_url: doc_url.into(),
        flatpak_id: flatpak_id.into(),
    }
}

/// Spec for a straightforward "binary on PATH (or flatpak) → present" tool.
struct ToolSpec<'a> {
    id: &'a str,
    name: &'a str,
    category: &'a str,
    bins: &'a [&'a str],
    ver: Option<(&'a str, &'a [&'a str])>,
    flatpak_id: Option<&'a str>,
    hint: &'a str,
    doc_url: &'a str,
}

fn tool(spec: ToolSpec, flatpaks: &HashSet<String>) -> Integration {
    let fid = spec.flatpak_id.unwrap_or("");
    let bin = spec
        .bins
        .iter()
        .find_map(|b| which(b).map(|p| (b.to_string(), p)));
    if let Some((b, path)) = bin {
        let detail = spec
            .ver
            .and_then(|(vbin, vargs)| version(vbin, vargs))
            .unwrap_or_else(|| path.clone());
        let detail = if detail == path {
            format!("{b} · {path}")
        } else {
            detail
        };
        return entry(
            spec.id,
            spec.name,
            spec.category,
            true,
            detail,
            spec.hint,
            spec.doc_url,
            fid,
        );
    }
    if let Some(f) = spec.flatpak_id {
        if flatpaks.contains(f) {
            return entry(
                spec.id,
                spec.name,
                spec.category,
                true,
                format!("flatpak · {f}"),
                spec.hint,
                spec.doc_url,
                fid,
            );
        }
    }
    entry(
        spec.id,
        spec.name,
        spec.category,
        false,
        String::new(),
        spec.hint,
        spec.doc_url,
        fid,
    )
}

pub fn detect_all() -> Vec<Integration> {
    let fp = flatpak_apps();
    let mut out = Vec::new();
    macro_rules! t {
        ($id:expr, $name:expr, $cat:expr, $bins:expr, $ver:expr, $fpid:expr, $hint:expr, $doc:expr) => {
            out.push(tool(
                ToolSpec {
                    id: $id,
                    name: $name,
                    category: $cat,
                    bins: $bins,
                    ver: $ver,
                    flatpak_id: $fpid,
                    hint: $hint,
                    doc_url: $doc,
                },
                &fp,
            ))
        };
    }

    // ---- Gaming tools ----
    t!(
        "mangohud",
        "MangoHud",
        "gaming",
        &["mangohud"],
        Some(("mangohud", &["--version"][..])),
        Some("org.freedesktop.Platform.VulkanLayer.MangoHud"),
        "sudo pacman -S mangohud",
        "https://github.com/flightlessmango/MangoHud"
    );
    t!(
        "gamescope",
        "Gamescope",
        "gaming",
        &["gamescope"],
        Some(("gamescope", &["--version"][..])),
        None,
        "sudo pacman -S gamescope",
        "https://github.com/ValveSoftware/gamescope"
    );
    t!(
        "gamemode",
        "GameMode",
        "gaming",
        &["gamemoderun", "gamemoded"],
        Some(("gamemoded", &["-v"][..])),
        None,
        "sudo pacman -S gamemode",
        "https://github.com/FeralInteractive/gamemode"
    );

    // ---- Hardware control ----
    t!(
        "openrgb",
        "OpenRGB",
        "hardware",
        &["openrgb"],
        Some(("openrgb", &["--version"][..])),
        Some("org.openrgb.OpenRGB"),
        "sudo pacman -S openrgb",
        "https://openrgb.org"
    );
    {
        let detected = which("coolercontrold").is_some()
            || which("coolercontrol").is_some()
            || service_exists("coolercontrold.service");
        out.push(entry(
            "coolercontrol",
            "CoolerControl",
            "hardware",
            detected,
            which("coolercontrold")
                .or_else(|| which("coolercontrol"))
                .map(|p| format!("daemon · {p}"))
                .unwrap_or_else(|| "service present".into()),
            "yay -S coolercontrol",
            "https://gitlab.com/coolercontrol/coolercontrol",
            "",
        ));
    }
    {
        let detected =
            which("lact").is_some() || which("lactd").is_some() || service_exists("lactd.service");
        out.push(entry(
            "lact",
            "LACT",
            "hardware",
            detected,
            which("lactd")
                .or_else(|| which("lact"))
                .map(|p| format!("· {p}"))
                .unwrap_or_else(|| "service present".into()),
            "yay -S lact",
            "https://github.com/ilya-zlobintsev/LACT",
            "",
        ));
    }

    // ---- Game launchers ----
    t!(
        "steam",
        "Steam",
        "launchers",
        &["steam"],
        None,
        Some("com.valvesoftware.Steam"),
        "sudo pacman -S steam",
        "https://store.steampowered.com"
    );
    t!(
        "lutris",
        "Lutris",
        "launchers",
        &["lutris"],
        Some(("lutris", &["--version"][..])),
        Some("net.lutris.Lutris"),
        "sudo pacman -S lutris",
        "https://lutris.net"
    );
    {
        let detected = which("heroic").is_some()
            || fp.contains("com.heroicgameslauncher.hgl")
            || dir_exists(".config/heroic");
        out.push(entry(
            "heroic",
            "Heroic",
            "launchers",
            detected,
            "installed".into(),
            "flatpak install flathub com.heroicgameslauncher.hgl",
            "https://heroicgameslauncher.com",
            "com.heroicgameslauncher.hgl",
        ));
    }
    t!(
        "bottles",
        "Bottles",
        "launchers",
        &["bottles"],
        None,
        Some("com.usebottles.bottles"),
        "flatpak install flathub com.usebottles.bottles",
        "https://usebottles.com"
    );

    // ---- Containers & packaging ----
    {
        let present = which("docker").is_some();
        let running = std::path::Path::new("/run/docker.sock").exists()
            || std::path::Path::new("/var/run/docker.sock").exists();
        let detail = match (present, running) {
            (true, true) => version("docker", &["--version"])
                .map(|v| format!("{v} · running"))
                .unwrap_or_else(|| "running".into()),
            (true, false) => version("docker", &["--version"])
                .map(|v| format!("{v} · stopped"))
                .unwrap_or_else(|| "installed (stopped)".into()),
            _ => String::new(),
        };
        out.push(entry(
            "docker",
            "Docker",
            "containers",
            present,
            detail,
            "sudo pacman -S docker && sudo systemctl enable --now docker",
            "https://docs.docker.com",
            "",
        ));
    }
    t!(
        "podman",
        "Podman",
        "containers",
        &["podman"],
        Some(("podman", &["--version"][..])),
        None,
        "sudo pacman -S podman",
        "https://podman.io"
    );
    {
        let present = which("flatpak").is_some();
        let detail = if present {
            let v = version("flatpak", &["--version"]).unwrap_or_default();
            format!("{v} · {} apps", fp.len())
        } else {
            String::new()
        };
        out.push(entry(
            "flatpak",
            "Flatpak",
            "containers",
            present,
            detail,
            "sudo pacman -S flatpak",
            "https://flatpak.org",
            "",
        ));
    }
    t!(
        "snap",
        "Snap",
        "containers",
        &["snap"],
        Some(("snap", &["--version"][..])),
        None,
        "yay -S snapd",
        "https://snapcraft.io"
    );
    {
        let detected = which("nvidia-ctk").is_some()
            || which("nvidia-container-runtime").is_some()
            || which("nvidia-container-toolkit").is_some();
        out.push(entry(
            "nvidia-container-toolkit",
            "NVIDIA Container Toolkit",
            "containers",
            detected,
            which("nvidia-ctk")
                .or_else(|| which("nvidia-container-runtime"))
                .map(|p| format!("· {p}"))
                .unwrap_or_default(),
            "sudo pacman -S nvidia-container-toolkit",
            "https://github.com/NVIDIA/nvidia-container-toolkit",
            "",
        ));
    }

    // ---- Development ----
    t!(
        "vscode",
        "VS Code",
        "development",
        &["code", "code-oss", "codium"],
        Some(("code", &["--version"][..])),
        Some("com.visualstudio.code"),
        "yay -S visual-studio-code-bin",
        "https://code.visualstudio.com"
    );
    {
        // Cursor ships as an AppImage / bin; check PATH + common install spots.
        let detected = which("cursor").is_some()
            || dir_exists(".local/share/applications/cursor.desktop")
            || std::path::Path::new("/opt/cursor.appimage").exists();
        out.push(entry(
            "cursor",
            "Cursor",
            "development",
            detected,
            which("cursor")
                .map(|p| format!("· {p}"))
                .unwrap_or_else(|| "installed".into()),
            "yay -S cursor-bin",
            "https://cursor.com",
            "",
        ));
    }
    {
        // JetBrains: Toolbox or any installed IDE launcher.
        let bins = [
            "idea",
            "pycharm",
            "clion",
            "rustrover",
            "goland",
            "webstorm",
            "rider",
            "phpstorm",
            "jetbrains-toolbox",
        ];
        let found = bins.iter().find_map(|b| which(b));
        let detected = found.is_some()
            || dir_exists(".local/share/JetBrains")
            || dir_exists(".config/JetBrains");
        out.push(entry(
            "jetbrains",
            "JetBrains IDEs",
            "development",
            detected,
            found
                .map(|p| format!("· {p}"))
                .unwrap_or_else(|| "toolbox/config present".into()),
            "yay -S jetbrains-toolbox",
            "https://jetbrains.com",
            "",
        ));
    }
    t!(
        "git",
        "Git",
        "development",
        &["git"],
        Some(("git", &["--version"][..])),
        None,
        "sudo pacman -S git",
        "https://git-scm.com"
    );

    // ---- AI / local inference ----
    {
        let present = which("ollama").is_some();
        let running = port_open(11434);
        let detail = match (present, running) {
            (true, true) => version("ollama", &["--version"])
                .map(|v| format!("{v} · serving :11434"))
                .unwrap_or_else(|| "serving :11434".into()),
            (true, false) => version("ollama", &["--version"])
                .map(|v| format!("{v} · stopped"))
                .unwrap_or_else(|| "installed".into()),
            (false, true) => "API responding on :11434".into(),
            _ => String::new(),
        };
        out.push(entry(
            "ollama",
            "Ollama",
            "ai",
            present || running,
            detail,
            "curl -fsSL https://ollama.com/install.sh | sh",
            "https://ollama.com",
            "",
        ));
    }
    {
        // LM Studio: AppImage / desktop app; also exposes an OpenAI-compatible API on :1234.
        let present = which("lm-studio").is_some()
            || which("lmstudio").is_some()
            || dir_exists(".local/share/applications/LM-Studio.desktop")
            || dir_exists(".cache/lm-studio");
        let running = port_open(1234);
        let detail = if running {
            "API responding on :1234".into()
        } else if present {
            "installed".into()
        } else {
            String::new()
        };
        out.push(entry(
            "lmstudio",
            "LM Studio",
            "ai",
            present || running,
            detail,
            "Download the AppImage from lmstudio.ai",
            "https://lmstudio.ai",
            "",
        ));
    }
    {
        let on_path = which("open-webui");
        let installed =
            on_path.is_some() || dir_exists(".config/open-webui") || dir_exists(".open-webui");
        let detail = if let Some(p) = &on_path {
            format!("· {p}")
        } else if installed {
            "config present".into()
        } else {
            String::new()
        };
        out.push(entry(
            "open-webui",
            "Open WebUI",
            "ai",
            installed,
            detail,
            "pip install open-webui  # or run via Docker",
            "https://openwebui.com",
            "",
        ));
    }

    // ---- System / display ----
    {
        let session = std::env::var("XDG_SESSION_TYPE").unwrap_or_default();
        let wayland =
            session.eq_ignore_ascii_case("wayland") || std::env::var("WAYLAND_DISPLAY").is_ok();
        let xorg = session.eq_ignore_ascii_case("x11");
        let xwayland = std::env::var("DISPLAY").is_ok();
        let detail = if wayland {
            if xwayland {
                "Wayland (XWayland available)".into()
            } else {
                "Wayland".into()
            }
        } else if xorg || xwayland {
            "X11".into()
        } else {
            "unknown".into()
        };
        out.push(entry(
            "display-server",
            "Display Server",
            "system",
            wayland || xorg || xwayland,
            detail,
            "",
            "",
            "",
        ));
    }

    out
}

/// One-click install for flatpak-capable integrations (user-level, no sudo).
/// Returns the install log on success. Non-flatpak tools return an error telling
/// the caller to use the provided package-manager command instead — Nexus never
/// silently runs `sudo`.
pub fn install_integration(flatpak_id: &str) -> Result<String, String> {
    if flatpak_id.is_empty() {
        return Err(
            "This tool has no one-click installer — use the package-manager command shown.".into(),
        );
    }
    if which("flatpak").is_none() {
        return Err("Flatpak is not installed. Install it first: sudo pacman -S flatpak".into());
    }
    let out = std::process::Command::new("flatpak")
        .args([
            "install",
            "-y",
            "--user",
            "--noninteractive",
            "flathub",
            flatpak_id,
        ])
        .output()
        .map_err(|e| format!("Failed to launch flatpak: {e}"))?;
    if out.status.success() {
        Ok(format!("Installed {flatpak_id} via Flatpak."))
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}
