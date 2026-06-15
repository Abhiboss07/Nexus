//! Profile automation. Rules map a system condition to a Nexus profile; the
//! evaluator is a pure function (unit-tested), and a background watcher (in
//! `lib.rs`) gathers live context, evaluates, and applies on change.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Trigger {
    /// Any running process whose name contains this substring (e.g. "steam").
    ProcessRunning { process: String },
    /// Battery charge strictly below this percent.
    BatteryBelow { percent: u8 },
    /// AC adapter connected (true) or on battery (false).
    AcConnected { connected: bool },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: String,
    pub trigger: Trigger,
    pub profile_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationConfig {
    pub enabled: bool,
    pub rules: Vec<Rule>,
}

impl Default for AutomationConfig {
    fn default() -> Self {
        let rule = |id: &str, trigger: Trigger, profile: &str| Rule {
            id: id.into(),
            trigger,
            profile_id: profile.into(),
            enabled: true,
        };
        Self {
            // Off by default — opt-in so Nexus never changes state unprompted.
            enabled: false,
            rules: vec![
                rule(
                    "steam-gaming",
                    Trigger::ProcessRunning {
                        process: "steam".into(),
                    },
                    "gaming",
                ),
                rule(
                    "code-coding",
                    Trigger::ProcessRunning {
                        process: "code".into(),
                    },
                    "coding",
                ),
                rule(
                    "obs-streaming",
                    Trigger::ProcessRunning {
                        process: "obs".into(),
                    },
                    "streaming",
                ),
                rule(
                    "low-battery",
                    Trigger::BatteryBelow { percent: 20 },
                    "battery-saver",
                ),
            ],
        }
    }
}

/// Live system context the rules are evaluated against.
#[derive(Debug, Clone, Default)]
pub struct SystemContext {
    pub processes: HashSet<String>,
    pub battery_percent: Option<u8>,
    pub ac_online: bool,
}

/// Resolve which profile should be active, or `None` if no rule matches.
/// Rules are priority-ordered: the first enabled match wins.
pub fn evaluate(cfg: &AutomationConfig, ctx: &SystemContext) -> Option<String> {
    if !cfg.enabled {
        return None;
    }
    for rule in &cfg.rules {
        if !rule.enabled {
            continue;
        }
        let hit = match &rule.trigger {
            Trigger::ProcessRunning { process } => {
                let needle = process.to_lowercase();
                ctx.processes.iter().any(|p| p.contains(&needle))
            }
            Trigger::BatteryBelow { percent } => ctx.battery_percent.is_some_and(|b| b < *percent),
            Trigger::AcConnected { connected } => ctx.ac_online == *connected,
        };
        if hit {
            return Some(rule.profile_id.clone());
        }
    }
    None
}

/// Gather live context from the system (used by the watcher thread).
pub fn gather_context() -> SystemContext {
    let mut processes = HashSet::new();
    if let Ok(rd) = std::fs::read_dir("/proc") {
        for e in rd.flatten() {
            let name = e.file_name();
            let pid = name.to_string_lossy();
            if !pid.bytes().all(|b| b.is_ascii_digit()) {
                continue;
            }
            if let Ok(comm) = std::fs::read_to_string(format!("/proc/{pid}/comm")) {
                processes.insert(comm.trim().to_lowercase());
            }
        }
    }

    let battery_percent = [
        "/sys/class/power_supply/BAT0",
        "/sys/class/power_supply/BAT1",
    ]
    .into_iter()
    .find_map(|b| std::fs::read_to_string(format!("{b}/capacity")).ok())
    .and_then(|s| s.trim().parse::<u8>().ok());

    SystemContext {
        processes,
        battery_percent,
        ac_online: super::power::engine::ac_online(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx(procs: &[&str], battery: Option<u8>, ac: bool) -> SystemContext {
        SystemContext {
            processes: procs.iter().map(|s| s.to_string()).collect(),
            battery_percent: battery,
            ac_online: ac,
        }
    }

    #[test]
    fn disabled_config_never_matches() {
        let mut cfg = AutomationConfig::default();
        cfg.enabled = false;
        assert_eq!(evaluate(&cfg, &ctx(&["steam"], Some(50), true)), None);
    }

    #[test]
    fn process_rule_wins_by_priority() {
        let mut cfg = AutomationConfig::default();
        cfg.enabled = true;
        // steam running + low battery → gaming wins (higher priority).
        assert_eq!(
            evaluate(&cfg, &ctx(&["steam", "bash"], Some(10), false)).as_deref(),
            Some("gaming")
        );
    }

    #[test]
    fn low_battery_matches_when_no_process() {
        let mut cfg = AutomationConfig::default();
        cfg.enabled = true;
        assert_eq!(
            evaluate(&cfg, &ctx(&["bash"], Some(15), false)).as_deref(),
            Some("battery-saver")
        );
    }

    #[test]
    fn disabled_rule_is_skipped() {
        let mut cfg = AutomationConfig::default();
        cfg.enabled = true;
        cfg.rules[0].enabled = false; // disable steam→gaming
        assert_eq!(evaluate(&cfg, &ctx(&["steam"], Some(80), true)), None);
    }
}
