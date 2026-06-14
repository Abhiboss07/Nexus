//! Fan Discovery & Thermal Intelligence (Phase 3.4A — READ-ONLY).
//!
//! Discovers and validates the `omen-rgb-keyboard` fan interface, reads live
//! RPM + control attributes, inspects driver capabilities, and computes a
//! thermal health score + recommendations + a temp→fan correlation point.
//!
//! NO fan writes happen here. Capability detection probes write *permission* by
//! opening a node O_WRONLY (which the kernel only validates — sysfs store
//! callbacks fire on write(2), never on open) and immediately closing it.

use std::sync::OnceLock;

use serde::Serialize;

use crate::telemetry::hwmon;

pub const FAN_BASE: &str = "/sys/devices/platform/omen-rgb-keyboard/fan";
pub const MAX_CURVE_POINTS: u32 = 8;
pub const TEMP_RANGE: (u32, u32) = (0, 120);
pub const PCT_RANGE: (u32, u32) = (0, 100);

/// The omen-rgb-keyboard fan interface, as the driver itself reports at probe.
/// Custom curves are ONLY functional on `victus-s` with a valid fan table
/// (driver: `fan_curve_enable` requires
/// `fan_iface == OMEN_FAN_IF_VICTUS_S && fan_tbl_valid && curve_num_points >= 2`).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FanInterface {
    /// "victus-s" | "classic" | "none" | "unknown"
    pub name: String,
    pub curve_supported: bool,
    pub detail: String,
}

static FAN_IFACE: OnceLock<FanInterface> = OnceLock::new();

fn kernel_log() -> Option<String> {
    // journalctl is usually readable by the local user; fall back to dmesg.
    for args in [
        vec!["journalctl", "-k", "-o", "cat", "--no-pager"],
        vec!["dmesg"],
    ] {
        if let Ok(out) = std::process::Command::new(args[0]).args(&args[1..]).output() {
            if out.status.success() {
                let t = String::from_utf8_lossy(&out.stdout).to_string();
                if t.contains("fan interface") || t.contains("omen_rgb_keyboard") {
                    return Some(t);
                }
            }
        }
    }
    None
}

fn detect_interface() -> FanInterface {
    let log = kernel_log().unwrap_or_default();
    let mut name = String::from("unknown");
    let mut table = false;
    let mut detail = String::new();
    // Last matching line wins (most recent boot).
    for line in log.lines() {
        if line.contains("fan interface:") {
            if line.contains("Victus-S") {
                name = "victus-s".into();
            } else if line.contains("classic") {
                name = "classic".into();
            } else if line.contains("unsupported") {
                name = "none".into();
            }
        }
        if line.contains("Victus fan table loaded") {
            table = true;
            detail = line.split("omen_rgb_keyboard:").last().unwrap_or("").trim().to_string();
        }
        if line.contains("manual curve disabled") {
            table = false;
        }
    }
    let curve_supported = name == "victus-s" && table;
    FanInterface { name, curve_supported, detail }
}

/// Cached, authoritative fan-interface detection from the driver's probe log.
pub fn fan_interface() -> &'static FanInterface {
    FAN_IFACE.get_or_init(detect_interface)
}

fn read(attr: &str) -> Option<String> {
    std::fs::read_to_string(format!("{FAN_BASE}/{attr}")).ok().map(|s| s.trim().to_string())
}
fn exists(attr: &str) -> bool {
    std::path::Path::new(&format!("{FAN_BASE}/{attr}")).exists()
}
/// Safe write-permission probe — opens O_WRONLY without writing, then drops it.
fn can_write(attr: &str) -> bool {
    std::fs::OpenOptions::new()
        .write(true)
        .open(format!("{FAN_BASE}/{attr}"))
        .is_ok()
}

#[derive(Debug, Clone, Copy, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurvePoint {
    pub temp_c: u32,
    pub pct: u32,
}

/// Parse the driver's `temp:pct temp:pct …` fan-curve format.
pub fn parse_curve(raw: &str) -> Vec<CurvePoint> {
    if raw.is_empty() || raw.contains("unset") {
        return Vec::new();
    }
    raw.split_whitespace()
        .filter_map(|pair| {
            let (t, p) = pair.split_once(':')?;
            Some(CurvePoint { temp_c: t.trim().parse().ok()?, pct: p.trim().parse().ok()? })
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FanCapabilities {
    pub available: bool,
    pub driver: String,
    /// Detected fan interface (curves are Victus-S only).
    pub interface: String,
    pub can_read_rpm: bool,
    /// Authoritative: curves actually work on this platform (Victus-S + table).
    pub can_set_curve: bool,
    pub can_set_thermal_profile: bool,
    pub can_max_fan: bool,
    pub max_curve_points: u32,
    pub temp_range: (u32, u32),
    pub pct_range: (u32, u32),
    pub thermal_profiles: Vec<String>,
    /// True if THIS process can write the control nodes right now.
    pub writable: bool,
    pub permission_note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttrInspect {
    pub name: String,
    pub present: bool,
    pub writable: bool,
    pub value: String,
    pub format: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FanInfo {
    pub capabilities: FanCapabilities,
    pub cpu_rpm: Option<u32>,
    pub gpu_rpm: Option<u32>,
    pub max_fan: bool,
    pub fan_curve_enabled: bool,
    pub thermal_profile: String,
    pub temp_zone: String,
    pub curve: Vec<CurvePoint>,
    /// Driver capability inspector — one row per sysfs attribute.
    pub attributes: Vec<AttrInspect>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalSensorInfo {
    pub source: String,
    pub label: String,
    pub temperature_c: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalRecommendation {
    pub severity: String,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CorrelationPoint {
    pub cpu_c: Option<f32>,
    pub cpu_rpm: Option<u32>,
    pub gpu_c: Option<f32>,
    pub gpu_rpm: Option<u32>,
    pub note: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThermalReport {
    pub cpu_c: Option<f32>,
    pub gpu_c: Option<f32>,
    pub ssd_c: Option<f32>,
    pub sensors: Vec<ThermalSensorInfo>,
    pub score: u8,
    pub grade: String,
    pub recommendations: Vec<ThermalRecommendation>,
    pub correlation: CorrelationPoint,
}

pub struct FanThermalEngine;

impl FanThermalEngine {
    pub fn new() -> Self {
        Self
    }

    pub fn available(&self) -> bool {
        std::path::Path::new(FAN_BASE).exists()
    }

    fn rpm(&self, attr: &str) -> Option<u32> {
        read(attr).and_then(|s| s.parse().ok())
    }

    pub fn capabilities(&self) -> FanCapabilities {
        let available = self.available();
        let iface = fan_interface();
        let writable = available
            && (can_write("fan_curve") || can_write("thermal_profile") || can_write("max_fan"));
        let permission_note = if !available {
            "omen-rgb-keyboard fan interface not present".into()
        } else if writable {
            "Writable".into()
        } else {
            "Fan control requires membership in the 'input' group (sudo usermod -aG input $USER)".into()
        };
        FanCapabilities {
            available,
            driver: "omen-rgb-keyboard".into(),
            interface: iface.name.clone(),
            can_read_rpm: exists("cpu_fan_rpm") || exists("gpu_fan_rpm"),
            // Authoritative — curves are functional only on Victus-S + valid table.
            can_set_curve: available && iface.curve_supported && exists("fan_curve"),
            // thermal_profile & max_fan go via WMI and work on any present interface.
            can_set_thermal_profile: available && iface.name != "none" && exists("thermal_profile"),
            can_max_fan: available && iface.name != "none" && exists("max_fan"),
            max_curve_points: MAX_CURVE_POINTS,
            temp_range: TEMP_RANGE,
            pct_range: PCT_RANGE,
            thermal_profiles: vec!["performance".into(), "normal".into(), "silent".into()],
            writable,
            permission_note,
        }
    }

    fn inspect(&self) -> Vec<AttrInspect> {
        let specs = [
            ("cpu_fan_rpm", "u32 RPM (read-only)"),
            ("gpu_fan_rpm", "u32 RPM (read-only)"),
            ("fan_curve", "`temp:pct …` (2–8 pts, t 0–120, p 0–100)"),
            ("fan_curve_enable", "0 | 1"),
            ("fan_temp_zone", "zone name | auto"),
            ("max_fan", "0 | 1 (max boost)"),
            ("thermal_profile", "performance | normal | silent"),
        ];
        specs
            .into_iter()
            .map(|(name, format)| AttrInspect {
                present: exists(name),
                writable: can_write(name),
                value: read(name).unwrap_or_else(|| "—".into()),
                name: name.into(),
                format: format.into(),
            })
            .collect()
    }

    pub fn fan_info(&self) -> FanInfo {
        FanInfo {
            capabilities: self.capabilities(),
            cpu_rpm: self.rpm("cpu_fan_rpm"),
            gpu_rpm: self.rpm("gpu_fan_rpm"),
            max_fan: read("max_fan").as_deref() == Some("1"),
            fan_curve_enabled: read("fan_curve_enable").as_deref() == Some("1"),
            thermal_profile: read("thermal_profile").unwrap_or_else(|| "unknown".into()),
            temp_zone: read("fan_temp_zone").unwrap_or_else(|| "auto".into()),
            curve: parse_curve(&read("fan_curve").unwrap_or_default()),
            attributes: self.inspect(),
        }
    }

    pub fn thermal_report(&self) -> ThermalReport {
        let scan = hwmon::scan();
        let cpu_c = scan.temp_for(&["coretemp", "k10temp", "zenpower"], Some("Package"));
        let ssd_c = scan.temp_for(&["nvme"], Some("Composite"));
        let gpu_c = nvidia_gpu_temp();

        let sensors: Vec<ThermalSensorInfo> = scan
            .temps
            .iter()
            .map(|t| ThermalSensorInfo {
                source: t.chip.clone(),
                label: t.label.clone(),
                temperature_c: t.celsius,
            })
            .collect();

        let hottest = [cpu_c, gpu_c].into_iter().flatten().fold(0.0_f32, f32::max);
        let score = thermal_score(hottest);
        let grade = thermal_grade(hottest).into();
        let recommendations = thermal_recommendations(cpu_c, gpu_c, ssd_c, &self.fan_info());

        ThermalReport {
            cpu_c,
            gpu_c,
            ssd_c,
            sensors,
            score,
            grade,
            recommendations,
            correlation: CorrelationPoint {
                cpu_c,
                cpu_rpm: self.rpm("cpu_fan_rpm"),
                gpu_c,
                gpu_rpm: self.rpm("gpu_fan_rpm"),
                note: "Live operating point; the dashboard graphs the trend over time.".into(),
            },
        }
    }
}

impl Default for FanThermalEngine {
    fn default() -> Self {
        Self::new()
    }
}

fn nvidia_gpu_temp() -> Option<f32> {
    let out = std::process::Command::new("nvidia-smi")
        .args(["--query-gpu=temperature.gpu", "--format=csv,noheader,nounits"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout).lines().next()?.trim().parse().ok()
}

pub fn thermal_score(hottest_c: f32) -> u8 {
    (100.0 - (hottest_c - 55.0).max(0.0) * 1.6).clamp(0.0, 100.0).round() as u8
}

pub fn thermal_grade(hottest_c: f32) -> &'static str {
    match hottest_c as u32 {
        0..=64 => "optimal",
        65..=78 => "good",
        79..=87 => "warm",
        88..=94 => "hot",
        _ => "critical",
    }
}

fn rec(severity: &str, title: &str, detail: &str) -> ThermalRecommendation {
    ThermalRecommendation { severity: severity.into(), title: title.into(), detail: detail.into() }
}

fn thermal_recommendations(
    cpu_c: Option<f32>,
    gpu_c: Option<f32>,
    ssd_c: Option<f32>,
    fan: &FanInfo,
) -> Vec<ThermalRecommendation> {
    let mut out = Vec::new();
    if cpu_c.is_some_and(|t| t >= 90.0) {
        out.push(rec("critical", "CPU thermal limit", "CPU is at/over 90°C. Apply a more aggressive fan curve or reduce load."));
    } else if cpu_c.is_some_and(|t| t >= 82.0) {
        out.push(rec("warning", "CPU running hot", "CPU is above 82°C under load. A custom fan curve will lower peaks."));
    }
    if gpu_c.is_some_and(|t| t >= 83.0) {
        out.push(rec("warning", "GPU running hot", "GPU is above 83°C. Increase airflow or cap the frame rate."));
    }
    if ssd_c.is_some_and(|t| t >= 65.0) {
        out.push(rec("info", "SSD warm", "NVMe above 65°C may thermal-throttle. Check airflow over the drive."));
    }
    if !fan.fan_curve_enabled && (cpu_c.is_some_and(|t| t >= 78.0) || gpu_c.is_some_and(|t| t >= 78.0)) {
        out.push(rec("info", "Enable a fan curve", "Temps are climbing with the firmware curve. A custom curve (Phase 3.4B) gives finer control."));
    }
    if out.is_empty() {
        out.push(rec("info", "Thermals optimal", "Temperatures are well within range. No action needed."));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_driver_curve_format() {
        let c = parse_curve("50:30 70:60 85:100");
        assert_eq!(c.len(), 3);
        assert_eq!(c[1].temp_c, 70);
        assert_eq!(c[1].pct, 60);
        assert!(parse_curve("(unset)").is_empty());
    }

    #[test]
    fn thermal_scoring_buckets() {
        assert_eq!(thermal_grade(50.0), "optimal");
        assert_eq!(thermal_grade(85.0), "warm");
        assert_eq!(thermal_grade(96.0), "critical");
        assert!(thermal_score(50.0) >= 90);
        assert!(thermal_score(95.0) < 50);
    }

    #[test]
    fn recommends_fan_curve_when_hot_and_disabled() {
        let fan = FanInfo {
            capabilities: FanThermalEngine::new().capabilities(),
            cpu_rpm: Some(3000), gpu_rpm: Some(3200), max_fan: false,
            fan_curve_enabled: false, thermal_profile: "normal".into(), temp_zone: "auto".into(),
            curve: vec![], attributes: vec![],
        };
        let recs = thermal_recommendations(Some(84.0), Some(70.0), Some(40.0), &fan);
        assert!(recs.iter().any(|r| r.title.contains("CPU") || r.title.contains("fan curve")));
    }
}
