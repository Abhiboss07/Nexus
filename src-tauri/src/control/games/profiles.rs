//! Per-game profiles: RGB + power + fan + launch command + env vars, with a
//! launch-command / Steam-launch-options builder. Persisted as JSON. Read/write
//! is to the user's config only — no hardware writes here.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::scanner::Game;
use crate::control::nexus::RgbSpec;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvVar {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameProfile {
    pub game_id: String,
    #[serde(default)]
    pub rgb: Option<RgbSpec>,
    #[serde(default)]
    pub power: Option<String>,
    #[serde(default)]
    pub fan: Option<String>,
    #[serde(default)]
    pub launch_command: Option<String>,
    #[serde(default)]
    pub env_vars: Vec<EnvVar>,
    #[serde(default)]
    pub use_prime: bool,
    #[serde(default = "default_true")]
    pub use_gamemode: bool,
    #[serde(default)]
    pub use_mangohud: bool,

    /* ---- Launch optimizer (Per-Game Automation) ---- */
    /// CPU scheduling niceness for native launches (-20 high … 19 low).
    #[serde(default)]
    pub priority: Option<i32>,
    /// Background process names to terminate before launch (e.g. "chrome").
    #[serde(default)]
    pub close_apps: Vec<String>,
    /// Drop the thumbnail cache before launch (free a little RAM/IO).
    #[serde(default)]
    pub clear_cache: bool,
    /// Auto-apply this profile when `match_process` is detected running.
    #[serde(default)]
    pub auto_apply: bool,
    /// Process name to watch for auto-apply (defaults to the game's binary).
    #[serde(default)]
    pub match_process: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Resolved launch instructions for a game.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameLaunch {
    pub command: String,
    pub steam_launch_options: String,
}

impl GameProfile {
    pub fn empty(game_id: &str) -> Self {
        Self {
            game_id: game_id.into(),
            rgb: None,
            power: None,
            fan: None,
            launch_command: None,
            env_vars: Vec::new(),
            use_prime: false,
            use_gamemode: true,
            use_mangohud: false,
            priority: None,
            close_apps: Vec::new(),
            clear_cache: false,
            auto_apply: false,
            match_process: None,
        }
    }

    /// Wrapper prefix (env + tools) shared by both builders.
    fn wrapper(&self) -> String {
        let mut parts: Vec<String> = Vec::new();
        for e in &self.env_vars {
            if !e.key.trim().is_empty() {
                parts.push(format!("{}={}", e.key.trim(), shell_quote(&e.value)));
            }
        }
        if self.use_mangohud {
            parts.push("mangohud".into());
        }
        if self.use_gamemode {
            parts.push("gamemoderun".into());
        }
        if self.use_prime {
            parts.push("prime-run".into());
        }
        // CPU priority: nice prefix (negative values need privilege; nice still
        // launches the game at default priority if not permitted).
        if let Some(p) = self.priority {
            parts.insert(0, format!("nice -n {}", p.clamp(-20, 19)));
        }
        parts.join(" ")
    }

    /// Run the launch-optimizer pre-steps (close background apps, clear the
    /// thumbnail cache). User-level only — never escalates. Returns notes.
    pub fn run_launch_optimizer(&self) -> Vec<String> {
        let mut notes = Vec::new();
        let uid = unsafe { libc::geteuid() }.to_string();
        for app in &self.close_apps {
            let app = app.trim();
            if app.is_empty() {
                continue;
            }
            // Signal only the current user's processes matching the name.
            let ok = std::process::Command::new("pkill")
                .args(["-TERM", "-u", &uid, "-x", app])
                .status()
                .map(|s| s.success())
                .unwrap_or(false)
                // Fall back to a substring match if the exact name missed.
                || std::process::Command::new("pkill")
                    .args(["-TERM", "-u", &uid, app])
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
            if ok {
                notes.push(format!("Closed {app}"));
            }
        }
        if self.clear_cache {
            let home = std::env::var("HOME").unwrap_or_default();
            let thumb = format!("{home}/.cache/thumbnails");
            if let Ok(rd) = std::fs::read_dir(&thumb) {
                for e in rd.flatten() {
                    let p = e.path();
                    let _ = if p.is_dir() {
                        std::fs::remove_dir_all(&p)
                    } else {
                        std::fs::remove_file(&p)
                    };
                }
                notes.push("Cleared thumbnail cache".into());
            }
        }
        notes
    }

    /// A Steam "Launch Options" string to paste into the game's properties.
    pub fn steam_launch_options(&self) -> String {
        let w = self.wrapper();
        if w.is_empty() {
            "%command%".into()
        } else {
            format!("{w} %command%")
        }
    }

    /// A full shell command that launches the game with the profile applied.
    pub fn launch_command(&self, game: &Game) -> String {
        let wrapper = self.wrapper();
        let base = match game.source.as_str() {
            "steam" => game
                .app_id
                .as_ref()
                .map(|id| format!("steam steam://rungameid/{id}"))
                .unwrap_or_else(|| "steam".into()),
            "lutris" => game
                .id
                .strip_prefix("lutris:")
                .map(|s| format!("lutris lutris:rungame/{s}"))
                .unwrap_or_else(|| "lutris".into()),
            _ => self.launch_command.clone().unwrap_or_default(),
        };
        // Steam/Lutris apply their own per-game options; the wrapper is most
        // meaningful for native launches.
        if game.source == "native" && !wrapper.is_empty() {
            format!("{wrapper} {base}").trim().to_string()
        } else {
            base
        }
    }
}

fn shell_quote(s: &str) -> String {
    if s.chars()
        .all(|c| c.is_ascii_alphanumeric() || "._-/:=".contains(c))
    {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}

fn safe_stem(id: &str) -> String {
    id.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .to_lowercase()
}

pub struct GameProfileStore {
    dir: PathBuf,
}

impl GameProfileStore {
    pub fn new() -> Self {
        let base = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
                    .join(".config")
            });
        let dir = base.join("nexus").join("games");
        let _ = fs::create_dir_all(&dir);
        Self { dir }
    }

    pub fn get(&self, game_id: &str) -> Option<GameProfile> {
        let text =
            fs::read_to_string(self.dir.join(format!("{}.json", safe_stem(game_id)))).ok()?;
        serde_json::from_str(&text).ok()
    }

    pub fn save(&self, profile: &GameProfile) -> Result<(), String> {
        let json = serde_json::to_string_pretty(profile).map_err(|e| e.to_string())?;
        fs::write(
            self.dir
                .join(format!("{}.json", safe_stem(&profile.game_id))),
            json,
        )
        .map_err(|e| e.to_string())
    }

    pub fn delete(&self, game_id: &str) -> Result<(), String> {
        let p = self.dir.join(format!("{}.json", safe_stem(game_id)));
        if p.exists() {
            fs::remove_file(p).map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }

    pub fn list(&self) -> Vec<GameProfile> {
        let mut out = Vec::new();
        if let Ok(rd) = fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                if e.path().extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(text) = fs::read_to_string(e.path()) {
                        if let Ok(p) = serde_json::from_str::<GameProfile>(&text) {
                            out.push(p);
                        }
                    }
                }
            }
        }
        out
    }
}

impl Default for GameProfileStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn game() -> Game {
        Game {
            id: "steam:1145360".into(),
            name: "Hades".into(),
            source: "steam".into(),
            app_id: Some("1145360".into()),
            install_dir: None,
            size_bytes: 0,
            last_played: None,
            is_tool: false,
        }
    }

    #[test]
    fn steam_launch_options_compose_wrapper() {
        let mut p = GameProfile::empty("steam:1145360");
        p.use_mangohud = true;
        p.use_gamemode = true;
        p.use_prime = true;
        p.env_vars.push(EnvVar {
            key: "DXVK_HUD".into(),
            value: "fps".into(),
        });
        let opt = p.steam_launch_options();
        assert!(opt.contains("mangohud"));
        assert!(opt.contains("gamemoderun"));
        assert!(opt.contains("prime-run"));
        assert!(opt.contains("DXVK_HUD=fps"));
        assert!(opt.ends_with("%command%"));
    }

    #[test]
    fn steam_launch_command_uses_rungameid() {
        let p = GameProfile::empty("steam:1145360");
        assert_eq!(p.launch_command(&game()), "steam steam://rungameid/1145360");
    }
}

#[cfg(test)]
mod automation_tests {
    use super::*;

    #[test]
    fn profile_roundtrips_with_automation_fields() {
        let mut p = GameProfile::empty("steam:730");
        p.auto_apply = true;
        p.match_process = Some("cs2".into());
        p.close_apps = vec!["chrome".into()];
        p.clear_cache = true;
        p.priority = Some(-5);
        let json = serde_json::to_string(&p).unwrap();
        let back: GameProfile = serde_json::from_str(&json).unwrap();
        assert!(back.auto_apply && back.clear_cache);
        assert_eq!(back.match_process.as_deref(), Some("cs2"));
        assert_eq!(back.priority, Some(-5));
    }

    #[test]
    fn old_profile_json_still_loads() {
        // A profile saved before the automation fields existed must deserialize.
        let old = r#"{"gameId":"x","rgb":null,"power":null,"fan":null,"launchCommand":null,"envVars":[],"usePrime":false,"useGamemode":true,"useMangohud":false}"#;
        let p: GameProfile = serde_json::from_str(old).unwrap();
        assert!(!p.auto_apply && p.priority.is_none() && p.close_apps.is_empty());
    }

    #[test]
    fn wrapper_includes_nice_when_priority_set() {
        let mut p = GameProfile::empty("x");
        p.priority = Some(10);
        assert!(p.steam_launch_options().contains("nice -n 10"));
    }
}
