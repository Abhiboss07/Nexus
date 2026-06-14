//! Vendor-neutral controller built on standard Linux interfaces:
//!   - power   → `/sys/firmware/acpi/platform_profile` or power-profiles-daemon
//!   - battery → `/sys/class/power_supply/BAT*/charge_control_end_threshold`
//!   - fan     → hwmon `pwmN_enable` / `pwmN`
//!   - mux     → `supergfxctl`
//!
//! Works across most modern laptops; the safe baseline every vendor falls back
//! to. Writes are stubbed for Phase 2B.

use crate::control::traits::*;
use crate::telemetry::hardware::Vendor;

pub struct GenericController {
    vendor: Vendor,
    profiles: Vec<String>,
}

impl GenericController {
    pub fn new(vendor: Vendor, profiles: Vec<String>) -> Self {
        Self { vendor, profiles }
    }
}

impl Controller for GenericController {
    fn name(&self) -> &'static str {
        "generic-sysfs"
    }
    fn vendor(&self) -> Vendor {
        self.vendor
    }
}

impl PowerController for GenericController {
    fn set_profile(&self, _req: &PowerRequest) -> ControlResult {
        // Phase 3: echo profile into /sys/firmware/acpi/platform_profile.
        Err(ControlError::NotImplemented)
    }
    fn available_profiles(&self) -> Vec<String> {
        self.profiles.clone()
    }
}

impl BatteryController for GenericController {
    fn set_charge_limit(&self, req: &BatteryRequest) -> ControlResult {
        if req.charge_limit < 20 || req.charge_limit > 100 {
            return Err(ControlError::InvalidParameter(
                "charge limit must be 20–100".into(),
            ));
        }
        // Phase 3: write charge_control_end_threshold.
        Err(ControlError::NotImplemented)
    }
}

impl FanController for GenericController {
    fn set(&self, _req: &FanRequest) -> ControlResult {
        // Phase 3: set pwmN_enable=1 then pwmN=<0-255>.
        Err(ControlError::NotImplemented)
    }
    fn auto(&self) -> ControlResult {
        Err(ControlError::NotImplemented)
    }
}

impl MuxController for GenericController {
    fn set_mode(&self, _req: &MuxRequest) -> ControlResult {
        // Phase 3: supergfxctl -m <mode>.
        Err(ControlError::NotImplemented)
    }
}
