//! Fan profiles — built-in presets (Silent / Balanced / Gaming / Turbo /
//! Custom), persistence, and import/export. A profile composes a thermal
//! profile, an optional custom curve, and a max-fan flag.

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::control::validate_curve_safe;
use super::engine::CurvePoint;
use crate::control::traits::ControlError;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FanProfile {
    pub name: String,
    #[serde(default)]
    pub builtin: bool,
    /// performance | normal | silent
    pub thermal_profile: Option<String>,
    /// Custom temp→pct curve (empty = use firmware curve).
    #[serde(default)]
    pub curve: Vec<CurvePoint>,
    #[serde(default)]
    pub max_fan: bool,
}

impl FanProfile {
    pub fn validate(&self) -> Result<(), ControlError> {
        if self.name.trim().is_empty() {
            return Err(ControlError::InvalidParameter(
                "profile name required".into(),
            ));
        }
        if let Some(tp) = &self.thermal_profile {
            if !["performance", "normal", "silent"].contains(&tp.as_str()) {
                return Err(ControlError::InvalidParameter(format!(
                    "bad thermal profile '{tp}'"
                )));
            }
        }
        if !self.curve.is_empty() {
            validate_curve_safe(&self.curve)?;
        }
        Ok(())
    }
}

fn cp(t: u32, p: u32) -> CurvePoint {
    CurvePoint { temp_c: t, pct: p }
}

pub fn presets() -> Vec<FanProfile> {
    vec![
        FanProfile {
            name: "Silent".into(),
            builtin: true,
            thermal_profile: Some("silent".into()),
            curve: vec![cp(50, 20), cp(65, 35), cp(80, 60), cp(90, 80)],
            max_fan: false,
        },
        FanProfile {
            name: "Balanced".into(),
            builtin: true,
            thermal_profile: Some("normal".into()),
            curve: vec![cp(45, 25), cp(60, 40), cp(75, 65), cp(88, 90)],
            max_fan: false,
        },
        FanProfile {
            name: "Gaming".into(),
            builtin: true,
            thermal_profile: Some("performance".into()),
            curve: vec![cp(45, 35), cp(60, 55), cp(75, 80), cp(88, 100)],
            max_fan: false,
        },
        FanProfile {
            name: "Turbo".into(),
            builtin: true,
            thermal_profile: Some("performance".into()),
            curve: vec![],
            max_fan: true,
        },
        FanProfile {
            name: "Custom".into(),
            builtin: true,
            thermal_profile: None,
            curve: vec![cp(45, 20), cp(60, 45), cp(75, 70), cp(88, 100)],
            max_fan: false,
        },
    ]
}

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

pub struct FanProfileStore {
    dir: PathBuf,
}

impl FanProfileStore {
    pub fn new() -> Self {
        let base = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
                    .join(".config")
            });
        let dir = base.join("nexus").join("fan");
        let _ = fs::create_dir_all(&dir);
        Self { dir }
    }

    pub fn list(&self) -> Vec<FanProfile> {
        let mut profiles = presets();
        if let Ok(rd) = fs::read_dir(&self.dir) {
            for e in rd.flatten() {
                if e.path().extension().and_then(|s| s.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(text) = fs::read_to_string(e.path()) {
                    if let Ok(p) = serde_json::from_str::<FanProfile>(&text) {
                        if let Some(existing) = profiles.iter_mut().find(|x| x.name == p.name) {
                            *existing = p;
                        } else {
                            profiles.push(p);
                        }
                    }
                }
            }
        }
        profiles
    }

    pub fn get(&self, name: &str) -> Option<FanProfile> {
        self.list()
            .into_iter()
            .find(|p| p.name.eq_ignore_ascii_case(name))
    }

    pub fn save(&self, profile: &FanProfile) -> Result<(), ControlError> {
        profile.validate()?;
        let json =
            serde_json::to_string_pretty(profile).map_err(|e| ControlError::Io(e.to_string()))?;
        fs::write(
            self.dir.join(format!("{}.json", safe_stem(&profile.name))),
            json,
        )
        .map_err(|e| ControlError::Io(e.to_string()))
    }

    pub fn delete(&self, name: &str) -> Result<(), ControlError> {
        let path = self.dir.join(format!("{}.json", safe_stem(name)));
        if path.exists() {
            fs::remove_file(path).map_err(|e| ControlError::Io(e.to_string()))
        } else {
            Ok(())
        }
    }

    pub fn export(&self, name: &str) -> Result<String, ControlError> {
        let p = self
            .get(name)
            .ok_or_else(|| ControlError::InvalidParameter(format!("profile '{name}' not found")))?;
        serde_json::to_string_pretty(&p).map_err(|e| ControlError::Io(e.to_string()))
    }

    pub fn import(&self, json: &str) -> Result<FanProfile, ControlError> {
        let mut profile: FanProfile = serde_json::from_str(json).map_err(|e| {
            ControlError::InvalidParameter(format!("invalid fan profile JSON: {e}"))
        })?;
        profile.builtin = false;
        profile.validate()?;
        self.save(&profile)?;
        Ok(profile)
    }
}

impl Default for FanProfileStore {
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
    fn import_rejects_unsafe_curve() {
        // A curve that drops to 0% at high temp must be rejected.
        let json = r#"{"name":"Bad","thermalProfile":null,"curve":[{"tempC":45,"pct":50},{"tempC":95,"pct":0}],"maxFan":false}"#;
        assert!(FanProfileStore::new().import(json).is_err());
        let p: FanProfile = serde_json::from_str(json).unwrap();
        assert!(p.validate().is_err());
    }
}
