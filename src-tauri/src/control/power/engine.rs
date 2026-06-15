//! `PowerEngine` — high-level power façade used by IPC and the profile system.
//! Resolves the active `PowerController` from capability, and validates +
//! verifies + rolls back profile changes.

use serde::Serialize;

use super::controllers::{GenericPowerController, LinuxPowerController, OmenPowerController};
use super::ppd;
use crate::control::capabilities::PowerCapability;
use crate::control::traits::{ControlError, ControlResult, PowerController, PowerRequest};
use crate::telemetry::hardware::Vendor;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileMeta {
    pub name: String,
    pub cpu_driver: Option<String>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerInfo {
    pub driver: String,
    pub controllable: bool,
    pub current: Option<String>,
    pub profiles: Vec<ProfileMeta>,
    pub cpu_driver: Option<String>,
    pub ac_online: bool,
}

pub struct PowerEngine {
    controller: Option<Box<dyn PowerController>>,
    driver: String,
}

impl PowerEngine {
    pub fn new(caps: &PowerCapability, vendor: Vendor) -> Self {
        let is_hp = matches!(vendor, Vendor::Omen | Vendor::Victus);
        let controller: Option<Box<dyn PowerController>> = if caps.status.controllable {
            match caps.status.driver.as_str() {
                "power-profiles-daemon" => Some(Box::new(LinuxPowerController::new(vendor))),
                "platform_profile" if is_hp => Some(Box::new(OmenPowerController::new(vendor))),
                "platform_profile" => Some(Box::new(GenericPowerController::new(vendor))),
                _ => Some(Box::new(GenericPowerController::new(vendor))),
            }
        } else {
            None
        };
        Self {
            controller,
            driver: caps.status.driver.clone(),
        }
    }

    pub fn has_controller(&self) -> bool {
        self.controller.is_some()
    }

    pub fn current(&self) -> Option<String> {
        self.controller.as_ref().and_then(|c| c.current_profile())
    }

    pub fn available(&self) -> Vec<String> {
        self.controller
            .as_ref()
            .map(|c| c.available_profiles())
            .unwrap_or_default()
    }

    /// Set a power profile with validation + verify + rollback.
    pub fn set(&self, name: &str) -> ControlResult {
        let ctl = self
            .controller
            .as_deref()
            .ok_or_else(|| ControlError::DriverUnavailable("no power controller".into()))?;

        let prior = ctl.current_profile();
        let outcome = ctl.set_profile(&PowerRequest {
            profile: name.to_string(),
        })?;

        // Verify the switch actually took; roll back to the prior profile if not.
        if let Some(cur) = ctl.current_profile() {
            if cur != name {
                if let Some(p) = &prior {
                    let _ = ctl.set_profile(&PowerRequest { profile: p.clone() });
                }
                return Err(ControlError::Io(format!(
                    "profile did not switch (still '{cur}')"
                )));
            }
        }
        Ok(outcome)
    }

    pub fn info(&self) -> PowerInfo {
        let profiles: Vec<ProfileMeta> = if self.driver == "power-profiles-daemon" {
            ppd::list()
                .into_iter()
                .map(|e| ProfileMeta {
                    name: e.name,
                    cpu_driver: e.cpu_driver,
                    active: e.active,
                })
                .collect()
        } else {
            let cur = self.current();
            self.available()
                .into_iter()
                .map(|n| ProfileMeta {
                    active: Some(&n) == cur.as_ref(),
                    name: n,
                    cpu_driver: None,
                })
                .collect()
        };
        PowerInfo {
            driver: self.driver.clone(),
            controllable: self.controller.is_some(),
            current: self.current(),
            profiles,
            cpu_driver: read_cpu_driver(),
            ac_online: ac_online(),
        }
    }
}

fn read_cpu_driver() -> Option<String> {
    std::fs::read_to_string("/sys/devices/system/cpu/cpu0/cpufreq/scaling_driver")
        .ok()
        .map(|s| s.trim().to_string())
}

/// Whether AC power is connected (best-effort across naming schemes).
pub fn ac_online() -> bool {
    for p in [
        "/sys/class/power_supply/AC/online",
        "/sys/class/power_supply/ACAD/online",
        "/sys/class/power_supply/AC0/online",
        "/sys/class/power_supply/ADP1/online",
    ] {
        if let Ok(s) = std::fs::read_to_string(p) {
            return s.trim() == "1";
        }
    }
    true // assume plugged if unknown
}
