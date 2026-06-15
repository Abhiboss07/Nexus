//! Natural Language Command Layer — a DETERMINISTIC intent parser (no LLM, no
//! cloud). It maps a free-text request to a structured action the frontend can
//! execute via the existing IPC, with a confidence and a plain-language response.
//! Capability-aware: it refuses gracefully when a control isn't available.

use serde::Serialize;

use crate::control::capabilities::HardwareCapabilities;
use crate::telemetry::types::Snapshot;

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NlpAction {
    Navigate {
        path: String,
    },
    SetPowerProfile {
        profile: String,
    },
    SetRgb {
        effect: String,
        hue: u16,
    },
    RgbOff,
    ApplyNexusProfile {
        id: String,
    },
    /// Information-only; the answer is in `response`.
    Info,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub understood: bool,
    pub intent: String,
    pub confidence: u8,
    pub response: String,
    pub action: Option<NlpAction>,
}

fn color_hue(word: &str) -> Option<u16> {
    Some(match word {
        "red" => 0,
        "orange" => 30,
        "yellow" => 55,
        "green" => 120,
        "teal" | "cyan" => 175,
        "blue" => 215,
        "purple" | "violet" => 270,
        "pink" | "magenta" => 320,
        "white" => 0, // handled as low-sat elsewhere; keep simple
        _ => return None,
    })
}

fn contains_any(s: &str, words: &[&str]) -> bool {
    words.iter().any(|w| s.contains(w))
}

pub fn parse(
    input: &str,
    caps: &HardwareCapabilities,
    snapshot: Option<&Snapshot>,
) -> CommandResult {
    let q = input.to_lowercase();
    let q = q.trim();

    if q.is_empty() {
        return result(
            false,
            "none",
            0,
            "Type a command like \"boost performance\" or \"make it quieter\".",
            None,
        );
    }

    // ---- Information queries (answered from live telemetry) ----
    if contains_any(q, &["how hot", "temperature", "temps", "how warm"]) {
        if let Some(s) = snapshot {
            let cpu = s
                .cpu
                .temperature_c
                .map(|t| format!("CPU {t:.0}°C"))
                .unwrap_or_default();
            let gpu = s
                .gpu
                .as_ref()
                .and_then(|g| g.temperature_c)
                .map(|t| format!(", GPU {t:.0}°C"))
                .unwrap_or_default();
            return result(
                true,
                "query.temps",
                95,
                &format!("{cpu}{gpu}."),
                Some(NlpAction::Info),
            );
        }
        return result(
            true,
            "query.temps",
            70,
            "Telemetry isn't available yet.",
            Some(NlpAction::Info),
        );
    }
    if contains_any(q, &["battery", "charge"])
        && contains_any(q, &["how", "what", "level", "left", "status"])
    {
        if let Some(s) = snapshot.and_then(|s| s.battery.as_ref()) {
            return result(
                true,
                "query.battery",
                95,
                &format!(
                    "Battery at {:.0}% ({}), health {:.0}%.",
                    s.charge_percent, s.status, s.health_percent
                ),
                Some(NlpAction::Info),
            );
        }
    }

    // ---- Power profile intents ----
    if contains_any(
        q,
        &[
            "turbo",
            "boost",
            "performance",
            "faster",
            "max power",
            "full power",
            "gaming",
        ],
    ) {
        if !caps.power.status.controllable {
            return result(
                true,
                "power.performance",
                80,
                "Power profile control isn't available on this device.",
                None,
            );
        }
        return result(
            true,
            "power.performance",
            92,
            "Switching to the Performance power profile.",
            Some(NlpAction::SetPowerProfile {
                profile: pick_profile(caps, &["performance"]),
            }),
        );
    }
    if contains_any(
        q,
        &[
            "quiet",
            "quieter",
            "silent",
            "silence",
            "low power",
            "save battery",
            "battery saver",
            "saver",
            "cooler",
            "eco",
        ],
    ) {
        if !caps.power.status.controllable {
            return result(
                true,
                "power.saver",
                80,
                "Power profile control isn't available on this device.",
                None,
            );
        }
        return result(
            true,
            "power.saver",
            90,
            "Switching to the Power Saver profile for quiet, efficient operation.",
            Some(NlpAction::SetPowerProfile {
                profile: pick_profile(caps, &["power-saver", "low-power", "quiet"]),
            }),
        );
    }
    if contains_any(q, &["balanced", "normal", "default", "reset power"])
        && caps.power.status.controllable
    {
        return result(
            true,
            "power.balanced",
            88,
            "Switching to the Balanced power profile.",
            Some(NlpAction::SetPowerProfile {
                profile: pick_profile(caps, &["balanced"]),
            }),
        );
    }

    // ---- RGB intents ----
    let rgb_mentioned = contains_any(
        q,
        &[
            "rgb", "light", "lights", "lighting", "keyboard", "color", "colour",
        ],
    );
    if rgb_mentioned || color_word(q).is_some() {
        if !caps.rgb.status.controllable {
            return result(
                true,
                "rgb",
                80,
                "RGB lighting control isn't available on this device.",
                None,
            );
        }
        if contains_any(q, &["off", "turn off", "disable", "dark"]) {
            return result(
                true,
                "rgb.off",
                90,
                "Turning off the keyboard lighting.",
                Some(NlpAction::RgbOff),
            );
        }
        if contains_any(q, &["rainbow"]) {
            return result(
                true,
                "rgb.rainbow",
                90,
                "Setting a rainbow effect.",
                Some(NlpAction::SetRgb {
                    effect: "rainbow".into(),
                    hue: 0,
                }),
            );
        }
        if contains_any(q, &["aurora", "wave", "breathing", "pulse"]) {
            let effect = ["aurora", "wave", "breathing", "pulse"]
                .into_iter()
                .find(|e| q.contains(e))
                .unwrap_or("aurora");
            let hue = color_word(q).unwrap_or(270);
            return result(
                true,
                "rgb.effect",
                88,
                &format!("Setting a {effect} effect."),
                Some(NlpAction::SetRgb {
                    effect: effect.into(),
                    hue,
                }),
            );
        }
        if let Some(hue) = color_word(q) {
            return result(
                true,
                "rgb.color",
                90,
                "Setting the keyboard to your chosen color.",
                Some(NlpAction::SetRgb {
                    effect: "static".into(),
                    hue,
                }),
            );
        }
        return result(
            true,
            "rgb",
            60,
            "Try \"set lights to blue\", \"rainbow\", or \"turn off lights\".",
            None,
        );
    }

    // ---- Nexus profile intents ----
    for (kw, id) in [
        ("coding", "coding"),
        ("streaming", "streaming"),
        ("stream", "streaming"),
    ] {
        if q.contains(kw) {
            return result(
                true,
                "profile",
                85,
                &format!("Applying the {id} profile."),
                Some(NlpAction::ApplyNexusProfile { id: id.into() }),
            );
        }
    }

    // ---- Navigation intents ----
    let pages = [
        ("dashboard", "/"),
        ("performance", "/performance"),
        ("gpu", "/performance"),
        ("rgb", "/rgb"),
        ("battery", "/battery"),
        ("storage", "/storage"),
        ("task", "/tasks"),
        ("doctor", "/doctor"),
        ("game", "/game"),
        ("integration", "/integrations"),
        ("setting", "/settings"),
        ("intelligence", "/intelligence"),
    ];
    if contains_any(q, &["go to", "open", "show", "take me", "navigate"]) {
        for (kw, path) in pages {
            if q.contains(kw) {
                return result(
                    true,
                    "navigate",
                    88,
                    &format!("Opening {kw}."),
                    Some(NlpAction::Navigate { path: path.into() }),
                );
            }
        }
    }

    result(false, "none", 0, "I didn't understand that. Try \"boost performance\", \"make it quieter\", \"set lights to blue\", or \"how hot is the CPU?\".", None)
}

fn color_word(q: &str) -> Option<u16> {
    q.split_whitespace().find_map(color_hue)
}

/// Choose the first preferred profile name that the device actually offers.
fn pick_profile(caps: &HardwareCapabilities, preferred: &[&str]) -> String {
    for p in preferred {
        if caps.power.profiles.iter().any(|x| x == p) {
            return p.to_string();
        }
    }
    // Fall back to the first preferred name even if the list is empty (the engine
    // validates before applying).
    preferred.first().map(|s| s.to_string()).unwrap_or_default()
}

fn result(
    understood: bool,
    intent: &str,
    confidence: u8,
    response: &str,
    action: Option<NlpAction>,
) -> CommandResult {
    CommandResult {
        understood,
        intent: intent.into(),
        confidence,
        response: response.into(),
        action,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control::capabilities::*;
    use crate::telemetry::hardware::Vendor;

    fn caps(power: bool, rgb: bool) -> HardwareCapabilities {
        let mut c = HardwareCapabilities {
            vendor: Vendor::Omen,
            vendor_label: "x".into(),
            rgb: RgbCapability::default(),
            fan: FanCapability::default(),
            power: PowerCapability::default(),
            battery: BatteryCapability::default(),
            mux: MuxCapability::default(),
        };
        c.power.status.controllable = power;
        c.power.profiles = vec![
            "performance".into(),
            "balanced".into(),
            "power-saver".into(),
        ];
        c.rgb.status.controllable = rgb;
        c
    }

    #[test]
    fn boost_maps_to_performance() {
        let r = parse("boost performance now", &caps(true, true), None);
        assert!(
            matches!(r.action, Some(NlpAction::SetPowerProfile { ref profile }) if profile == "performance")
        );
        assert!(r.confidence > 80);
    }

    #[test]
    fn quieter_maps_to_saver() {
        let r = parse("make it quieter please", &caps(true, true), None);
        assert!(
            matches!(r.action, Some(NlpAction::SetPowerProfile { ref profile }) if profile == "power-saver")
        );
    }

    #[test]
    fn color_sets_rgb_static_with_hue() {
        let r = parse("set the keyboard to blue", &caps(true, true), None);
        assert!(
            matches!(r.action, Some(NlpAction::SetRgb { ref effect, hue }) if effect == "static" && hue == 215)
        );
    }

    #[test]
    fn capability_gated_refuses_gracefully() {
        let r = parse("set lights to red", &caps(true, false), None);
        assert!(r.understood);
        assert!(r.action.is_none());
        assert!(r.response.contains("isn't available"));
    }

    #[test]
    fn unknown_input_not_understood() {
        let r = parse("make me a sandwich", &caps(true, true), None);
        assert!(!r.understood);
    }
}
