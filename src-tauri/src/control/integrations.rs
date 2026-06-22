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
    /// How it was detected: "path" | "flatpak" | "package" | "desktop" | "".
    /// Drives the Open/Uninstall affordances (only flatpak installs are managed).
    pub source: String,
}

impl Integration {
    fn source(mut self, s: &str) -> Self {
        self.source = s.into();
        self
    }
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
        source: String::new(),
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

/// Everything a single detection pass needs, built once. A tool is "installed"
/// if ANY signal fires — never relying on one source (which is why a GUI/AppImage
/// install that isn't on `$PATH` used to show as missing).
struct DetectCtx {
    flatpaks: HashSet<String>,
    /// Lowercased `.desktop` basenames across system + user + flatpak exports.
    desktops: HashSet<String>,
    /// Lowercased installed package names (pacman; empty on non-Arch).
    packages: HashSet<String>,
}

/// Lowercased basenames (sans `.desktop`) of every installed desktop entry —
/// catches GUI/AppImage/manual installs that put no binary on `$PATH`.
fn desktop_files() -> HashSet<String> {
    let h = home();
    let dirs = [
        "/usr/share/applications".to_string(),
        "/usr/local/share/applications".to_string(),
        "/var/lib/flatpak/exports/share/applications".to_string(),
        format!("{h}/.local/share/applications"),
        format!("{h}/.local/share/flatpak/exports/share/applications"),
    ];
    let mut set = HashSet::new();
    for d in dirs {
        if let Ok(rd) = std::fs::read_dir(&d) {
            for e in rd.flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if let Some(base) = name.strip_suffix(".desktop") {
                    set.insert(base.to_lowercase());
                }
            }
        }
    }
    set
}

/// All installed pacman package names (one subprocess; empty on non-Arch).
fn pacman_packages() -> HashSet<String> {
    let mut set = HashSet::new();
    if which("pacman").is_some() {
        if let Ok(out) = std::process::Command::new("pacman").arg("-Qq").output() {
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                let p = line.trim();
                if !p.is_empty() {
                    set.insert(p.to_lowercase());
                }
            }
        }
    }
    set
}

/// Desktop-entry / package name candidates derived from a tool's ids.
fn name_candidates(spec: &ToolSpec) -> Vec<String> {
    let mut v: Vec<String> = spec.bins.iter().map(|b| b.to_lowercase()).collect();
    if let Some(f) = spec.flatpak_id {
        v.push(f.to_lowercase());
        if let Some(seg) = f.rsplit('.').next() {
            v.push(seg.to_lowercase());
        }
    }
    v
}

fn tool(spec: ToolSpec, ctx: &DetectCtx) -> Integration {
    let fid = spec.flatpak_id.unwrap_or("");
    let mk = |detail: String, source: &str| {
        entry(
            spec.id, spec.name, spec.category, true, detail, spec.hint, spec.doc_url, fid,
        )
        .source(source)
    };

    // 1. Executable on PATH (most authoritative — gives a version string).
    let bin = spec
        .bins
        .iter()
        .find_map(|b| which(b).map(|p| (b.to_string(), p)));
    if let Some((b, path)) = bin {
        let detail = spec
            .ver
            .and_then(|(vbin, vargs)| version(vbin, vargs))
            .unwrap_or_else(|| path.clone());
        return mk(
            if detail == path { format!("{b} · {path}") } else { detail },
            "path",
        );
    }
    // 2. Flatpak app installed.
    if let Some(f) = spec.flatpak_id {
        if ctx.flatpaks.contains(f) {
            return mk(format!("flatpak · {f}"), "flatpak");
        }
    }
    // 3. Installed package (binary name usually == package, e.g. openrgb).
    if let Some(pkg) = name_candidates(&spec)
        .into_iter()
        .find(|c| ctx.packages.contains(c))
    {
        return mk(format!("package · {pkg}"), "package");
    }
    // 4. Desktop entry present (GUI / AppImage / manual install, not on PATH).
    if name_candidates(&spec).iter().any(|c| ctx.desktops.contains(c)) {
        return mk("installed".into(), "desktop");
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
    let ctx = DetectCtx {
        flatpaks: flatpak_apps(),
        desktops: desktop_files(),
        packages: pacman_packages(),
    };
    let fp = &ctx.flatpaks; // used by the bespoke (non-macro) entries below
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
                &ctx,
            ))
        };
    }

    // ---- Gaming tools ----
    // NOTE: MangoHud has NO standalone Flathub app — it only ships as the Vulkan
    // layer extension `org.freedesktop.Platform.VulkanLayer.MangoHud`, which is
    // branch-versioned and NOT installable as a one-click app ref (the old
    // flatpak_id made every install fail with "isn't available on Flathub").
    // On Arch/CachyOS the real source is the official `mangohud` package
    // (+ `lib32-mangohud` for 32-bit games), so we present that instead.
    t!(
        "mangohud",
        "MangoHud",
        "gaming",
        &["mangohud"],
        Some(("mangohud", &["--version"][..])),
        None,
        "sudo pacman -S mangohud lib32-mangohud",
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
/// Flatpak readiness, surfaced to the UI so it can show a "Add Flathub" prompt
/// instead of letting an install fail with a raw "No remote refs" error.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlatpakHealth {
    pub flatpak_installed: bool,
    pub flathub_remote: bool,
}

pub fn flatpak_health() -> FlatpakHealth {
    let installed = which("flatpak").is_some();
    FlatpakHealth {
        flatpak_installed: installed,
        flathub_remote: installed && flathub_remote_present(),
    }
}

/// Is a user-scoped `flathub` remote configured? We check (and add) at *user*
/// scope so `flatpak install --user` always has a matching remote — a
/// system-only flathub remote can't satisfy a `--user` install.
fn flathub_remote_present() -> bool {
    std::process::Command::new("flatpak")
        .args(["remotes", "--user", "--columns=name"])
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .any(|l| l.trim() == "flathub")
        })
        .unwrap_or(false)
}

/// Add the Flathub remote (user-scoped, idempotent). This is the one-click fix
/// for the most common failure on a fresh machine: Flatpak installed but no
/// remotes configured.
fn ensure_flathub() -> Result<(), String> {
    if flathub_remote_present() {
        return Ok(());
    }
    let out = std::process::Command::new("flatpak")
        .args([
            "remote-add",
            "--if-not-exists",
            "--user",
            "flathub",
            "https://flathub.org/repo/flathub.flatpakrepo",
        ])
        .output()
        .map_err(|e| format!("Couldn't run flatpak: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(humanize_flatpak_error(&String::from_utf8_lossy(&out.stderr)))
    }
}

/// Public "Add Flathub" entrypoint for the UI banner.
pub fn add_flathub() -> Result<String, String> {
    if which("flatpak").is_none() {
        return Err("Flatpak isn't installed yet. Install it first: sudo pacman -S flatpak".into());
    }
    ensure_flathub()?;
    Ok("Flathub repository added — you can install apps now.".into())
}

/// Does the app id actually exist on the flathub remote? Lets us fail with a
/// clear "not available" message instead of a cryptic remote error.
fn package_available(flatpak_id: &str) -> bool {
    std::process::Command::new("flatpak")
        .args(["remote-info", "--user", "flathub", flatpak_id])
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Turn raw flatpak stderr into a single human-readable sentence. End users must
/// never see a package-manager stack trace.
fn humanize_flatpak_error(stderr: &str) -> String {
    let s = stderr.to_lowercase();
    if s.contains("no remote refs found") || s.contains("not found in remote") {
        "This app isn't available on Flathub (or the Flathub remote isn't set up).".into()
    } else if s.contains("already installed") {
        "It's already installed.".into()
    } else if s.contains("permission denied") || s.contains("polkit") || s.contains("not authorized")
    {
        "Permission was denied while installing.".into()
    } else if s.contains("could not resolve")
        || s.contains("failed to connect")
        || s.contains("temporary failure")
        || s.contains("network is unreachable")
        || s.contains("timed out")
    {
        "Couldn't reach Flathub — check your internet connection and try again.".into()
    } else if s.contains("no space left") {
        "There isn't enough disk space to install this app.".into()
    } else {
        let first = stderr
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty())
            .unwrap_or("Installation failed.");
        format!(
            "Installation failed: {}",
            first.chars().take(160).collect::<String>()
        )
    }
}

/// Phase 1 — make sure we *can* install: flatpak present, Flathub remote set up
/// (self-healed), and the app actually exists on the remote.
pub fn ensure_ready(flatpak_id: &str) -> Result<(), String> {
    if flatpak_id.is_empty() {
        return Err(
            "This tool has no one-click installer — use the package-manager command shown.".into(),
        );
    }
    if which("flatpak").is_none() {
        return Err("Flatpak isn't installed yet. Install it first: sudo pacman -S flatpak".into());
    }
    // Self-heal the remote — a fresh Flatpak has none, which is what produced
    // the raw "No remote refs found for 'flathub'" error.
    ensure_flathub()?;
    if !package_available(flatpak_id) {
        return Err(format!(
            "{flatpak_id} isn't available on Flathub right now — it may have been renamed or removed."
        ));
    }
    Ok(())
}

/// Download + installed size of a flathub ref, parsed from `remote-info`. Both
/// fields are best-effort (`None` when flatpak can't resolve the ref or the
/// output format changes) so the UI can show "≈ N MB to download" before the
/// install starts and compute transferred/ETA during it.
#[derive(Debug, Clone, Copy, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteSize {
    pub download_bytes: Option<u64>,
    pub installed_bytes: Option<u64>,
}

pub fn remote_size(flatpak_id: &str) -> RemoteSize {
    let mut size = RemoteSize::default();
    if flatpak_id.is_empty() || which("flatpak").is_none() {
        return size;
    }
    let Ok(out) = std::process::Command::new("flatpak")
        .args(["remote-info", "--user", "flathub", flatpak_id])
        .output()
    else {
        return size;
    };
    if !out.status.success() {
        return size;
    }
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let l = line.trim();
        if let Some(v) = l.strip_prefix("Download:") {
            size.download_bytes = parse_human_size(v);
        } else if let Some(v) = l.strip_prefix("Installed:") {
            size.installed_bytes = parse_human_size(v);
        }
    }
    size
}

/// Parse a flatpak human size like "118.3 MB", "1.2 GiB", "512 kB (partial)"
/// into bytes (binary multipliers, matching flatpak's own accounting).
fn parse_human_size(s: &str) -> Option<u64> {
    let s = s.trim();
    let num_end = s
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(s.len());
    let val: f64 = s[..num_end].trim().parse().ok()?;
    let unit: String = s[num_end..]
        .trim()
        .chars()
        .take_while(|c| c.is_ascii_alphabetic())
        .collect::<String>()
        .to_ascii_lowercase();
    let mult: f64 = match unit.as_str() {
        "b" | "" => 1.0,
        "kb" | "kib" | "k" => 1024.0,
        "mb" | "mib" | "m" => 1024.0 * 1024.0,
        "gb" | "gib" | "g" => 1024.0 * 1024.0 * 1024.0,
        "tb" | "tib" | "t" => 1024.0f64.powi(4),
        _ => return None,
    };
    Some((val * mult) as u64)
}

/// Extract a percentage (e.g. "42%") from a progress fragment, scanning bytes so
/// flatpak's Unicode progress-bar glyphs don't trip up parsing. Returns the last
/// valid 0–100 value found.
fn parse_percent(frag: &[u8]) -> Option<u32> {
    let mut best = None;
    for (i, &b) in frag.iter().enumerate() {
        if b == b'%' {
            let mut j = i;
            while j > 0 && frag[j - 1].is_ascii_digit() {
                j -= 1;
            }
            if j < i {
                if let Ok(v) = std::str::from_utf8(&frag[j..i]).unwrap_or("").parse::<u32>() {
                    if v <= 100 {
                        best = Some(v);
                    }
                }
            }
        }
    }
    best
}

/// Phase 2 — the actual (slow) install, streaming flatpak's progress. `on_percent`
/// is invoked with the overall completion percent (0–100) as flatpak reports it;
/// flatpak draws its bar with carriage returns, so we read raw bytes and split on
/// `\r`/`\n`. When flatpak emits no parseable percent the callback simply never
/// fires and the UI keeps its phase-based indeterminate state — nothing is faked.
pub fn run_install(flatpak_id: &str, mut on_percent: impl FnMut(u32)) -> Result<(), String> {
    use std::io::Read;
    use std::process::{Command, Stdio};

    // NOTE: no `--noninteractive` here — that flag suppresses progress output.
    let mut child = Command::new("flatpak")
        .args(["install", "-y", "--user", "flathub", flatpak_id])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't launch flatpak: {e}"))?;

    // Drain stderr on a thread so a full pipe can never deadlock the install;
    // keep its text for humanized error reporting.
    let mut stderr = child.stderr.take();
    let err_handle = std::thread::spawn(move || {
        let mut buf = String::new();
        if let Some(s) = stderr.as_mut() {
            let _ = s.read_to_string(&mut buf);
        }
        buf
    });

    if let Some(mut stdout) = child.stdout.take() {
        let mut chunk = [0u8; 4096];
        let mut frag: Vec<u8> = Vec::with_capacity(128);
        let mut last = u32::MAX;
        loop {
            match stdout.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => {
                    for &b in &chunk[..n] {
                        if b == b'\r' || b == b'\n' {
                            if let Some(p) = parse_percent(&frag) {
                                if p != last {
                                    last = p;
                                    on_percent(p);
                                }
                            }
                            frag.clear();
                        } else {
                            frag.push(b);
                        }
                    }
                }
                Err(_) => break,
            }
        }
        if let Some(p) = parse_percent(&frag) {
            if p != last {
                on_percent(p);
            }
        }
    }

    let status = child.wait().map_err(|e| format!("flatpak failed: {e}"))?;
    let stderr = err_handle.join().unwrap_or_default();
    if status.success() {
        Ok(())
    } else {
        Err(humanize_flatpak_error(&stderr))
    }
}

/// Uninstall a (user-scoped) flatpak app. Errors are humanized.
pub fn uninstall_integration(flatpak_id: &str) -> Result<String, String> {
    if flatpak_id.is_empty() || which("flatpak").is_none() {
        return Err("Nothing to uninstall here.".into());
    }
    let out = std::process::Command::new("flatpak")
        .args(["uninstall", "-y", "--user", "--noninteractive", flatpak_id])
        .output()
        .map_err(|e| format!("Couldn't launch flatpak: {e}"))?;
    if out.status.success() {
        Ok("Uninstalled.".into())
    } else {
        Err(humanize_flatpak_error(&String::from_utf8_lossy(&out.stderr)))
    }
}

/// Launch a flatpak app (fire-and-forget).
pub fn open_integration(flatpak_id: &str) -> Result<String, String> {
    if flatpak_id.is_empty() || which("flatpak").is_none() {
        return Err("This app can't be launched from Nexus.".into());
    }
    std::process::Command::new("flatpak")
        .args(["run", flatpak_id])
        .spawn()
        .map_err(|e| format!("Couldn't launch: {e}"))?;
    Ok("Launched.".into())
}

/// The installed version of a (user-scoped) flatpak app, for the "Installed ✓ v…"
/// confirmation. None if not installed / unparseable.
pub fn installed_flatpak_version(flatpak_id: &str) -> Option<String> {
    let out = std::process::Command::new("flatpak")
        .args(["info", "--user", flatpak_id])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find_map(|l| l.trim().strip_prefix("Version:").map(|v| v.trim().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn human_size_parses_flatpak_units() {
        assert_eq!(parse_human_size("512 B"), Some(512));
        assert_eq!(parse_human_size("1 kB"), Some(1024));
        assert_eq!(parse_human_size("118.3 MB"), Some((118.3 * 1024.0 * 1024.0) as u64));
        assert_eq!(parse_human_size("1.5 GiB"), Some((1.5 * 1024.0 * 1024.0 * 1024.0) as u64));
        // Trailing annotations like "(partial)" must not break parsing.
        assert_eq!(parse_human_size("412.7 MB (partial)"), Some((412.7 * 1024.0 * 1024.0) as u64));
    }

    #[test]
    fn human_size_rejects_garbage() {
        assert_eq!(parse_human_size(""), None);
        assert_eq!(parse_human_size("lots"), None);
        assert_eq!(parse_human_size("12 parsecs"), None);
    }

    #[test]
    fn percent_extracted_from_progress_fragment() {
        assert_eq!(parse_percent(b"Installing 1/2 42%"), Some(42));
        assert_eq!(parse_percent("█████░░░░ 55% • 8.1 MB/s".as_bytes()), Some(55));
        // No percent token → None (UI keeps the indeterminate bar).
        assert_eq!(parse_percent(b"Looking for matches..."), None);
        // Out-of-range values are ignored.
        assert_eq!(parse_percent(b"999%"), None);
        // Last valid value wins when several appear.
        assert_eq!(parse_percent(b"10% ... 73%"), Some(73));
    }
}

