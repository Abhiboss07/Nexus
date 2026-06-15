//! Nexus profiles — high-level, composable system profiles (Gaming, Coding,
//! Streaming, Battery Saver, Custom). Each profile can set a power profile and an
//! RGB look (fan/GPU reserved for future phases). Built-ins are always present;
//! user edits + custom profiles are persisted as JSON.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbSpec {
    pub effect: String,
    pub hue: u16,
    pub brightness: u8,
    pub speed: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NexusProfile {
    pub id: String,
    pub name: String,
    pub icon: String,
    #[serde(default)]
    pub builtin: bool,
    /// Power profile name (validated against the active power driver on apply).
    pub power: Option<String>,
    pub rgb: Option<RgbSpec>,
    /// Reserved for Phase 3.3+.
    pub fan: Option<String>,
    pub gpu: Option<String>,
}

fn rgb(effect: &str, hue: u16, brightness: u8, speed: u8) -> Option<RgbSpec> {
    Some(RgbSpec {
        effect: effect.into(),
        hue,
        brightness,
        speed,
    })
}

/// The five built-in profiles.
pub fn builtins() -> Vec<NexusProfile> {
    vec![
        NexusProfile {
            id: "gaming".into(),
            name: "Gaming".into(),
            icon: "gamepad".into(),
            builtin: true,
            power: Some("performance".into()),
            rgb: rgb("static", 0, 100, 50),
            fan: None,
            gpu: None,
        },
        NexusProfile {
            id: "coding".into(),
            name: "Coding".into(),
            icon: "code".into(),
            builtin: true,
            power: Some("balanced".into()),
            rgb: rgb("static", 210, 70, 0),
            fan: None,
            gpu: None,
        },
        NexusProfile {
            id: "streaming".into(),
            name: "Streaming".into(),
            icon: "video".into(),
            builtin: true,
            power: Some("performance".into()),
            rgb: rgb("breathing", 280, 90, 40),
            fan: None,
            gpu: None,
        },
        NexusProfile {
            id: "battery-saver".into(),
            name: "Battery Saver".into(),
            icon: "leaf".into(),
            builtin: true,
            power: Some("power-saver".into()),
            rgb: rgb("static", 30, 25, 0),
            fan: None,
            gpu: None,
        },
        NexusProfile {
            id: "custom".into(),
            name: "Custom".into(),
            icon: "sliders".into(),
            builtin: true,
            power: Some("balanced".into()),
            rgb: None,
            fan: None,
            gpu: None,
        },
    ]
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

pub struct NexusProfileStore {
    dir: PathBuf,
}

impl NexusProfileStore {
    pub fn new() -> Self {
        let base = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
                    .join(".config")
            });
        let dir = base.join("nexus").join("profiles");
        let _ = fs::create_dir_all(&dir);
        Self { dir }
    }

    /// Built-ins overlaid with any persisted overrides / custom profiles.
    pub fn list(&self) -> Vec<NexusProfile> {
        let mut profiles = builtins();
        if let Ok(rd) = fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                if e.path().extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(text) = fs::read_to_string(e.path()) {
                    if let Ok(p) = serde_json::from_str::<NexusProfile>(&text) {
                        if let Some(existing) = profiles.iter_mut().find(|x| x.id == p.id) {
                            *existing = p; // override built-in
                        } else {
                            profiles.push(p);
                        }
                    }
                }
            }
        }
        profiles
    }

    pub fn get(&self, id: &str) -> Option<NexusProfile> {
        self.list().into_iter().find(|p| p.id == id)
    }

    pub fn save(&self, profile: &NexusProfile) -> Result<(), String> {
        let json = serde_json::to_string_pretty(profile).map_err(|e| e.to_string())?;
        fs::write(
            self.dir.join(format!("{}.json", safe_stem(&profile.id))),
            json,
        )
        .map_err(|e| e.to_string())
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        // Only persisted overrides can be removed; built-ins reappear afterwards.
        let path = self.dir.join(format!("{}.json", safe_stem(id)));
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())
        } else {
            Ok(())
        }
    }
}

impl Default for NexusProfileStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn five_builtins_present() {
        let b = builtins();
        assert_eq!(b.len(), 5);
        for id in ["gaming", "coding", "streaming", "battery-saver", "custom"] {
            assert!(b.iter().any(|p| p.id == id), "missing {id}");
        }
    }

    #[test]
    fn gaming_uses_performance() {
        let g = builtins().into_iter().find(|p| p.id == "gaming").unwrap();
        assert_eq!(g.power.as_deref(), Some("performance"));
        assert!(g.rgb.is_some());
    }
}
