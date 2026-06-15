//! `RgbEngine` — the high-level RGB façade used by IPC. Owns the active RGB
//! controller (selected from the detected capability) and the profile store, and
//! exposes apply / off / state / presets / profile CRUD + import-export.

use std::sync::Arc;

use super::omen::{OmenRgbController, OMEN_RGB_BASE};
use super::openrgb::OpenRgbController;
use super::profiles::{presets, ProfileStore, RgbProfile};
use crate::control::capabilities::RgbCapability;
use crate::control::safe_writer::RealFs;
use crate::control::traits::{
    ControlError, ControlOutcome, ControlResult, RgbController, RgbRequest, RgbState,
};
use crate::telemetry::hardware::Vendor;

pub struct RgbEngine {
    controller: Option<Box<dyn RgbController>>,
    store: ProfileStore,
}

impl RgbEngine {
    /// Pick the controller implied by the detected RGB capability.
    pub fn new(caps: &RgbCapability, vendor: Vendor) -> Self {
        let controller: Option<Box<dyn RgbController>> = if caps.status.controllable {
            match caps.status.driver.as_str() {
                "omen-rgb-keyboard" => Some(Box::new(OmenRgbController::new(
                    vendor,
                    OMEN_RGB_BASE,
                    Arc::new(RealFs),
                ))),
                "openrgb" => Some(Box::new(OpenRgbController::new(vendor))),
                _ => None,
            }
        } else {
            None
        };
        Self {
            controller,
            store: ProfileStore::new(),
        }
    }

    pub fn has_controller(&self) -> bool {
        self.controller.is_some()
    }

    fn ctl(&self) -> Result<&dyn RgbController, ControlError> {
        self.controller
            .as_deref()
            .ok_or_else(|| ControlError::DriverUnavailable("no RGB controller".into()))
    }

    pub fn apply(&self, req: &RgbRequest) -> ControlResult {
        self.ctl()?.set(req)
    }

    pub fn off(&self) -> ControlResult {
        self.ctl()?.off()
    }

    pub fn state(&self) -> Option<RgbState> {
        self.controller.as_ref().and_then(|c| c.state())
    }

    #[allow(dead_code)]
    pub fn zone_count(&self) -> u32 {
        self.controller
            .as_ref()
            .map(|c| c.zone_count())
            .unwrap_or(0)
    }

    pub fn presets(&self) -> Vec<RgbProfile> {
        presets()
    }

    pub fn list_profiles(&self) -> Vec<RgbProfile> {
        self.store.list()
    }

    pub fn save_profile(&self, profile: &RgbProfile) -> Result<(), ControlError> {
        self.store.save(profile)
    }

    /// Load a saved profile and apply it to the hardware.
    pub fn apply_profile(&self, name: &str) -> ControlResult {
        let profile = self.store.load(name)?;
        let outcome = self.ctl()?.set(&profile.to_request())?;
        Ok(ControlOutcome {
            message: format!("Applied profile '{}'", profile.name),
            ..outcome
        })
    }

    pub fn delete_profile(&self, name: &str) -> Result<(), ControlError> {
        self.store.delete(name)
    }

    pub fn export_profile(&self, name: &str) -> Result<String, ControlError> {
        self.store.export(name)
    }

    pub fn import_profile(&self, json: &str) -> Result<RgbProfile, ControlError> {
        self.store.import(json)
    }
}
