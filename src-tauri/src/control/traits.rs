//! Controller trait hierarchy + shared control types.
//!
//! Phase 2B defines the *interfaces* only. Every write method is present so the
//! registry, capability gating and IPC are fully wired, but bodies return
//! `ControlError::NotImplemented` — real hardware writes land in Phase 3. The
//! dry-run/preview path (see `service.rs`) exercises the framework without ever
//! touching hardware.

use serde::{Deserialize, Serialize};
use std::fmt;

use crate::telemetry::hardware::Vendor;

/// Structured failure modes for any control operation.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", content = "detail", rename_all = "camelCase")]
pub enum ControlError {
    /// The hardware/driver doesn't expose this capability at all.
    Unsupported,
    /// Capability exists but writes are blocked because this exact hardware
    /// interface has not been validated (multi-hardware safety gate, finding C1).
    HardwareNotValidated(String),
    /// Capability exists but the write path isn't implemented yet (Phase 3).
    NotImplemented,
    /// A required driver/daemon (hp-wmi, OpenRGB, supergfxctl…) is unavailable.
    DriverUnavailable(String),
    /// Operation needs elevated privileges (e.g. writing sysfs as root).
    PermissionDenied,
    /// The caller passed an out-of-range or malformed value.
    InvalidParameter(String),
    /// Low-level I/O failure.
    Io(String),
}

impl fmt::Display for ControlError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ControlError::Unsupported => write!(f, "capability not supported on this device"),
            ControlError::HardwareNotValidated(d) => write!(f, "blocked on unvalidated hardware: {d}"),
            ControlError::NotImplemented => write!(f, "control not implemented yet (Phase 3)"),
            ControlError::DriverUnavailable(d) => write!(f, "driver unavailable: {d}"),
            ControlError::PermissionDenied => write!(f, "permission denied"),
            ControlError::InvalidParameter(p) => write!(f, "invalid parameter: {p}"),
            ControlError::Io(e) => write!(f, "io error: {e}"),
        }
    }
}

impl std::error::Error for ControlError {}

/// Result of a (planned or applied) control operation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlOutcome {
    /// Whether the change was actually written to hardware. Always false in 2B.
    pub applied: bool,
    /// Whether this was a validation-only dry run.
    pub dry_run: bool,
    /// Human-readable description of what happened / would happen.
    pub message: String,
}

impl ControlOutcome {
    pub fn planned(message: impl Into<String>) -> Self {
        Self { applied: false, dry_run: true, message: message.into() }
    }
}

pub type ControlResult = Result<ControlOutcome, ControlError>;

/* ------------------------------------------------------------------------- */
/* Request payloads (deserialized from the UI; validated, never vendor-aware) */
/* ------------------------------------------------------------------------- */

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RgbRequest {
    pub effect: String,
    pub hue: u16,
    pub brightness: u8,
    pub speed: u8,
    pub zone: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FanRequest {
    pub mode: String,
    pub speed_percent: Option<u8>,
    pub fan: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerRequest {
    pub profile: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryRequest {
    pub charge_limit: u8,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MuxRequest {
    pub mode: String,
}

/* ------------------------------------------------------------------------- */
/* Controller traits                                                          */
/* ------------------------------------------------------------------------- */

/// Common identity all controllers share. `Send + Sync` so controllers can live
/// in shared application state.
pub trait Controller: Send + Sync {
    fn name(&self) -> &'static str;
    fn vendor(&self) -> Vendor;
}

/// Current lighting state read back from the device.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RgbState {
    pub effect: String,
    pub brightness: u8,
    pub speed: u8,
    /// Per-zone color as `#rrggbb`.
    pub zones: Vec<String>,
}

pub trait RgbController: Controller {
    fn set(&self, req: &RgbRequest) -> ControlResult;
    fn off(&self) -> ControlResult;
    /// Read current hardware state (None if unreadable).
    fn state(&self) -> Option<RgbState>;
    /// Number of addressable zones.
    fn zone_count(&self) -> u32;
}

pub trait FanController: Controller {
    /// Apply a fan mode / manual speed.
    fn set(&self, req: &FanRequest) -> ControlResult;
    /// Hand control back to automatic/firmware curve.
    fn auto(&self) -> ControlResult;
}

pub trait PowerController: Controller {
    fn set_profile(&self, req: &PowerRequest) -> ControlResult;
    fn available_profiles(&self) -> Vec<String>;
    /// Currently active profile, if readable (default: unknown).
    fn current_profile(&self) -> Option<String> {
        None
    }
}

pub trait BatteryController: Controller {
    fn set_charge_limit(&self, req: &BatteryRequest) -> ControlResult;
}

pub trait MuxController: Controller {
    fn set_mode(&self, req: &MuxRequest) -> ControlResult;
}
