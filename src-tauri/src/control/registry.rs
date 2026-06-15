//! `DriverRegistry` — resolves the right set of controllers for this machine.
//!
//! Given the `HardwareProfile` and detected `HardwareCapabilities`, it assembles
//! a `VendorController`: a bundle of optional, trait-object controllers (one per
//! domain). This is the single place vendor → driver mapping lives; nothing
//! above it knows which concrete controller backs a domain.

use super::capabilities::HardwareCapabilities;
use super::controllers::{GenericController, OmenController};
use super::traits::*;
use crate::telemetry::hardware::{HardwareProfile, Vendor};

/// The active controllers for the running machine. Any slot may be `None` when
/// the capability is unavailable. RGB is owned separately by the `RgbEngine`.
#[derive(Default)]
pub struct VendorController {
    pub fan: Option<Box<dyn FanController>>,
    pub power: Option<Box<dyn PowerController>>,
    pub battery: Option<Box<dyn BatteryController>>,
    pub mux: Option<Box<dyn MuxController>>,
}

/// Lightweight description of which driver backs each domain (for IPC/debug).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverInfo {
    pub domain: String,
    pub driver: Option<String>,
}

pub struct DriverRegistry;

impl DriverRegistry {
    /// Build the controller bundle. Selection is capability-driven: a controller
    /// is only attached when its capability reports `controllable`.
    pub fn resolve(profile: &HardwareProfile, caps: &HardwareCapabilities) -> VendorController {
        let vendor = profile.vendor;
        let is_hp = matches!(vendor, Vendor::Omen | Vendor::Victus);

        // Fan → vendor driver on HP (hp-wmi), else generic pwm.
        let fan: Option<Box<dyn FanController>> = if caps.fan.status.controllable {
            if is_hp && caps.fan.status.driver == "hp-wmi" {
                Some(Box::new(OmenController::new(vendor)))
            } else {
                Some(Box::new(GenericController::new(vendor, vec![])))
            }
        } else {
            None
        };

        // Power → vendor performance modes on HP, else platform_profile.
        let power: Option<Box<dyn PowerController>> = if caps.power.status.controllable {
            if is_hp && caps.fan.status.driver == "hp-wmi" {
                Some(Box::new(OmenController::new(vendor)))
            } else {
                Some(Box::new(GenericController::new(
                    vendor,
                    caps.power.profiles.clone(),
                )))
            }
        } else {
            None
        };

        // Battery & MUX → generic sysfs.
        let battery: Option<Box<dyn BatteryController>> = if caps.battery.status.controllable {
            Some(Box::new(GenericController::new(vendor, vec![])))
        } else {
            None
        };
        let mux: Option<Box<dyn MuxController>> = if caps.mux.status.controllable {
            Some(Box::new(GenericController::new(vendor, vec![])))
        } else {
            None
        };

        VendorController {
            fan,
            power,
            battery,
            mux,
        }
    }
}

impl VendorController {
    /// Per-domain driver names for diagnostics / IPC.
    pub fn drivers(&self) -> Vec<DriverInfo> {
        vec![
            DriverInfo {
                domain: "fan".into(),
                driver: self.fan.as_ref().map(|c| c.name().to_string()),
            },
            DriverInfo {
                domain: "power".into(),
                driver: self.power.as_ref().map(|c| c.name().to_string()),
            },
            DriverInfo {
                domain: "battery".into(),
                driver: self.battery.as_ref().map(|c| c.name().to_string()),
            },
            DriverInfo {
                domain: "mux".into(),
                driver: self.mux.as_ref().map(|c| c.name().to_string()),
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control::detector::{CapabilityDetector, MockProbe};

    fn profile(vendor: Vendor) -> HardwareProfile {
        HardwareProfile {
            vendor,
            vendor_label: vendor.label().into(),
            sys_vendor: "HP".into(),
            product_name: "OMEN".into(),
            board_name: "8BA9".into(),
            cpu_vendor: "Intel".into(),
            cpu_model: "Core i7".into(),
            gpu_vendor: "NVIDIA".into(),
            gpu_name: "RTX 4050".into(),
            has_nvidia: true,
            has_amd_gpu: false,
            has_battery: true,
            has_fan_sensors: false,
            supports_fan_control: true,
            os: "CachyOS".into(),
        }
    }

    #[test]
    fn no_controllers_attached_on_bare_system() {
        let probe = MockProbe::new();
        let p = profile(Vendor::Generic);
        let caps = CapabilityDetector::new(&probe).detect(&p);
        let vc = DriverRegistry::resolve(&p, &caps);
        assert!(vc.fan.is_none());
        assert!(vc.power.is_none());
    }

    #[test]
    fn hp_fan_uses_omen_driver() {
        let probe = MockProbe::new().dir("/sys/devices/platform/hp-wmi", &["fan1_speed"]);
        let p = profile(Vendor::Omen);
        let caps = CapabilityDetector::new(&probe).detect(&p);
        let vc = DriverRegistry::resolve(&p, &caps);
        assert_eq!(vc.fan.as_ref().map(|c| c.name()), Some("omen-hp-wmi"));
    }

    #[test]
    fn generic_power_from_platform_profile() {
        let probe = MockProbe::new().file(
            "/sys/firmware/acpi/platform_profile_choices",
            "low-power balanced performance",
        );
        let p = profile(Vendor::Legion);
        let caps = CapabilityDetector::new(&probe).detect(&p);
        let vc = DriverRegistry::resolve(&p, &caps);
        assert_eq!(vc.power.as_ref().map(|c| c.name()), Some("generic-sysfs"));
    }
}
