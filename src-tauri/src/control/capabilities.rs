//! `HardwareCapabilities` — the serializable description of what this machine can
//! do, produced by the `CapabilityDetector`. The frontend consumes this to
//! enable/disable controls. It is intentionally vendor-neutral: the UI reasons
//! about *capabilities*, never about which vendor produced them.

use serde::Serialize;

use crate::telemetry::hardware::Vendor;

/// Shared status block carried by every capability.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityStatus {
    /// The capability physically exists / can be read.
    pub available: bool,
    /// The capability can be *written* (a control path exists).
    pub controllable: bool,
    /// The driver/daemon/interface backing it (e.g. "hp-wmi", "openrgb", "platform_profile").
    pub driver: String,
    /// Short human note shown in tooltips when a control is disabled.
    pub notes: String,
}

impl CapabilityStatus {
    pub fn unavailable(notes: impl Into<String>) -> Self {
        Self { available: false, controllable: false, driver: String::new(), notes: notes.into() }
    }
    pub fn read_only(driver: impl Into<String>, notes: impl Into<String>) -> Self {
        Self { available: true, controllable: false, driver: driver.into(), notes: notes.into() }
    }
    pub fn full(driver: impl Into<String>) -> Self {
        Self { available: true, controllable: true, driver: driver.into(), notes: String::new() }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RgbCapability {
    pub status: CapabilityStatus,
    pub zones: u32,
    pub per_key: bool,
    pub effects: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FanCapability {
    pub status: CapabilityStatus,
    pub fan_count: u32,
    pub manual_pwm: bool,
    pub modes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PowerCapability {
    pub status: CapabilityStatus,
    pub profiles: Vec<String>,
    pub current_profile: Option<String>,
    pub tunable_tdp: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatteryCapability {
    pub status: CapabilityStatus,
    pub charge_limit: bool,
    pub conservation_mode: bool,
    pub limit_range: Option<(u8, u8)>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MuxCapability {
    pub status: CapabilityStatus,
    pub modes: Vec<String>,
    pub current_mode: Option<String>,
    pub requires_reboot: bool,
}

/// The complete capability set for the running machine.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareCapabilities {
    pub vendor: Vendor,
    pub vendor_label: String,
    pub rgb: RgbCapability,
    pub fan: FanCapability,
    pub power: PowerCapability,
    pub battery: BatteryCapability,
    pub mux: MuxCapability,
}
