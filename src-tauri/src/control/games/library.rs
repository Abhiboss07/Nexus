//! Manual game library — user-added games that the automatic scanner can't find
//! (native Linux executables, or launcher games imported by app id). Persisted to
//! `~/.config/nexus/manual-games.json` and merged with the scanned library in the
//! UI. Supports add / edit / delete / launch.

use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualGame {
    /// Stable id, e.g. "manual:hades". Assigned on add.
    #[serde(default)]
    pub id: String,
    pub title: String,
    /// steam | lutris | heroic | bottles | native
    pub source: String,
    /// Path to a native executable, or the launcher binary/command.
    #[serde(default)]
    pub executable: String,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub launch_args: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub banner: Option<String>,
    /// Steam AppID / Lutris slug / Heroic app name for launcher imports.
    #[serde(default)]
    pub app_id: Option<String>,
}

fn config_dir() -> PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())).join(".config")
        });
    base.join("nexus")
}

fn store_path() -> PathBuf {
    config_dir().join("manual-games.json")
}

fn slugify(s: &str) -> String {
    let slug: String = s
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    slug.split('-')
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

pub fn list() -> Vec<ManualGame> {
    std::fs::read_to_string(store_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_all(games: &[ManualGame]) -> Result<(), String> {
    let _ = std::fs::create_dir_all(config_dir());
    let json = serde_json::to_string_pretty(games).map_err(|e| e.to_string())?;
    std::fs::write(store_path(), json).map_err(|e| e.to_string())
}

pub fn get(id: &str) -> Option<ManualGame> {
    list().into_iter().find(|g| g.id == id)
}

/// Add a new manual game, assigning a unique `manual:<slug>` id.
pub fn add(mut game: ManualGame) -> Result<ManualGame, String> {
    if game.title.trim().is_empty() {
        return Err("A title is required.".into());
    }
    if game.source == "native" && game.executable.trim().is_empty() {
        return Err("Select an executable for a native game.".into());
    }
    let mut games = list();
    let base = format!("manual:{}", slugify(&game.title));
    let mut id = base.clone();
    let mut n = 2;
    while games.iter().any(|g| g.id == id) {
        id = format!("{base}-{n}");
        n += 1;
    }
    game.id = id;
    games.push(game.clone());
    save_all(&games)?;
    Ok(game)
}

pub fn update(game: ManualGame) -> Result<(), String> {
    let mut games = list();
    let Some(slot) = games.iter_mut().find(|g| g.id == game.id) else {
        return Err("Game not found.".into());
    };
    *slot = game;
    save_all(&games)
}

pub fn delete(id: &str) -> Result<(), String> {
    let mut games = list();
    let before = games.len();
    games.retain(|g| g.id != id);
    if games.len() == before {
        return Err("Game not found.".into());
    }
    save_all(&games)
}

fn spawn(mut cmd: Command, title: &str) -> Result<String, String> {
    cmd.spawn()
        .map_err(|e| format!("Failed to launch {title}: {e}"))?;
    Ok(format!("Launched {title}."))
}

/// Launch a manual game. For launcher sources we prefer the launcher's own
/// protocol/CLI; native games run the executable directly (detached).
pub fn launch(id: &str) -> Result<String, String> {
    let g = get(id).ok_or("Game not found.")?;
    let args: Vec<String> = g.launch_args.split_whitespace().map(String::from).collect();

    // Launcher imports with an app id use the launcher; otherwise fall back to
    // the provided executable.
    if let Some(app) = g.app_id.as_deref().filter(|a| !a.is_empty()) {
        match g.source.as_str() {
            "steam" => {
                let mut c = Command::new("steam");
                c.arg("-applaunch").arg(app).args(&args);
                return spawn(c, &g.title);
            }
            "lutris" => {
                let mut c = Command::new("lutris");
                c.arg(format!("lutris:rungameid/{app}"));
                return spawn(c, &g.title);
            }
            "heroic" => {
                // Heroic registers the heroic:// URL scheme.
                let mut c = Command::new("xdg-open");
                c.arg(format!("heroic://launch/{app}"));
                return spawn(c, &g.title);
            }
            _ => {}
        }
    }

    // Native (or any source) with an executable.
    if g.executable.trim().is_empty() {
        return Err("No executable or launcher target configured for this game.".into());
    }
    let mut c = Command::new(&g.executable);
    c.args(&args);
    if let Some(wd) = g.working_dir.as_deref().filter(|w| !w.is_empty()) {
        c.current_dir(wd);
    } else if let Some(parent) = std::path::Path::new(&g.executable).parent() {
        c.current_dir(parent);
    }
    spawn(c, &g.title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugifies() {
        assert_eq!(slugify("Elden Ring!"), "elden-ring");
        assert_eq!(slugify("  Hades  "), "hades");
    }

    #[test]
    fn add_requires_title() {
        let g = ManualGame {
            id: String::new(),
            title: String::new(),
            source: "native".into(),
            executable: "/bin/true".into(),
            working_dir: None,
            launch_args: String::new(),
            icon: None,
            banner: None,
            app_id: None,
        };
        assert!(add(g).is_err());
    }

    #[test]
    fn launch_unknown_is_error() {
        assert!(launch("manual:does-not-exist-xyz").is_err());
    }
}
