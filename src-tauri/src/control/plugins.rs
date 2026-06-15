//! Minimal, real plugin registry. Plugins are JSON manifests dropped into
//! `~/.config/nexus/plugins/*.json`; their enabled/disabled state persists in
//! `plugins-state.json`. There is no fake "marketplace" — the list reflects
//! exactly what is installed on disk (empty until the user adds a manifest),
//! which is honest about the current capability.

use std::collections::HashMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    /// What the plugin integrates with (informational).
    #[serde(default)]
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plugin {
    #[serde(flatten)]
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub source: String,
}

fn config_dir() -> PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())).join(".config")
        });
    base.join("nexus")
}

fn plugins_dir() -> PathBuf {
    config_dir().join("plugins")
}

fn state_path() -> PathBuf {
    config_dir().join("plugins-state.json")
}

fn load_state() -> HashMap<String, bool> {
    std::fs::read_to_string(state_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_state(state: &HashMap<String, bool>) {
    let _ = std::fs::create_dir_all(config_dir());
    if let Ok(json) = serde_json::to_string_pretty(state) {
        let _ = std::fs::write(state_path(), json);
    }
}

/// List installed plugins (manifests on disk) with their persisted enabled flag.
pub fn list() -> Vec<Plugin> {
    let dir = plugins_dir();
    let _ = std::fs::create_dir_all(&dir);
    let state = load_state();
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(&dir) {
        for e in rd.flatten() {
            let path = e.path();
            if path.extension().map(|x| x == "json").unwrap_or(false) {
                if let Ok(text) = std::fs::read_to_string(&path) {
                    if let Ok(m) = serde_json::from_str::<PluginManifest>(&text) {
                        let enabled = *state.get(&m.id).unwrap_or(&true);
                        out.push(Plugin {
                            source: path.to_string_lossy().to_string(),
                            enabled,
                            manifest: m,
                        });
                    }
                }
            }
        }
    }
    out.sort_by_key(|a| a.manifest.name.to_lowercase());
    out
}

/// Toggle a plugin on/off (persisted). Returns the new state.
pub fn set_enabled(id: &str, enabled: bool) -> bool {
    let mut state = load_state();
    state.insert(id.to_string(), enabled);
    save_state(&state);
    enabled
}

/// Absolute path of the plugins directory (shown in the UI so users know where
/// to drop manifests).
pub fn directory() -> String {
    plugins_dir().to_string_lossy().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_is_empty_or_valid() {
        // Should never panic, even with no plugins dir.
        let _ = list();
    }
}
