//! RGB profiles, built-in presets, and theme import/export.
//!
//! A profile is a named, serializable lighting configuration. Profiles are
//! stored as JSON under `$XDG_CONFIG_HOME/nexus/rgb` (or `~/.config/nexus/rgb`).
//! Import/export are simply the profile JSON, so themes are shareable.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::effects;
use crate::control::traits::{ControlError, RgbRequest};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbProfile {
    pub name: String,
    pub effect: String,
    pub hue: u16,
    pub brightness: u8,
    pub speed: u8,
    /// Optional explicit per-zone colors (`#rrggbb`); falls back to `hue`.
    #[serde(default)]
    pub zones: Vec<String>,
}

impl RgbProfile {
    pub fn validate(&self) -> Result<(), ControlError> {
        if self.name.trim().is_empty() {
            return Err(ControlError::InvalidParameter(
                "profile name required".into(),
            ));
        }
        if !effects::is_valid(&self.effect) {
            return Err(ControlError::InvalidParameter(format!(
                "unknown effect '{}'",
                self.effect
            )));
        }
        if self.brightness > 100 || self.speed > 100 {
            return Err(ControlError::InvalidParameter(
                "brightness/speed must be 0–100".into(),
            ));
        }
        Ok(())
    }

    pub fn to_request(&self) -> RgbRequest {
        RgbRequest {
            effect: self.effect.clone(),
            hue: self.hue % 360,
            brightness: self.brightness.min(100),
            speed: self.speed.min(100),
            zone: None,
        }
    }
}

/// Built-in presets surfaced in the UI.
pub fn presets() -> Vec<RgbProfile> {
    let p = |name: &str, effect: &str, hue: u16, speed: u8| RgbProfile {
        name: name.into(),
        effect: effect.into(),
        hue,
        brightness: 100,
        speed,
        zones: vec![],
    };
    vec![
        p("Nebula", "aurora", 270, 50),
        p("Inferno", "breathing", 12, 60),
        p("Toxic", "pulse", 95, 70),
        p("Ocean", "wave", 200, 45),
        p("Rainbow Flow", "rainbow", 0, 60),
        p("Stealth", "static", 210, 0),
        p("Party", "disco", 0, 90),
        p("Campfire", "candle", 25, 40),
    ]
}

/// Sanitize a profile name into a safe filename stem.
fn safe_stem(name: &str) -> String {
    name.chars()
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

pub struct ProfileStore {
    dir: PathBuf,
}

impl ProfileStore {
    pub fn new() -> Self {
        let base = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
                PathBuf::from(home).join(".config")
            });
        let dir = base.join("nexus").join("rgb");
        let _ = fs::create_dir_all(&dir);
        Self { dir }
    }

    fn path_for(&self, name: &str) -> PathBuf {
        self.dir.join(format!("{}.json", safe_stem(name)))
    }

    pub fn list(&self) -> Vec<RgbProfile> {
        let mut out = Vec::new();
        if let Ok(rd) = fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                if e.path().extension().and_then(|s| s.to_str()) == Some("json") {
                    if let Ok(text) = fs::read_to_string(e.path()) {
                        if let Ok(p) = serde_json::from_str::<RgbProfile>(&text) {
                            out.push(p);
                        }
                    }
                }
            }
        }
        out.sort_by_key(|a| a.name.to_lowercase());
        out
    }

    pub fn save(&self, profile: &RgbProfile) -> Result<(), ControlError> {
        profile.validate()?;
        let json =
            serde_json::to_string_pretty(profile).map_err(|e| ControlError::Io(e.to_string()))?;
        fs::write(self.path_for(&profile.name), json).map_err(|e| ControlError::Io(e.to_string()))
    }

    pub fn load(&self, name: &str) -> Result<RgbProfile, ControlError> {
        let text = fs::read_to_string(self.path_for(name))
            .map_err(|_| ControlError::InvalidParameter(format!("profile '{name}' not found")))?;
        serde_json::from_str(&text).map_err(|e| ControlError::Io(e.to_string()))
    }

    pub fn delete(&self, name: &str) -> Result<(), ControlError> {
        fs::remove_file(self.path_for(name))
            .map_err(|_| ControlError::InvalidParameter(format!("profile '{name}' not found")))
    }

    pub fn export(&self, name: &str) -> Result<String, ControlError> {
        let p = self.load(name)?;
        serde_json::to_string_pretty(&p).map_err(|e| ControlError::Io(e.to_string()))
    }

    /// Import a profile from JSON, validate it, and persist it.
    pub fn import(&self, json: &str) -> Result<RgbProfile, ControlError> {
        let profile: RgbProfile = serde_json::from_str(json)
            .map_err(|e| ControlError::InvalidParameter(format!("invalid theme JSON: {e}")))?;
        profile.validate()?;
        self.save(&profile)?;
        Ok(profile)
    }
}

impl Default for ProfileStore {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_are_valid() {
        for p in presets() {
            assert!(p.validate().is_ok(), "{} invalid", p.name);
        }
    }

    #[test]
    fn profile_to_request_clamps() {
        let p = RgbProfile {
            name: "x".into(),
            effect: "static".into(),
            hue: 400,
            brightness: 100,
            speed: 50,
            zones: vec![],
        };
        let r = p.to_request();
        assert_eq!(r.hue, 40);
        assert_eq!(r.effect, "static");
    }

    #[test]
    fn validate_rejects_bad() {
        let bad = RgbProfile {
            name: "".into(),
            effect: "static".into(),
            hue: 0,
            brightness: 0,
            speed: 0,
            zones: vec![],
        };
        assert!(bad.validate().is_err());
        let bad2 = RgbProfile {
            name: "ok".into(),
            effect: "lava".into(),
            hue: 0,
            brightness: 0,
            speed: 0,
            zones: vec![],
        };
        assert!(bad2.validate().is_err());
    }

    #[test]
    fn safe_stem_strips_unsafe() {
        assert_eq!(safe_stem("../etc/passwd"), "___etc_passwd");
        assert_eq!(safe_stem("My Cool Theme!"), "my_cool_theme_");
    }
}
