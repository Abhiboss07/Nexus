//! Power controllers. Three backends behind the `PowerController` trait:
//!   * `LinuxPowerController`   — power-profiles-daemon (preferred desktop API)
//!   * `OmenPowerController`    — HP `platform_profile` (ACPI firmware profiles)
//!   * `GenericPowerController` — `platform_profile`, else cpufreq governor
//!
//! All writes go through the shared SafeWriter (validation + rollback).

use std::sync::Arc;

use super::ppd;
use crate::control::safe_writer::{RealFs, SafeWriter, WriteOp};
use crate::control::traits::*;
use crate::telemetry::hardware::Vendor;

/* --------------------------------------------------------------------------
Linux / power-profiles-daemon
-------------------------------------------------------------------------- */
pub struct LinuxPowerController {
    #[allow(dead_code)] // kept for vendor-specific branching
    vendor: Vendor,
}

impl LinuxPowerController {
    pub fn new(vendor: Vendor) -> Self {
        Self { vendor }
    }
}

impl Controller for LinuxPowerController {
    fn name(&self) -> &'static str {
        "power-profiles-daemon"
    }
    fn vendor(&self) -> Vendor {
        self.vendor
    }
}

impl PowerController for LinuxPowerController {
    fn set_profile(&self, req: &PowerRequest) -> ControlResult {
        if !self.available_profiles().iter().any(|p| p == &req.profile) {
            return Err(ControlError::InvalidParameter(format!(
                "unknown profile '{}'",
                req.profile
            )));
        }
        ppd::set(&req.profile)?;
        Ok(ControlOutcome {
            applied: true,
            dry_run: false,
            message: format!("Power profile → {}", req.profile),
        })
    }
    fn available_profiles(&self) -> Vec<String> {
        ppd::list().into_iter().map(|e| e.name).collect()
    }
    fn current_profile(&self) -> Option<String> {
        ppd::get()
    }
}

/* --------------------------------------------------------------------------
platform_profile (ACPI) — shared by Omen + Generic
-------------------------------------------------------------------------- */
const ACPI_BASE: &str = "/sys/firmware/acpi";

fn pp_writer() -> SafeWriter {
    SafeWriter::new(ACPI_BASE, Arc::new(RealFs))
}

fn pp_available(w: &SafeWriter) -> Vec<String> {
    w.read("platform_profile_choices")
        .map(|s| s.split_whitespace().map(String::from).collect())
        .unwrap_or_default()
}

fn pp_current(w: &SafeWriter) -> Option<String> {
    w.read("platform_profile").ok()
}

fn pp_set(w: &SafeWriter, name: &str) -> ControlResult {
    if !pp_available(w).iter().any(|p| p == name) {
        return Err(ControlError::InvalidParameter(format!(
            "unknown profile '{name}'"
        )));
    }
    w.apply(&[WriteOp::new("platform_profile", name)])?;
    Ok(ControlOutcome {
        applied: true,
        dry_run: false,
        message: format!("Platform profile → {name}"),
    })
}

pub struct OmenPowerController {
    #[allow(dead_code)] // kept for vendor-specific branching
    vendor: Vendor,
    writer: SafeWriter,
}

impl OmenPowerController {
    pub fn new(vendor: Vendor) -> Self {
        Self {
            vendor,
            writer: pp_writer(),
        }
    }
}

impl Controller for OmenPowerController {
    fn name(&self) -> &'static str {
        "omen-platform-profile"
    }
    fn vendor(&self) -> Vendor {
        self.vendor
    }
}

impl PowerController for OmenPowerController {
    fn set_profile(&self, req: &PowerRequest) -> ControlResult {
        pp_set(&self.writer, &req.profile)
    }
    fn available_profiles(&self) -> Vec<String> {
        pp_available(&self.writer)
    }
    fn current_profile(&self) -> Option<String> {
        pp_current(&self.writer)
    }
}

/* --------------------------------------------------------------------------
Generic — platform_profile if present, else cpufreq governor
-------------------------------------------------------------------------- */
const CPUFREQ: &str = "/sys/devices/system/cpu/cpu0/cpufreq";

pub struct GenericPowerController {
    #[allow(dead_code)] // kept for vendor-specific branching
    vendor: Vendor,
    writer: SafeWriter,
}

impl GenericPowerController {
    pub fn new(vendor: Vendor) -> Self {
        Self {
            vendor,
            writer: pp_writer(),
        }
    }

    fn has_platform_profile(&self) -> bool {
        !pp_available(&self.writer).is_empty()
    }
}

impl Controller for GenericPowerController {
    fn name(&self) -> &'static str {
        "generic-power"
    }
    fn vendor(&self) -> Vendor {
        self.vendor
    }
}

impl PowerController for GenericPowerController {
    fn set_profile(&self, req: &PowerRequest) -> ControlResult {
        if self.has_platform_profile() {
            return pp_set(&self.writer, &req.profile);
        }
        // cpufreq governor fallback.
        if !self.available_profiles().iter().any(|p| p == &req.profile) {
            return Err(ControlError::InvalidParameter(format!(
                "unknown governor '{}'",
                req.profile
            )));
        }
        let gw = SafeWriter::new(CPUFREQ, Arc::new(RealFs));
        gw.apply(&[WriteOp::new("scaling_governor", req.profile.clone())])?;
        Ok(ControlOutcome {
            applied: true,
            dry_run: false,
            message: format!("CPU governor → {}", req.profile),
        })
    }
    fn available_profiles(&self) -> Vec<String> {
        if self.has_platform_profile() {
            return pp_available(&self.writer);
        }
        SafeWriter::new(CPUFREQ, Arc::new(RealFs))
            .read("scaling_available_governors")
            .map(|s| s.split_whitespace().map(String::from).collect())
            .unwrap_or_default()
    }
    fn current_profile(&self) -> Option<String> {
        if self.has_platform_profile() {
            return pp_current(&self.writer);
        }
        SafeWriter::new(CPUFREQ, Arc::new(RealFs))
            .read("scaling_governor")
            .ok()
    }
}
