//! Hardware discovery. Reads DMI/board identity and probes capabilities once at
//! startup to build a `HardwareProfile` the whole app reasons about.

use serde::Serialize;
use std::path::Path;

use super::sysfs;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Vendor {
    Omen,
    Victus,
    Rog,
    Tuf,
    Legion,
    Alienware,
    Dell,
    Generic,
}

impl Vendor {
    pub fn label(self) -> &'static str {
        match self {
            Vendor::Omen => "HP OMEN",
            Vendor::Victus => "HP Victus",
            Vendor::Rog => "ASUS ROG",
            Vendor::Tuf => "ASUS TUF",
            Vendor::Legion => "Lenovo Legion",
            Vendor::Alienware => "Alienware",
            Vendor::Dell => "Dell",
            Vendor::Generic => "Generic Linux",
        }
    }

    /// True for HP gaming machines (OMEN / Victus).
    pub fn is_hp(self) -> bool {
        matches!(self, Vendor::Omen | Vendor::Victus)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareProfile {
    pub vendor: Vendor,
    pub vendor_label: String,
    pub sys_vendor: String,
    pub product_name: String,
    pub board_name: String,
    pub cpu_vendor: String,
    pub cpu_model: String,
    pub gpu_vendor: String,
    pub gpu_name: String,
    pub has_nvidia: bool,
    pub has_amd_gpu: bool,
    pub has_battery: bool,
    pub has_fan_sensors: bool,
    /// Vendor fan/thermal control (requires a platform driver, e.g. hp-wmi).
    pub supports_fan_control: bool,
    pub os: String,
}

fn dmi(field: &str) -> String {
    sysfs::read_string(&format!("/sys/class/dmi/id/{field}")).unwrap_or_default()
}

fn detect_vendor(sys_vendor: &str, product: &str, board_family: &str) -> Vendor {
    let v = sys_vendor.to_ascii_lowercase();
    let p = product.to_ascii_lowercase();
    let f = board_family.to_ascii_lowercase();
    let hay = format!("{p} {f}");

    if v.contains("hp") || v.contains("hewlett") {
        if hay.contains("omen") {
            return Vendor::Omen;
        }
        if hay.contains("victus") {
            return Vendor::Victus;
        }
    }
    if v.contains("asus") {
        if hay.contains("rog") {
            return Vendor::Rog;
        }
        if hay.contains("tuf") {
            return Vendor::Tuf;
        }
    }
    if v.contains("lenovo") && hay.contains("legion") {
        return Vendor::Legion;
    }
    if v.contains("alienware") || hay.contains("alienware") {
        return Vendor::Alienware;
    }
    if v.contains("dell") {
        return Vendor::Dell;
    }
    Vendor::Generic
}

fn os_pretty_name() -> String {
    if let Some(content) = sysfs::read_string("/etc/os-release") {
        for line in content.lines() {
            if let Some(rest) = line.strip_prefix("PRETTY_NAME=") {
                return rest.trim_matches('"').to_string();
            }
        }
    }
    "Linux".to_string()
}

fn cpu_identity() -> (String, String) {
    let mut vendor = String::new();
    let mut model = String::new();
    if let Some(content) = sysfs::read_string("/proc/cpuinfo") {
        for line in content.lines() {
            if vendor.is_empty() {
                if let Some(v) = line.strip_prefix("vendor_id") {
                    vendor = v.trim().trim_start_matches(':').trim().to_string();
                }
            }
            if model.is_empty() {
                if let Some(m) = line.strip_prefix("model name") {
                    model = m.trim().trim_start_matches(':').trim().to_string();
                }
            }
            if !vendor.is_empty() && !model.is_empty() {
                break;
            }
        }
    }
    let pretty = if vendor.contains("Intel") {
        "Intel"
    } else if vendor.contains("AMD") {
        "AMD"
    } else {
        "Unknown"
    };
    (pretty.to_string(), model)
}

/// Walk /sys/class/drm looking for a discrete/integrated GPU by PCI vendor id.
fn gpu_identity() -> (bool, bool, String, String) {
    let mut has_nvidia = false;
    let mut has_amd = false;
    let mut name = String::new();
    let mut vendor = String::new();

    if let Ok(entries) = std::fs::read_dir("/sys/class/drm") {
        for e in entries.flatten() {
            let card = e.file_name().to_string_lossy().to_string();
            if !card.starts_with("card") || card.contains('-') {
                continue;
            }
            let vpath = format!("/sys/class/drm/{card}/device/vendor");
            if let Some(vid) = sysfs::read_string(&vpath) {
                match vid.trim() {
                    "0x10de" => has_nvidia = true,
                    "0x1002" => has_amd = true,
                    _ => {}
                }
            }
        }
    }

    if has_nvidia {
        vendor = "NVIDIA".into();
        // Resolve a friendly name from nvidia-smi (best effort).
        if let Ok(out) = std::process::Command::new("nvidia-smi")
            .args(["--query-gpu=name", "--format=csv,noheader"])
            .output()
        {
            name = String::from_utf8_lossy(&out.stdout).trim().to_string();
        }
        if name.is_empty() {
            name = "NVIDIA GPU".into();
        }
    } else if has_amd {
        vendor = "AMD".into();
        name = "AMD Radeon".into();
    }

    (has_nvidia, has_amd, vendor, name)
}

fn has_fan_sensors() -> bool {
    if let Ok(entries) = std::fs::read_dir("/sys/class/hwmon") {
        for e in entries.flatten() {
            let dir = e.path();
            if let Ok(files) = std::fs::read_dir(&dir) {
                for f in files.flatten() {
                    let n = f.file_name().to_string_lossy().to_string();
                    if n.starts_with("fan") && n.ends_with("_input") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

pub fn detect() -> HardwareProfile {
    let sys_vendor = dmi("sys_vendor");
    let product_name = dmi("product_name");
    let board_name = dmi("board_name");
    let board_family = dmi("product_family");

    let vendor = detect_vendor(&sys_vendor, &product_name, &board_family);
    let (cpu_vendor, cpu_model) = cpu_identity();
    let (has_nvidia, has_amd_gpu, gpu_vendor, gpu_name) = gpu_identity();
    let has_battery = Path::new("/sys/class/power_supply/BAT0").exists()
        || Path::new("/sys/class/power_supply/BAT1").exists();
    let fan_sensors = has_fan_sensors();

    // Fan control requires a kernel platform driver exposing pwm. We only claim
    // support when such an interface is actually present.
    let supports_fan_control = matches!(vendor, Vendor::Omen | Vendor::Victus)
        && Path::new("/sys/devices/platform/hp-wmi").exists();

    HardwareProfile {
        vendor,
        vendor_label: vendor.label().to_string(),
        sys_vendor,
        product_name,
        board_name,
        cpu_vendor,
        cpu_model,
        gpu_vendor,
        gpu_name,
        has_nvidia,
        has_amd_gpu,
        has_battery,
        has_fan_sensors: fan_sensors,
        supports_fan_control,
        os: os_pretty_name(),
    }
}
