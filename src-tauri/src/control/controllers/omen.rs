//! HP OMEN / Victus controller (hp-wmi platform driver).
//!
//! Targets the EC fan controls and OMEN performance modes exposed by `hp-wmi`
//! (`/sys/devices/platform/hp-wmi/...`). Write paths are stubbed for Phase 2B.

use crate::control::traits::*;
use crate::telemetry::hardware::Vendor;

pub struct OmenController {
    #[allow(dead_code)] // kept for vendor-specific branching
    vendor: Vendor,
}

impl OmenController {
    pub fn new(vendor: Vendor) -> Self {
        Self { vendor }
    }
}

impl Controller for OmenController {
    fn name(&self) -> &'static str {
        "omen-hp-wmi"
    }
    fn vendor(&self) -> Vendor {
        self.vendor
    }
}

impl FanController for OmenController {
    fn set(&self, _req: &FanRequest) -> ControlResult {
        // Phase 3: write hp-wmi fan mode / boost (e.g. .../hp-wmi/fan_speed).
        Err(ControlError::NotImplemented)
    }
    fn auto(&self) -> ControlResult {
        Err(ControlError::NotImplemented)
    }
}

impl PowerController for OmenController {
    fn set_profile(&self, _req: &PowerRequest) -> ControlResult {
        // Phase 3: write OMEN performance mode via hp-wmi.
        Err(ControlError::NotImplemented)
    }
    fn available_profiles(&self) -> Vec<String> {
        vec!["eco".into(), "balanced".into(), "performance".into()]
    }
}
