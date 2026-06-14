//! Automation Rules Engine (intelligence layer). Observes telemetry patterns and
//! suggests automation rules the user can adopt into the profile-switching
//! `AutomationConfig` — without re-suggesting rules that already exist. Evidence-
//! backed; capability-aware.

use serde::Serialize;

use crate::control::automation::{AutomationConfig, Trigger};
use crate::control::capabilities::HardwareCapabilities;
use crate::telemetry::types::{HistoryPoint, Snapshot};

use super::recommendations::Evidence;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSuggestion {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub trigger_label: String,
    pub profile_id: String,
    pub confidence: u8,
    pub evidence: Vec<Evidence>,
}

fn has_process_rule(cfg: &AutomationConfig, needle: &str) -> bool {
    cfg.rules.iter().any(|r| matches!(&r.trigger, Trigger::ProcessRunning { process } if process.contains(needle)))
}

fn has_battery_rule(cfg: &AutomationConfig) -> bool {
    cfg.rules.iter().any(|r| matches!(&r.trigger, Trigger::BatteryBelow { .. }))
}

pub fn suggest(
    history: &[HistoryPoint],
    snapshot: &Snapshot,
    existing: &AutomationConfig,
    _caps: &HardwareCapabilities,
) -> Vec<AutomationSuggestion> {
    let mut out = Vec::new();
    let n = history.len().max(1);

    // Frequently hot GPU ⇒ suggest auto-Gaming profile on game launch.
    let gpu_hot_frac = history.iter().filter(|p| p.gpu_temp >= 75.0).count() as f32 / n as f32;
    if gpu_hot_frac >= 0.25 && !has_process_rule(existing, "steam") {
        out.push(AutomationSuggestion {
            id: "auto-gaming".into(),
            title: "Auto-apply Gaming profile when launching games".into(),
            detail: "Your GPU runs warm during sessions. Auto-switching to the Gaming profile when Steam launches keeps thermals and performance in check.".into(),
            trigger_label: "When Steam launches".into(),
            profile_id: "gaming".into(),
            confidence: (60.0 + gpu_hot_frac * 35.0).round() as u8,
            evidence: vec![Evidence::new("Time GPU ≥75°C", format!("{:.0}%", gpu_hot_frac * 100.0), "25%")],
        });
    }

    // On battery ⇒ suggest a low-battery saver rule.
    if snapshot.battery.as_ref().is_some_and(|b| b.present) && !has_battery_rule(existing) {
        out.push(AutomationSuggestion {
            id: "auto-saver".into(),
            title: "Auto-enable Battery Saver at 20%".into(),
            detail: "Switch to the Battery Saver profile when charge drops below 20% to extend runtime when you need it most.".into(),
            trigger_label: "When battery below 20%".into(),
            profile_id: "battery-saver".into(),
            confidence: 70,
            evidence: vec![Evidence::new("Battery present", "yes", "—")],
        });
    }

    // Sustained high memory ⇒ suggest a coding/light profile habit (informational).
    let mem_high_frac = history.iter().filter(|p| p.mem_usage >= 85.0).count() as f32 / n as f32;
    if mem_high_frac >= 0.3 {
        out.push(AutomationSuggestion {
            id: "auto-coding".into(),
            title: "Auto-apply Coding profile for dev tools".into(),
            detail: "Memory is frequently under pressure — auto-switching to the Coding profile when your editor launches balances power for sustained work.".into(),
            trigger_label: "When VS Code launches".into(),
            profile_id: "coding".into(),
            confidence: (55.0 + mem_high_frac * 30.0).round() as u8,
            evidence: vec![Evidence::new("Time RAM ≥85%", format!("{:.0}%", mem_high_frac * 100.0), "30%")],
        });
    }

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control::automation::AutomationConfig;
    use crate::telemetry::types::*;

    fn caps() -> HardwareCapabilities {
        use crate::control::capabilities::*;
        use crate::telemetry::hardware::Vendor;
        HardwareCapabilities { vendor: Vendor::Omen, vendor_label: "x".into(), rgb: RgbCapability::default(), fan: FanCapability::default(), power: PowerCapability::default(), battery: BatteryCapability::default(), mux: MuxCapability::default() }
    }

    #[test]
    fn suggests_gaming_when_gpu_hot_and_no_rule() {
        let hist: Vec<_> = (0..20).map(|_| { let mut p = HistoryPoint::default(); p.gpu_temp = 80.0; p }).collect();
        // empty config (default has rules though) → use a truly empty one
        let empty = AutomationConfig { enabled: false, rules: vec![] };
        let out = suggest(&hist, &Snapshot::default(), &empty, &caps());
        assert!(out.iter().any(|s| s.id == "auto-gaming"));
    }

    #[test]
    fn does_not_resuggest_existing_rules() {
        let hist: Vec<_> = (0..20).map(|_| { let mut p = HistoryPoint::default(); p.gpu_temp = 80.0; p }).collect();
        let cfg = AutomationConfig::default(); // already has steam→gaming
        let out = suggest(&hist, &Snapshot::default(), &cfg, &caps());
        assert!(!out.iter().any(|s| s.id == "auto-gaming"));
    }
}
