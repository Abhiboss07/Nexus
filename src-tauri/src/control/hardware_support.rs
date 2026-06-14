//! Multi-hardware safety gate (Release Hardening Sprint).
//!
//! Capability detection answers *"does this control interface exist and work
//! on this box?"*. This module adds a **second, default-deny layer** that asks
//! a stricter question: *"have we actually validated writing through this exact
//! interface?"*.
//!
//! Rationale (audit finding C1): fan-curve and RGB writes go to root-owned
//! firmware-backed sysfs nodes. A driver on an untested OMEN/Victus board
//! revision may expose an interface string we have never exercised. Trusting
//! the driver's `controllable` flag alone risks pushing a malformed fan curve
//! into firmware. So writes are permitted **only** through interface
//! identifiers on an explicit allowlist; everything else is treated as UNKNOWN
//! and *all* hardware-write paths are disabled — telemetry stays fully read-only
//! and safe.
//!
//! Power profiles are intentionally *not* gated here: they go through
//! `power-profiles-daemon`/polkit, a distro-standard, non-firmware,
//! permission-mediated path that is safe on any machine that exposes it.

use serde::Serialize;

use super::capabilities::HardwareCapabilities;
use crate::telemetry::hardware::{HardwareProfile, Vendor};

/// Fan interface identifiers we have validated end-to-end (driver `fan_iface`).
pub const VALIDATED_FAN_IFACES: &[&str] = &["victus-s"];

/// RGB platform identifiers we have validated end-to-end.
pub const VALIDATED_RGB_PLATFORMS: &[&str] = &["omen-rgb-keyboard"];

/// Reference boards the project is directly validated on (DMI `board_name`).
pub const VALIDATED_BOARDS: &[&str] = &["8BA9"];

/// How well-validated the running hardware is for *write* operations.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SupportTier {
    /// A reference board we directly validate against. Full writes.
    Validated,
    /// Recognized HP OMEN/Victus reaching a validated control interface
    /// (e.g. the Victus-S fan interface). Writes allowed through that interface.
    Compatible,
    /// Recognized vendor but no validated control interface present.
    /// Read-only — all write paths disabled.
    Unknown,
    /// Not an HP OMEN/Victus, or no controllable interface at all.
    /// Read-only — all write paths disabled.
    Unsupported,
}

impl SupportTier {
    pub fn label(self) -> &'static str {
        match self {
            SupportTier::Validated => "Validated",
            SupportTier::Compatible => "Compatible",
            SupportTier::Unknown => "Unknown (read-only)",
            SupportTier::Unsupported => "Unsupported (read-only)",
        }
    }
}

/// Primitive inputs to the gate — kept free of any live system calls so the
/// decision is a pure function and fully unit-testable off-device.
#[derive(Debug, Clone)]
pub struct GateInputs<'a> {
    pub vendor: Vendor,
    pub board_name: &'a str,
    /// Driver fan interface id: "victus-s" | "classic" | "none" | "unknown".
    pub fan_iface: &'a str,
    /// Whether the driver loaded a valid fan table (authoritative for curves).
    pub fan_table_valid: bool,
    /// RGB platform/driver id, or "" when absent.
    pub rgb_platform: &'a str,
}

/// The resolved write policy for the running hardware.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteGate {
    pub tier: SupportTier,
    pub fan_writes: bool,
    pub rgb_writes: bool,
    pub notes: Vec<String>,
}

fn is_hp_gaming(vendor: Vendor) -> bool {
    matches!(vendor, Vendor::Omen | Vendor::Victus)
}

fn iface_validated(iface: &str) -> bool {
    let i = iface.to_ascii_lowercase();
    VALIDATED_FAN_IFACES.iter().any(|v| i == *v)
}

fn rgb_validated(platform: &str) -> bool {
    let p = platform.to_ascii_lowercase();
    !p.is_empty() && VALIDATED_RGB_PLATFORMS.iter().any(|v| p.contains(v))
}

impl WriteGate {
    /// Evaluate the write policy from primitive inputs (pure, testable).
    pub fn evaluate(input: &GateInputs) -> Self {
        let hp = is_hp_gaming(input.vendor);
        let fan_ok = hp && iface_validated(input.fan_iface) && input.fan_table_valid;
        let rgb_ok = hp && rgb_validated(input.rgb_platform);

        let board_known = VALIDATED_BOARDS
            .iter()
            .any(|b| b.eq_ignore_ascii_case(input.board_name.trim()));

        let tier = if hp && fan_ok && board_known {
            SupportTier::Validated
        } else if hp && (fan_ok || rgb_ok) {
            SupportTier::Compatible
        } else if hp {
            SupportTier::Unknown
        } else {
            SupportTier::Unsupported
        };

        let mut notes = Vec::new();
        if !hp {
            notes.push(format!(
                "{} is not an HP OMEN/Victus — hardware control disabled; telemetry only.",
                input.vendor.label()
            ));
        } else {
            if !fan_ok {
                notes.push(format!(
                    "Fan writes disabled: interface '{}' (table_valid={}) is not on the validated allowlist {:?}.",
                    input.fan_iface, input.fan_table_valid, VALIDATED_FAN_IFACES
                ));
            }
            if !rgb_ok {
                notes.push(format!(
                    "RGB writes disabled: platform '{}' is not on the validated allowlist {:?}.",
                    if input.rgb_platform.is_empty() { "<none>" } else { input.rgb_platform },
                    VALIDATED_RGB_PLATFORMS
                ));
            }
        }
        if tier == SupportTier::Compatible && !board_known {
            notes.push(format!(
                "Board '{}' is recognized-compatible but not a reference board; writes use the validated interface but are not board-certified.",
                input.board_name
            ));
        }

        WriteGate { tier, fan_writes: fan_ok, rgb_writes: rgb_ok, notes }
    }

    /// Enforce the gate on the capability set so the **UI also hides** controls
    /// it must not show (defense in depth alongside the backend refusals).
    pub fn apply_to(&self, caps: &mut HardwareCapabilities) {
        if !self.fan_writes && caps.fan.status.controllable {
            caps.fan.status.controllable = false;
            caps.fan.status.notes = "Disabled on unvalidated hardware (safety gate)".into();
        }
        if !self.rgb_writes && caps.rgb.status.controllable {
            caps.rgb.status.controllable = false;
            caps.rgb.status.notes = "Disabled on unvalidated hardware (safety gate)".into();
        }
    }
}

/// Serializable compatibility report for the `get_compatibility` command and
/// the diagnostics export.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompatibilityReport {
    pub tier: SupportTier,
    pub tier_label: String,
    pub vendor: String,
    pub product: String,
    pub board: String,
    pub fan_interface: String,
    pub fan_writes: bool,
    pub rgb_writes: bool,
    pub power_controllable: bool,
    pub summary: String,
    pub notes: Vec<String>,
}

impl CompatibilityReport {
    pub fn build(
        profile: &HardwareProfile,
        gate: &WriteGate,
        fan_iface: &str,
        power_controllable: bool,
    ) -> Self {
        let summary = match gate.tier {
            SupportTier::Validated => "Reference hardware — all supported controls enabled.".into(),
            SupportTier::Compatible => "Compatible hardware — controls enabled through validated interfaces.".into(),
            SupportTier::Unknown => "Recognized vendor without a validated control interface — running read-only.".into(),
            SupportTier::Unsupported => "Unsupported hardware — running in read-only telemetry mode.".into(),
        };
        CompatibilityReport {
            tier: gate.tier,
            tier_label: gate.tier.label().into(),
            vendor: profile.vendor_label.clone(),
            product: profile.product_name.clone(),
            board: profile.board_name.clone(),
            fan_interface: fan_iface.to_string(),
            fan_writes: gate.fan_writes,
            rgb_writes: gate.rgb_writes,
            power_controllable,
            summary,
            notes: gate.notes.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn omen(board: &str, fan: &str, table: bool, rgb: &str) -> GateInputs<'static> {
        // Leak small test strings to get 'static lifetimes cheaply in tests.
        GateInputs {
            vendor: Vendor::Omen,
            board_name: Box::leak(board.to_string().into_boxed_str()),
            fan_iface: Box::leak(fan.to_string().into_boxed_str()),
            fan_table_valid: table,
            rgb_platform: Box::leak(rgb.to_string().into_boxed_str()),
        }
    }

    #[test]
    fn reference_board_is_validated_with_writes() {
        let g = WriteGate::evaluate(&omen("8BA9", "victus-s", true, "omen-rgb-keyboard"));
        assert_eq!(g.tier, SupportTier::Validated);
        assert!(g.fan_writes && g.rgb_writes);
    }

    #[test]
    fn other_omen_board_with_validated_iface_is_compatible() {
        let g = WriteGate::evaluate(&omen("9XYZ", "victus-s", true, "omen-rgb-keyboard"));
        assert_eq!(g.tier, SupportTier::Compatible);
        assert!(g.fan_writes && g.rgb_writes);
    }

    #[test]
    fn unknown_fan_iface_disables_fan_writes() {
        let g = WriteGate::evaluate(&omen("9XYZ", "victus-x-new", true, "omen-rgb-keyboard"));
        // RGB still ok, but the never-tested fan interface must NOT get writes.
        assert!(!g.fan_writes);
        assert!(g.rgb_writes);
        assert_eq!(g.tier, SupportTier::Compatible); // rgb keeps it compatible
    }

    #[test]
    fn victus_s_without_table_disables_fan_writes() {
        let g = WriteGate::evaluate(&omen("8BA9", "victus-s", false, ""));
        assert!(!g.fan_writes);
        // No validated rgb either → recognized vendor but nothing validated.
        assert_eq!(g.tier, SupportTier::Unknown);
    }

    #[test]
    fn non_hp_is_unsupported_readonly() {
        let g = WriteGate::evaluate(&GateInputs {
            vendor: Vendor::Rog,
            board_name: "X670E",
            fan_iface: "asus-nb-wmi",
            fan_table_valid: true,
            rgb_platform: "asusctl",
        });
        assert_eq!(g.tier, SupportTier::Unsupported);
        assert!(!g.fan_writes && !g.rgb_writes);
    }

    #[test]
    fn generic_machine_blocks_all_writes() {
        let g = WriteGate::evaluate(&GateInputs {
            vendor: Vendor::Generic,
            board_name: "",
            fan_iface: "unknown",
            fan_table_valid: false,
            rgb_platform: "",
        });
        assert_eq!(g.tier, SupportTier::Unsupported);
        assert!(!g.fan_writes && !g.rgb_writes);
    }
}
