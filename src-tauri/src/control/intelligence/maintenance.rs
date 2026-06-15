//! Predictive Maintenance Engine. Projects future issues from real history +
//! engine outputs: battery end-of-life, storage capacity, and thermal drift.
//! Every insight is evidence-backed with a bounded confidence and (when derivable
//! from real data) an ETA.

use serde::Serialize;

use super::recommendations::Evidence;
use super::trends;
use crate::control::battery::BatteryReport;
use crate::telemetry::types::{HistoryPoint, Snapshot};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaintenanceInsight {
    pub component: String,
    pub prediction: String,
    /// Days until the predicted event, when computable from real data.
    pub eta_days: Option<f32>,
    pub confidence: u8,
    pub severity: String, // info | warning | critical
    pub evidence: Vec<Evidence>,
}

pub fn predict(
    snapshot: &Snapshot,
    history: &[HistoryPoint],
    battery: Option<&BatteryReport>,
) -> Vec<MaintenanceInsight> {
    let mut out = Vec::new();

    // ---- Battery end-of-life (from the real lifespan model) ----
    if let Some(b) = battery {
        let eta_days = b.lifespan.years_remaining * 365.0;
        let sev = if b.health_percent < 70.0 {
            "warning"
        } else {
            "info"
        };
        out.push(MaintenanceInsight {
            component: "Battery".into(),
            prediction: b.lifespan.summary.clone(),
            eta_days: if eta_days > 0.0 { Some(eta_days) } else { None },
            // More cycles consumed + lower health ⇒ higher confidence in the curve.
            confidence: (60.0 + (b.wear_percent / 20.0).clamp(0.0, 1.0) * 30.0).round() as u8,
            severity: sev.into(),
            evidence: vec![
                Evidence::new("Health", format!("{:.0}%", b.health_percent), "80% EOL"),
                Evidence::new("Equivalent cycles", b.lifespan.equivalent_cycles, "500"),
            ],
        });
    }

    // ---- Storage capacity ----
    if let Some(disk) = snapshot
        .storage
        .iter()
        .max_by(|a, b| a.usage.total_cmp(&b.usage))
    {
        if disk.usage >= 75.0 {
            out.push(MaintenanceInsight {
                component: "Storage".into(),
                prediction: format!(
                    "{} is {:.0}% full — plan a cleanup before performance degrades.",
                    disk.mount_point, disk.usage
                ),
                eta_days: None, // no fill-rate history yet to project an ETA
                confidence: (60.0 + (disk.usage - 75.0)).clamp(0.0, 95.0).round() as u8,
                severity: if disk.usage >= 90.0 {
                    "warning"
                } else {
                    "info"
                }
                .into(),
                evidence: vec![Evidence::new(
                    &format!("{} used", disk.mount_point),
                    format!("{:.0}%", disk.usage),
                    "90%",
                )],
            });
        }
        if disk.smart_status == "failing" {
            out.push(MaintenanceInsight {
                component: "Storage".into(),
                prediction: format!(
                    "{} reports a failing SMART status — back up and replace the drive soon.",
                    disk.device
                ),
                eta_days: None,
                confidence: 95,
                severity: "critical".into(),
                evidence: vec![Evidence::new("SMART", "failing", "passed")],
            });
        }
    }

    // ---- Thermal drift (rising temps over the session ⇒ dust / aging paste) ----
    let cpu_temp = trends::analyze(history)
        .metrics
        .into_iter()
        .find(|m| m.metric == "CPU Temp");
    if let Some(t) = cpu_temp {
        // Slope is °C/sample; flag a meaningful sustained rise with enough data.
        if t.samples >= 30 && t.slope > 0.15 && t.max > 80.0 {
            out.push(MaintenanceInsight {
                component: "Cooling".into(),
                prediction: "CPU temperatures are trending upward this session — check for dust buildup or aging thermal paste.".into(),
                eta_days: None,
                confidence: (55.0 + (t.slope * 100.0).clamp(0.0, 40.0)).round() as u8,
                severity: "info".into(),
                evidence: vec![
                    Evidence::new("Temp slope", format!("+{:.2}°C/sample", t.slope), "0.15"),
                    Evidence::new("Peak", format!("{:.0}°C", t.max), "80°C"),
                ],
            });
        }
    }

    if out.is_empty() {
        out.push(MaintenanceInsight {
            component: "System".into(),
            prediction: "No maintenance needed — all components are within healthy ranges.".into(),
            eta_days: None,
            confidence: 88,
            severity: "info".into(),
            evidence: vec![],
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::types::*;

    #[test]
    fn predicts_battery_eol_from_report() {
        let mut b = battery_report_stub();
        b.health_percent = 85.0;
        b.wear_percent = 15.0;
        b.lifespan.years_remaining = 0.4;
        b.lifespan.summary = "≈144 cycles until 80% EOL.".into();
        let out = predict(&Snapshot::default(), &[], Some(&b));
        let batt = out.iter().find(|i| i.component == "Battery").unwrap();
        assert!(batt.eta_days.is_some());
        assert!(batt.confidence >= 60);
    }

    #[test]
    fn flags_failing_smart_critical() {
        let mut s = Snapshot::default();
        s.storage.push(StorageTelemetry {
            device: "nvme0".into(),
            mount_point: "/".into(),
            filesystem: "btrfs".into(),
            total_bytes: 1,
            used_bytes: 1,
            usage: 50.0,
            temperature_c: None,
            read_bytes_sec: 0,
            write_bytes_sec: 0,
            smart_status: "failing".into(),
        });
        let out = predict(&s, &[], None);
        assert!(out.iter().any(|i| i.severity == "critical"));
    }

    fn battery_report_stub() -> BatteryReport {
        use crate::control::battery::analytics::{BatteryGrade, LifespanEstimate};
        BatteryReport {
            present: true,
            status: "full".into(),
            capacity_level: "Full".into(),
            technology: "Li-ion".into(),
            manufacturer: "x".into(),
            model: "y".into(),
            serial: "z".into(),
            charge_percent: 100.0,
            health_percent: 85.0,
            wear_percent: 15.0,
            score: 86,
            grade: BatteryGrade::Good,
            design_wh: 83.0,
            full_wh: 71.0,
            now_wh: 71.0,
            voltage_v: 12.7,
            voltage_min_design_v: 11.5,
            cycle_count: 0,
            charging: false,
            power_draw_w: 0.0,
            charge_rate_w: 0.0,
            discharge_rate_w: 0.0,
            runtime_min: None,
            lifespan: LifespanEstimate {
                equivalent_cycles: 356,
                cycles_to_eol: 144,
                years_remaining: 0.4,
                summary: "x".into(),
            },
            degradation: crate::control::battery::engine::DegradationTrend {
                samples: 1,
                first_full_wh: 71.0,
                current_full_wh: 71.0,
                lost_wh: 0.0,
                span_days: 0.0,
            },
            recommendations: vec![],
        }
    }
}
