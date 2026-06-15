//! Battery Intelligence Engine (Phase 3.3A — read-only).
//!
//! Reads `/sys/class/power_supply/BAT{0,1}` and produces a rich report: health,
//! wear, score, runtime, lifespan prediction, capacity-degradation trend (from a
//! persisted history log), and smart recommendations. Pure math lives in
//! `analytics`; this module handles I/O, persistence and report composition.

use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;

use super::analytics::{self, BatteryGrade, LifespanEstimate};

fn read(base: &str, attr: &str) -> Option<String> {
    std::fs::read_to_string(format!("{base}/{attr}"))
        .ok()
        .map(|s| s.trim().to_string())
}
fn read_u64(base: &str, attr: &str) -> Option<u64> {
    read(base, attr).and_then(|s| s.parse().ok())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryRecommendation {
    pub severity: String, // info | warning | critical
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BatterySample {
    pub ts: u64,
    pub capacity: f32,
    pub health_percent: f32,
    pub energy_full_wh: f32,
    pub power_w: f32,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DegradationTrend {
    pub samples: usize,
    pub first_full_wh: f32,
    pub current_full_wh: f32,
    pub lost_wh: f32,
    pub span_days: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatteryReport {
    pub present: bool,
    pub status: String,
    pub capacity_level: String,
    pub technology: String,
    pub manufacturer: String,
    pub model: String,
    pub serial: String,
    pub charge_percent: f32,
    pub health_percent: f32,
    pub wear_percent: f32,
    pub score: u8,
    pub grade: BatteryGrade,
    pub design_wh: f32,
    pub full_wh: f32,
    pub now_wh: f32,
    pub voltage_v: f32,
    pub voltage_min_design_v: f32,
    pub cycle_count: u32,
    pub charging: bool,
    pub power_draw_w: f32,
    pub charge_rate_w: f32,
    pub discharge_rate_w: f32,
    pub runtime_min: Option<u32>,
    pub lifespan: LifespanEstimate,
    pub degradation: DegradationTrend,
    pub recommendations: Vec<BatteryRecommendation>,
}

/// One probed sysfs path that *would* back a charge-threshold control, with
/// whether it exists on this machine. Lets the UI show concrete evidence rather
/// than an unexplained "unavailable".
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChargeLimitProbe {
    pub path: String,
    pub exists: bool,
    pub purpose: String,
}

/// Ground-truth evidence for whether Linux can cap this battery's charge level.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChargeLimitEvidence {
    /// True only when a real, writable threshold interface exists.
    pub supported: bool,
    pub battery: Option<String>,
    pub vendor_label: String,
    /// Plain-language explanation shown to the user.
    pub explanation: String,
    pub probes: Vec<ChargeLimitProbe>,
}

/// Probe every interface that could expose a battery charge threshold on Linux
/// and report exactly what is (and isn't) present. Read-only.
pub fn charge_limit_evidence(vendor_label: &str, is_hp: bool) -> ChargeLimitEvidence {
    let base = [
        "/sys/class/power_supply/BAT0",
        "/sys/class/power_supply/BAT1",
    ]
    .into_iter()
    .find(|p| std::path::Path::new(p).exists());

    let exists = |p: &str| std::path::Path::new(p).exists();
    let mut probes = Vec::new();
    if let Some(b) = base {
        for (attr, purpose) in [
            (
                "charge_control_end_threshold",
                "Standard kernel charge cap (stop charging at N%)",
            ),
            (
                "charge_control_start_threshold",
                "Standard kernel charge start threshold",
            ),
            (
                "charge_behaviour",
                "Conservation / charge-behaviour control",
            ),
            ("charge_type", "Adaptive/standard charge-type control"),
        ] {
            let path = format!("{b}/{attr}");
            probes.push(ChargeLimitProbe {
                exists: exists(&path),
                path,
                purpose: purpose.into(),
            });
        }
    }
    for (path, purpose) in [
        (
            "/sys/devices/platform/hp-wmi",
            "HP WMI platform driver (would expose HP battery controls)",
        ),
        (
            "/sys/bus/platform/drivers/ideapad_acpi",
            "Lenovo conservation-mode driver",
        ),
    ] {
        probes.push(ChargeLimitProbe {
            exists: exists(path),
            path: path.into(),
            purpose: purpose.into(),
        });
    }

    let supported = probes
        .iter()
        .take(3) // the three battery-node controls; platform drivers alone aren't enough
        .any(|p| p.exists);

    let explanation = if supported {
        "A kernel charge-threshold interface is present — charge limits can be applied.".into()
    } else if is_hp {
        "HP firmware exposes no battery charge-threshold interface on Linux. None of the standard kernel control nodes (charge_control_end_threshold, charge_behaviour) or an hp-wmi battery interface are present, so there is nothing to write to. This is a firmware limitation, not a missing feature.".to_string()
    } else {
        "Your firmware does not expose battery charge thresholds to Linux. None of the standard kernel control nodes are present on this machine.".to_string()
    };

    ChargeLimitEvidence {
        supported,
        battery: base.map(String::from),
        vendor_label: vendor_label.to_string(),
        explanation,
        probes,
    }
}

/// Apply a charge-end threshold through the kernel interface, but ONLY when the
/// node actually exists (`charge_control_end_threshold`). On hardware that does
/// not expose it (e.g. HP OMEN firmware) this returns an honest error instead of
/// pretending — the UI never shows interactive controls in that case.
pub fn set_charge_limit(percent: u8) -> Result<String, String> {
    if !(20..=100).contains(&percent) {
        return Err("Charge limit must be between 20% and 100%.".into());
    }
    let base = [
        "/sys/class/power_supply/BAT0",
        "/sys/class/power_supply/BAT1",
    ]
    .into_iter()
    .find(|p| std::path::Path::new(p).exists())
    .ok_or("No battery present.")?;
    let node = format!("{base}/charge_control_end_threshold");
    if !std::path::Path::new(&node).exists() {
        return Err(
            "This firmware does not expose a charge-threshold interface to Linux — there is no node to write.".into(),
        );
    }
    std::fs::write(&node, percent.to_string()).map_err(|e| {
        if e.kind() == std::io::ErrorKind::PermissionDenied {
            format!("Permission denied writing {node}. This node is typically root-owned; a udev rule or polkit action is required.")
        } else {
            format!("Failed to set charge limit: {e}")
        }
    })?;
    Ok(format!("Charge limit set to {percent}%."))
}

pub struct BatteryEngine {
    history_path: PathBuf,
}

impl BatteryEngine {
    pub fn new() -> Self {
        let base = std::env::var("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
                    .join(".config")
            });
        let dir = base.join("nexus");
        let _ = std::fs::create_dir_all(&dir);
        Self {
            history_path: dir.join("battery-history.json"),
        }
    }

    fn base_path(&self) -> Option<&'static str> {
        [
            "/sys/class/power_supply/BAT0",
            "/sys/class/power_supply/BAT1",
        ]
        .into_iter()
        .find(|p| std::path::Path::new(p).exists())
    }

    pub fn history(&self) -> Vec<BatterySample> {
        std::fs::read_to_string(&self.history_path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    /// Append a sample at most every ~6 hours so the trend log stays compact.
    fn record(&self, sample: &BatterySample) {
        let mut hist = self.history();
        let due = hist
            .last()
            .map_or(true, |l| sample.ts.saturating_sub(l.ts) > 6 * 3600 * 1000);
        if !due {
            return;
        }
        hist.push(sample.clone());
        if hist.len() > 365 {
            let excess = hist.len() - 365;
            hist.drain(0..excess);
        }
        if let Ok(json) = serde_json::to_string(&hist) {
            let _ = std::fs::write(&self.history_path, json);
        }
    }

    pub fn report(&self) -> Option<BatteryReport> {
        let base = self.base_path()?;
        if read(base, "present").as_deref() != Some("1") {
            return None;
        }

        let status = read(base, "status").unwrap_or_else(|| "Unknown".into());
        let charging = status.eq_ignore_ascii_case("Charging");
        let capacity = read(base, "capacity")
            .and_then(|s| s.parse().ok())
            .unwrap_or(0.0);
        let cycle_count = read_u64(base, "cycle_count").unwrap_or(0) as u32;
        let voltage_v = read_u64(base, "voltage_now")
            .map(|v| v as f32 / 1e6)
            .unwrap_or(0.0);
        let voltage_min = read_u64(base, "voltage_min_design")
            .map(|v| v as f32 / 1e6)
            .unwrap_or(0.0);
        let power_w = read_u64(base, "power_now")
            .map(|p| p as f32 / 1e6)
            .unwrap_or(0.0);

        // Prefer energy_* (µWh); fall back to charge_* (µAh) × voltage.
        let (now_wh, full_wh, design_wh) = if let Some(en) = read_u64(base, "energy_now") {
            (
                en as f32 / 1e6,
                read_u64(base, "energy_full").unwrap_or(0) as f32 / 1e6,
                read_u64(base, "energy_full_design").unwrap_or(0) as f32 / 1e6,
            )
        } else {
            let v = if voltage_v > 0.0 { voltage_v } else { 1.0 };
            (
                read_u64(base, "charge_now").unwrap_or(0) as f32 / 1e6 * v,
                read_u64(base, "charge_full").unwrap_or(0) as f32 / 1e6 * v,
                read_u64(base, "charge_full_design").unwrap_or(0) as f32 / 1e6 * v,
            )
        };

        let health = analytics::health_percent(full_wh, design_wh);
        let wear = analytics::wear_percent(full_wh, design_wh);
        let score = analytics::score(health, cycle_count);
        let lifespan = analytics::lifespan(health, cycle_count);
        let runtime_min = analytics::runtime_minutes(now_wh, full_wh, power_w, charging);

        // Log + compute degradation trend.
        let sample = BatterySample {
            ts: now_ms(),
            capacity,
            health_percent: health,
            energy_full_wh: full_wh,
            power_w,
            status: status.clone(),
        };
        self.record(&sample);
        let degradation = self.degradation(full_wh);

        let recommendations = recommendations(health, capacity, cycle_count, &status, charging);

        Some(BatteryReport {
            present: true,
            status: status.to_lowercase(),
            capacity_level: read(base, "capacity_level").unwrap_or_default(),
            technology: read(base, "technology").unwrap_or_default(),
            manufacturer: read(base, "manufacturer").unwrap_or_default(),
            model: read(base, "model_name").unwrap_or_default(),
            serial: read(base, "serial_number").unwrap_or_default(),
            charge_percent: capacity,
            health_percent: health,
            wear_percent: wear,
            score,
            grade: analytics::grade(score),
            design_wh,
            full_wh,
            now_wh,
            voltage_v,
            voltage_min_design_v: voltage_min,
            cycle_count,
            charging,
            power_draw_w: power_w,
            charge_rate_w: if charging { power_w } else { 0.0 },
            discharge_rate_w: if !charging && !status.eq_ignore_ascii_case("Full") {
                power_w
            } else {
                0.0
            },
            runtime_min,
            lifespan,
            degradation,
            recommendations,
        })
    }

    fn degradation(&self, current_full_wh: f32) -> DegradationTrend {
        let hist = self.history();
        let first = hist.first();
        let first_full = first.map(|s| s.energy_full_wh).unwrap_or(current_full_wh);
        let span_days = match (hist.first(), hist.last()) {
            (Some(a), Some(b)) => (b.ts.saturating_sub(a.ts)) as f32 / (86_400_000.0),
            _ => 0.0,
        };
        DegradationTrend {
            samples: hist.len(),
            first_full_wh: first_full,
            current_full_wh,
            lost_wh: (first_full - current_full_wh).max(0.0),
            span_days,
        }
    }

    /// Human-readable Markdown battery report for export.
    pub fn export_markdown(&self) -> Option<String> {
        let r = self.report()?;
        let mut s = String::new();
        s.push_str("# Nexus Battery Report\n\n");
        s.push_str(&format!("**Model:** {} ({})  \n", r.model, r.manufacturer));
        s.push_str(&format!("**Technology:** {}  \n", r.technology));
        s.push_str(&format!("**Serial:** {}\n\n", r.serial));
        s.push_str("## Health\n\n");
        s.push_str(&format!("- Score: **{}/100** ({:?})\n", r.score, r.grade));
        s.push_str(&format!(
            "- Health: {:.1}%  ·  Wear: {:.1}%\n",
            r.health_percent, r.wear_percent
        ));
        s.push_str(&format!(
            "- Capacity: {:.1} Wh full / {:.1} Wh design\n",
            r.full_wh, r.design_wh
        ));
        s.push_str(&format!("- Cycles: {}\n", r.cycle_count));
        s.push_str(&format!(
            "- Voltage: {:.2} V (min design {:.2} V)\n\n",
            r.voltage_v, r.voltage_min_design_v
        ));
        s.push_str("## Lifespan\n\n");
        s.push_str(&format!("- {}\n", r.lifespan.summary));
        s.push_str(&format!(
            "- Equivalent cycles consumed: ~{}\n\n",
            r.lifespan.equivalent_cycles
        ));
        s.push_str("## Recommendations\n\n");
        for rec in &r.recommendations {
            s.push_str(&format!(
                "- **[{}] {}** — {}\n",
                rec.severity, rec.title, rec.detail
            ));
        }
        Some(s)
    }
}

impl Default for BatteryEngine {
    fn default() -> Self {
        Self::new()
    }
}

fn rec(severity: &str, title: &str, detail: &str) -> BatteryRecommendation {
    BatteryRecommendation {
        severity: severity.into(),
        title: title.into(),
        detail: detail.into(),
    }
}

fn recommendations(
    health: f32,
    capacity: f32,
    cycles: u32,
    status: &str,
    charging: bool,
) -> Vec<BatteryRecommendation> {
    let mut out = Vec::new();

    if health < 60.0 {
        out.push(rec(
            "critical",
            "Significant battery wear",
            "Health is below 60%. Consider a battery replacement for full runtime.",
        ));
    } else if health < 80.0 {
        out.push(rec(
            "warning",
            "Battery aging",
            "Health is below 80%. Set an 80% charge limit to slow further wear.",
        ));
    }

    if capacity >= 99.0 && (status.eq_ignore_ascii_case("Full") || charging) {
        out.push(rec(
            "info",
            "Avoid sitting at 100%",
            "Keeping Li-ion at full charge accelerates wear. An 80% charge cap improves longevity.",
        ));
    }

    if cycles > 800 {
        out.push(rec(
            "warning",
            "High cycle count",
            "Over 800 charge cycles. Expect gradual capacity loss; consider power-saver habits.",
        ));
    }

    if !charging && status.eq_ignore_ascii_case("Discharging") {
        out.push(rec(
            "info",
            "On battery",
            "Enable Battery Saver to extend runtime and reduce heat.",
        ));
    }

    if out.is_empty() {
        out.push(rec(
            "info",
            "Battery healthy",
            "No action needed. Occasional full discharges help calibrate the gauge.",
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recommends_charge_limit_at_full() {
        let recs = recommendations(90.0, 100.0, 0, "Full", false);
        assert!(recs.iter().any(|r| r.title.contains("100%")));
    }

    #[test]
    fn flags_low_health() {
        let recs = recommendations(70.0, 50.0, 0, "Discharging", false);
        assert!(recs.iter().any(|r| r.severity == "warning"));
    }
}
