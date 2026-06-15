//! `CapabilityDetector` — probes the system to build `HardwareCapabilities`.
//!
//! All environment access goes through the `SystemProbe` trait so detection is
//! fully unit-testable: production uses `LiveProbe` (real fs + PATH), tests use
//! `MockProbe` with an injected virtual filesystem.

#[cfg(test)]
use std::collections::{HashMap, HashSet};

use super::capabilities::*;
use crate::telemetry::hardware::HardwareProfile;

/// Abstraction over the bits of the OS the detector inspects.
pub trait SystemProbe {
    fn path_exists(&self, path: &str) -> bool;
    fn read(&self, path: &str) -> Option<String>;
    fn list(&self, dir: &str) -> Vec<String>;
    /// Whether an executable is resolvable on `$PATH`.
    fn command_exists(&self, bin: &str) -> bool;
}

/// Production probe backed by the real filesystem and `$PATH`.
pub struct LiveProbe;

impl SystemProbe for LiveProbe {
    fn path_exists(&self, path: &str) -> bool {
        std::path::Path::new(path).exists()
    }
    fn read(&self, path: &str) -> Option<String> {
        std::fs::read_to_string(path)
            .ok()
            .map(|s| s.trim().to_string())
    }
    fn list(&self, dir: &str) -> Vec<String> {
        std::fs::read_dir(dir)
            .map(|rd| {
                rd.flatten()
                    .map(|e| e.file_name().to_string_lossy().to_string())
                    .collect()
            })
            .unwrap_or_default()
    }
    fn command_exists(&self, bin: &str) -> bool {
        let Some(path) = std::env::var_os("PATH") else {
            return false;
        };
        std::env::split_paths(&path).any(|p| p.join(bin).is_file())
    }
}

use super::rgb::effects::EFFECTS as RGB_EFFECTS;
const FAN_MODES: [&str; 4] = ["auto", "silent", "balanced", "max"];

pub struct CapabilityDetector<'p> {
    probe: &'p dyn SystemProbe,
}

impl<'p> CapabilityDetector<'p> {
    pub fn new(probe: &'p dyn SystemProbe) -> Self {
        Self { probe }
    }

    fn battery_base(&self) -> Option<&'static str> {
        [
            "/sys/class/power_supply/BAT0",
            "/sys/class/power_supply/BAT1",
        ]
        .into_iter()
        .find(|b| self.probe.path_exists(b))
    }

    /// Count hwmon channels matching `fan*_input`.
    fn fan_input_count(&self) -> u32 {
        let mut count = 0;
        for chip in self.probe.list("/sys/class/hwmon") {
            for f in self.probe.list(&format!("/sys/class/hwmon/{chip}")) {
                if f.starts_with("fan") && f.ends_with("_input") {
                    count += 1;
                }
            }
        }
        count
    }

    fn has_pwm(&self) -> bool {
        for chip in self.probe.list("/sys/class/hwmon") {
            for f in self.probe.list(&format!("/sys/class/hwmon/{chip}")) {
                if f.starts_with("pwm") && f.ends_with("_enable") {
                    return true;
                }
            }
        }
        false
    }

    fn detect_power(&self) -> PowerCapability {
        let choices = self
            .probe
            .read("/sys/firmware/acpi/platform_profile_choices");
        let current = self.probe.read("/sys/firmware/acpi/platform_profile");
        let ppd = self.probe.command_exists("powerprofilesctl");
        let rapl = self
            .probe
            .path_exists("/sys/class/powercap/intel-rapl:0/constraint_0_power_limit_uw");

        if let Some(choices) = choices {
            let profiles: Vec<String> = choices.split_whitespace().map(String::from).collect();
            PowerCapability {
                status: CapabilityStatus::full("platform_profile"),
                profiles,
                current_profile: current,
                tunable_tdp: rapl,
            }
        } else if ppd {
            PowerCapability {
                status: CapabilityStatus::full("power-profiles-daemon"),
                profiles: vec![
                    "power-saver".into(),
                    "balanced".into(),
                    "performance".into(),
                ],
                current_profile: None,
                tunable_tdp: rapl,
            }
        } else {
            PowerCapability {
                status: CapabilityStatus::read_only(
                    "cpufreq",
                    "No platform power profiles exposed",
                ),
                profiles: vec![],
                current_profile: None,
                tunable_tdp: rapl,
            }
        }
    }

    fn detect_battery(&self, profile: &HardwareProfile) -> BatteryCapability {
        let Some(base) = self.battery_base() else {
            return BatteryCapability {
                status: CapabilityStatus::unavailable("No battery present"),
                ..Default::default()
            };
        };
        let charge_limit = self
            .probe
            .path_exists(&format!("{base}/charge_control_end_threshold"));
        let conservation = self.probe.path_exists(&format!("{base}/charge_behaviour"))
            || self
                .probe
                .path_exists("/sys/bus/platform/drivers/ideapad_acpi");

        let status = if charge_limit || conservation {
            CapabilityStatus::full("power_supply sysfs")
        } else if profile.vendor.is_hp() {
            CapabilityStatus::read_only(
                "power_supply",
                "HP firmware exposes no battery charge-threshold interface on Linux (no charge_control_end_threshold / charge_behaviour / hp-wmi node).",
            )
        } else {
            CapabilityStatus::read_only(
                "power_supply",
                "This firmware does not expose a battery charge-threshold interface to Linux.",
            )
        };

        BatteryCapability {
            status,
            charge_limit,
            conservation_mode: conservation,
            limit_range: if charge_limit { Some((20, 100)) } else { None },
        }
    }

    fn detect_fan(&self, profile: &HardwareProfile) -> FanCapability {
        let fan_count = self.fan_input_count();
        // The HP OMEN/Victus fan interface is exposed by the `omen-rgb-keyboard`
        // driver under its own platform device — NOT via hp-wmi or hwmon. The
        // detector must recognize it directly, otherwise `caps.fan` reports
        // "unavailable" while the FanThermalEngine (and the real, writable sysfs
        // nodes) report a working interface — the false-warning inconsistency
        // (Task 5). The write-safety gate (`WriteGate::apply_to`) still has the
        // final say on whether writes are permitted on this exact board.
        let omen_fan = "/sys/devices/platform/omen-rgb-keyboard/fan/fan_curve";
        let omen_thermal = "/sys/devices/platform/omen-rgb-keyboard/fan/thermal_profile";
        let omen_present = self.probe.path_exists(omen_fan) || self.probe.path_exists(omen_thermal);
        let hp_wmi =
            profile.supports_fan_control && self.probe.path_exists("/sys/devices/platform/hp-wmi");
        let pwm = self.has_pwm();

        // OMEN fans: CPU + GPU, reported by the driver (not hwmon).
        let omen_fans = ["cpu_fan_rpm", "gpu_fan_rpm"]
            .iter()
            .filter(|a| {
                self.probe
                    .path_exists(&format!("/sys/devices/platform/omen-rgb-keyboard/fan/{a}"))
            })
            .count() as u32;

        let (status, count, modes) = if omen_present {
            (
                CapabilityStatus::full("omen-rgb-keyboard"),
                omen_fans.max(fan_count),
                vec!["silent".into(), "normal".into(), "performance".into()],
            )
        } else if hp_wmi {
            (
                CapabilityStatus::full("hp-wmi"),
                fan_count,
                FAN_MODES.iter().map(|s| s.to_string()).collect(),
            )
        } else if pwm {
            (
                CapabilityStatus::full("hwmon pwm"),
                fan_count,
                FAN_MODES.iter().map(|s| s.to_string()).collect(),
            )
        } else if fan_count > 0 {
            (
                CapabilityStatus::read_only(
                    "hwmon",
                    "Fan speed is readable but no write interface is exposed by the driver.",
                ),
                fan_count,
                FAN_MODES.iter().map(|s| s.to_string()).collect(),
            )
        } else {
            (
                CapabilityStatus::unavailable("Driver unavailable — no fan control interface (omen-rgb-keyboard / hp-wmi / hwmon PWM) is present."),
                0,
                FAN_MODES.iter().map(|s| s.to_string()).collect(),
            )
        };

        FanCapability {
            status,
            fan_count: count,
            manual_pwm: pwm,
            modes,
        }
    }

    fn detect_rgb(&self) -> RgbCapability {
        // Prefer the native OMEN four-zone driver if present (group `input` may
        // need to be granted for unprivileged writes), else fall back to OpenRGB.
        let omen_base = "/sys/devices/platform/omen-rgb-keyboard/rgb_zones";
        if self.probe.path_exists(omen_base) {
            let zones = (0..8)
                .filter(|i| self.probe.path_exists(&format!("{omen_base}/zone{i:02}")))
                .count() as u32;
            return RgbCapability {
                status: CapabilityStatus::full("omen-rgb-keyboard"),
                zones,
                per_key: false,
                effects: RGB_EFFECTS.iter().map(|s| s.to_string()).collect(),
            };
        }
        if self.probe.command_exists("openrgb") {
            return RgbCapability {
                status: CapabilityStatus::full("openrgb"),
                zones: 0, // resolved at OpenRGB connect-time
                per_key: false,
                effects: RGB_EFFECTS.iter().map(|s| s.to_string()).collect(),
            };
        }
        RgbCapability {
            status: CapabilityStatus::unavailable("No RGB driver (omen-rgb-keyboard / OpenRGB)"),
            zones: 0,
            per_key: false,
            effects: RGB_EFFECTS.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn detect_mux(&self) -> MuxCapability {
        let supergfx = self.probe.command_exists("supergfxctl");
        let asus_mux = self
            .probe
            .path_exists("/sys/devices/platform/asus-nb-wmi/dgpu_disable");
        let available = supergfx || asus_mux;
        let status = if available {
            CapabilityStatus::full(if supergfx { "supergfxctl" } else { "asus-wmi" })
        } else {
            CapabilityStatus::unavailable(
                "No controllable MUX interface detected (no supergfxctl, no vendor dgpu_disable/MUX node). Graphics stay in hybrid mode.",
            )
        };
        MuxCapability {
            status,
            modes: vec!["integrated".into(), "hybrid".into(), "discrete".into()],
            current_mode: None,
            requires_reboot: true,
        }
    }

    pub fn detect(&self, profile: &HardwareProfile) -> HardwareCapabilities {
        HardwareCapabilities {
            vendor: profile.vendor,
            vendor_label: profile.vendor_label.clone(),
            rgb: self.detect_rgb(),
            fan: self.detect_fan(profile),
            power: self.detect_power(),
            battery: self.detect_battery(profile),
            mux: self.detect_mux(),
        }
    }
}

/* ------------------------------------------------------------------------- */
/* Tests                                                                      */
/* ------------------------------------------------------------------------- */

#[cfg(test)]
pub struct MockProbe {
    pub files: HashMap<String, String>,
    pub dirs: HashMap<String, Vec<String>>,
    pub commands: HashSet<String>,
}

#[cfg(test)]
impl MockProbe {
    pub fn new() -> Self {
        Self {
            files: HashMap::new(),
            dirs: HashMap::new(),
            commands: HashSet::new(),
        }
    }
    pub fn file(mut self, path: &str, contents: &str) -> Self {
        self.files.insert(path.into(), contents.into());
        self
    }
    pub fn dir(mut self, path: &str, entries: &[&str]) -> Self {
        self.dirs
            .insert(path.into(), entries.iter().map(|s| s.to_string()).collect());
        self
    }
    pub fn command(mut self, bin: &str) -> Self {
        self.commands.insert(bin.into());
        self
    }
}

#[cfg(test)]
impl SystemProbe for MockProbe {
    fn path_exists(&self, path: &str) -> bool {
        // A registered file/dir exists; so does any ancestor directory of one
        // (mirrors a real filesystem, where a file implies its parent dirs).
        let prefix = format!("{path}/");
        self.files.contains_key(path)
            || self.dirs.contains_key(path)
            || self.files.keys().any(|f| f.starts_with(&prefix))
            || self.dirs.keys().any(|d| d.starts_with(&prefix))
    }
    fn read(&self, path: &str) -> Option<String> {
        self.files.get(path).cloned()
    }
    fn list(&self, dir: &str) -> Vec<String> {
        self.dirs.get(dir).cloned().unwrap_or_default()
    }
    fn command_exists(&self, bin: &str) -> bool {
        self.commands.contains(bin)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::hardware::Vendor;

    fn omen_profile() -> HardwareProfile {
        HardwareProfile {
            vendor: Vendor::Omen,
            vendor_label: "HP OMEN".into(),
            sys_vendor: "HP".into(),
            product_name: "OMEN 16".into(),
            board_name: "8BA9".into(),
            cpu_vendor: "Intel".into(),
            cpu_model: "Core i7".into(),
            gpu_vendor: "NVIDIA".into(),
            gpu_name: "RTX 4050".into(),
            has_nvidia: true,
            has_amd_gpu: false,
            has_battery: true,
            has_fan_sensors: false,
            supports_fan_control: false,
            os: "CachyOS".into(),
        }
    }

    #[test]
    fn power_profiles_detected_from_platform_profile() {
        let probe = MockProbe::new()
            .file(
                "/sys/firmware/acpi/platform_profile_choices",
                "low-power balanced performance",
            )
            .file("/sys/firmware/acpi/platform_profile", "balanced");
        let caps = CapabilityDetector::new(&probe).detect(&omen_profile());
        assert!(caps.power.status.controllable);
        assert_eq!(caps.power.profiles.len(), 3);
        assert_eq!(caps.power.current_profile.as_deref(), Some("balanced"));
    }

    #[test]
    fn fan_unavailable_without_driver_or_pwm() {
        let probe = MockProbe::new().dir("/sys/class/hwmon", &["hwmon0"]);
        let caps = CapabilityDetector::new(&probe).detect(&omen_profile());
        assert!(!caps.fan.status.available);
        assert!(!caps.fan.status.controllable);
    }

    #[test]
    fn fan_readonly_when_sensor_present_but_no_control() {
        let probe = MockProbe::new()
            .dir("/sys/class/hwmon", &["hwmon0"])
            .dir("/sys/class/hwmon/hwmon0", &["fan1_input"]);
        let caps = CapabilityDetector::new(&probe).detect(&omen_profile());
        assert!(caps.fan.status.available);
        assert!(!caps.fan.status.controllable);
        assert_eq!(caps.fan.fan_count, 1);
    }

    #[test]
    fn rgb_gated_on_openrgb_presence() {
        let without = CapabilityDetector::new(&MockProbe::new()).detect(&omen_profile());
        assert!(!without.rgb.status.controllable);

        let with = MockProbe::new().command("openrgb");
        let caps = CapabilityDetector::new(&with).detect(&omen_profile());
        assert!(caps.rgb.status.controllable);
    }

    #[test]
    fn battery_charge_limit_detected() {
        let probe = MockProbe::new().file(
            "/sys/class/power_supply/BAT0/charge_control_end_threshold",
            "100",
        );
        let caps = CapabilityDetector::new(&probe).detect(&omen_profile());
        assert!(caps.battery.charge_limit);
        assert_eq!(caps.battery.limit_range, Some((20, 100)));
    }
}
