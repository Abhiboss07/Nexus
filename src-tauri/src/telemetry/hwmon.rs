//! Unified hwmon scan. Reads every `/sys/class/hwmon/hwmonN` chip once and
//! exposes its temperature and fan channels with resolved labels, so the temp
//! and fan collectors don't each re-walk sysfs.

use super::sysfs;

pub struct TempReading {
    pub chip: String,
    pub label: String,
    pub celsius: f32,
}

pub struct FanReading {
    pub label: String,
    pub rpm: u32,
}

pub struct HwmonScan {
    pub temps: Vec<TempReading>,
    pub fans: Vec<FanReading>,
}

fn channel_label(dir: &str, kind: &str, idx: u32, chip: &str) -> String {
    sysfs::read_string(&format!("{dir}/{kind}{idx}_label"))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| format!("{chip} {kind}{idx}"))
}

pub fn scan() -> HwmonScan {
    let mut temps = Vec::new();
    let mut fans = Vec::new();

    for name in sysfs::list_dir("/sys/class/hwmon") {
        let dir = format!("/sys/class/hwmon/{name}");
        let chip = sysfs::read_string(&format!("{dir}/name")).unwrap_or_else(|| name.clone());

        for file in sysfs::list_dir(&dir) {
            // tempN_input (millidegrees C)
            if let Some(idx) = file
                .strip_prefix("temp")
                .and_then(|s| s.strip_suffix("_input"))
                .and_then(|s| s.parse::<u32>().ok())
            {
                if let Some(milli) = sysfs::read_f32(&format!("{dir}/{file}")) {
                    temps.push(TempReading {
                        chip: chip.clone(),
                        label: channel_label(&dir, "temp", idx, &chip),
                        celsius: milli / 1000.0,
                    });
                }
            }
            // fanN_input (RPM)
            if let Some(idx) = file
                .strip_prefix("fan")
                .and_then(|s| s.strip_suffix("_input"))
                .and_then(|s| s.parse::<u32>().ok())
            {
                if let Some(rpm) = sysfs::read_u64(&format!("{dir}/{file}")) {
                    fans.push(FanReading {
                        label: channel_label(&dir, "fan", idx, &chip),
                        rpm: rpm as u32,
                    });
                }
            }
        }
    }

    HwmonScan { temps, fans }
}

impl HwmonScan {
    /// First temperature whose chip matches any of `chips` and (optionally)
    /// whose label starts with `label_prefix`.
    pub fn temp_for(&self, chips: &[&str], label_prefix: Option<&str>) -> Option<f32> {
        // Prefer an exact label match first.
        if let Some(prefix) = label_prefix {
            if let Some(t) = self.temps.iter().find(|t| {
                chips.iter().any(|c| t.chip.contains(*c)) && t.label.starts_with(prefix)
            }) {
                return Some(t.celsius);
            }
        }
        self.temps
            .iter()
            .find(|t| chips.iter().any(|c| t.chip.contains(*c)))
            .map(|t| t.celsius)
    }
}
