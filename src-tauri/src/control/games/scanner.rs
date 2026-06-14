//! Game library scanner. Parses Steam `appmanifest_*.acf` (VDF) across all
//! library folders, and detects Lutris / Heroic / launcher tooling. Read-only.

use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Game {
    /// Stable id, e.g. "steam:632360".
    pub id: String,
    pub name: String,
    pub source: String, // steam | lutris | heroic | native
    pub app_id: Option<String>,
    pub install_dir: Option<String>,
    pub size_bytes: u64,
    pub last_played: Option<u64>,
    /// Runtime / Proton / redistributable rather than a real game.
    pub is_tool: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LauncherStatus {
    pub steam: bool,
    pub lutris: bool,
    pub heroic: bool,
    pub gamemode: bool,
    pub gamescope: bool,
    pub mangohud: bool,
    pub prime_run: bool,
}

fn home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/root".into())
}

fn command_exists(bin: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(bin).is_file()))
        .unwrap_or(false)
}

pub fn launchers() -> LauncherStatus {
    LauncherStatus {
        steam: command_exists("steam"),
        lutris: command_exists("lutris"),
        heroic: command_exists("heroic")
            || std::path::Path::new(&format!("{}/.config/heroic", home())).exists(),
        gamemode: command_exists("gamemoderun"),
        gamescope: command_exists("gamescope"),
        mangohud: command_exists("mangohud"),
        prime_run: command_exists("prime-run"),
    }
}

/// Extract the quoted value following a `"key"` token in a VDF blob.
fn vdf_value(text: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\"");
    let idx = text.find(&needle)? + needle.len();
    let rest = &text[idx..];
    // skip whitespace/tabs, then read the next quoted string
    let q1 = rest.find('"')?;
    let after = &rest[q1 + 1..];
    let q2 = after.find('"')?;
    Some(after[..q2].to_string())
}

fn is_tool(name: &str, app_id: &str) -> bool {
    let n = name.to_lowercase();
    n.contains("steam linux runtime")
        || n.contains("proton")
        || n.contains("steamworks common")
        || n.contains("redistributable")
        || matches!(app_id, "228980" | "1070560" | "1391110" | "1493710")
}

fn steam_roots() -> Vec<String> {
    let h = home();
    let candidates = [
        format!("{h}/.steam/steam"),
        format!("{h}/.local/share/Steam"),
        format!("{h}/.steam/root"),
        format!("{h}/.var/app/com.valvesoftware.Steam/.local/share/Steam"),
    ];
    let mut roots = Vec::new();
    for c in candidates {
        if std::path::Path::new(&format!("{c}/steamapps")).exists() {
            // canonicalize to dedupe symlinks
            let real = std::fs::canonicalize(&c).map(|p| p.to_string_lossy().to_string()).unwrap_or(c);
            if !roots.contains(&real) {
                roots.push(real);
            }
        }
    }
    roots
}

/// All Steam library `steamapps` dirs (root + extra libraries in libraryfolders.vdf).
fn steam_library_dirs() -> Vec<String> {
    let mut dirs = Vec::new();
    for root in steam_roots() {
        let apps = format!("{root}/steamapps");
        if !dirs.contains(&apps) {
            dirs.push(apps.clone());
        }
        if let Ok(vdf) = std::fs::read_to_string(format!("{apps}/libraryfolders.vdf")) {
            // Each library block has a "path" entry.
            for line in vdf.lines() {
                if line.contains("\"path\"") {
                    if let Some(p) = vdf_value(line, "path") {
                        let lib = format!("{}/steamapps", p.replace("\\\\", "/"));
                        if std::path::Path::new(&lib).exists() && !dirs.contains(&lib) {
                            dirs.push(lib);
                        }
                    }
                }
            }
        }
    }
    dirs
}

fn scan_steam() -> Vec<Game> {
    let mut games = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for dir in steam_library_dirs() {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let path = e.path();
            let fname = path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
            if !fname.starts_with("appmanifest_") || path.extension().and_then(|s| s.to_str()) != Some("acf") {
                continue;
            }
            let Ok(text) = std::fs::read_to_string(&path) else { continue };
            let app_id = vdf_value(&text, "appid").unwrap_or_default();
            if app_id.is_empty() || !seen.insert(app_id.clone()) {
                continue;
            }
            let name = vdf_value(&text, "name").unwrap_or_else(|| format!("App {app_id}"));
            let install_dir = vdf_value(&text, "installdir");
            let size_bytes = vdf_value(&text, "SizeOnDisk").and_then(|s| s.parse().ok()).unwrap_or(0);
            let last_played = vdf_value(&text, "LastPlayed").and_then(|s| s.parse().ok()).filter(|&v| v > 0);
            games.push(Game {
                id: format!("steam:{app_id}"),
                is_tool: is_tool(&name, &app_id),
                name,
                source: "steam".into(),
                app_id: Some(app_id),
                install_dir: install_dir.map(|d| format!("{dir}/common/{d}")),
                size_bytes,
                last_played,
            });
        }
    }
    games
}

fn scan_lutris() -> Vec<Game> {
    // Lutris stores games in a SQLite pga.db; parsing it needs a SQLite dep we
    // avoid. We detect presence and list any YAML game configs that exist.
    let mut games = Vec::new();
    let dir = format!("{}/.config/lutris/games", home());
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().and_then(|s| s.to_str()) != Some("yml") {
                continue;
            }
            let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            // filename is "<slug>-<id>.yml"; use the slug as a friendly name.
            let name = stem.rsplit_once('-').map(|(s, _)| s).unwrap_or(&stem).replace('-', " ");
            games.push(Game {
                id: format!("lutris:{stem}"),
                name,
                source: "lutris".into(),
                app_id: None,
                install_dir: None,
                size_bytes: 0,
                last_played: None,
                is_tool: false,
            });
        }
    }
    games
}

/// Scan all detected sources. `include_tools=false` hides runtimes/Proton.
pub fn scan(include_tools: bool) -> Vec<Game> {
    let mut games = scan_steam();
    games.extend(scan_lutris());
    if !include_tools {
        games.retain(|g| !g.is_tool);
    }
    games.sort_by(|a, b| b.last_played.cmp(&a.last_played).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    games
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vdf_value_extracts() {
        let acf = "\t\"appid\"\t\t\"632360\"\n\t\"name\"\t\t\"Risk of Rain 2\"\n\t\"SizeOnDisk\"\t\t\"4096\"\n";
        assert_eq!(vdf_value(acf, "appid").as_deref(), Some("632360"));
        assert_eq!(vdf_value(acf, "name").as_deref(), Some("Risk of Rain 2"));
        assert_eq!(vdf_value(acf, "SizeOnDisk").as_deref(), Some("4096"));
        assert_eq!(vdf_value(acf, "missing"), None);
    }

    #[test]
    fn detects_tools() {
        assert!(is_tool("Steam Linux Runtime 4.0", "4183110"));
        assert!(is_tool("Proton 9.0", "0"));
        assert!(!is_tool("Hades", "1145360"));
    }
}
