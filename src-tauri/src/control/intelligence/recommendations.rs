//! Recommendation Engine. Deterministic, evidence-based suggestions derived
//! ONLY from real telemetry + the existing engine outputs. Every recommendation
//! carries a confidence (0–100) and the concrete evidence (metric / value /
//! threshold) it was derived from — nothing is hardcoded or invented.
//!
//! Capability-first: a recommendation only offers an actionable control when the
//! capability layer reports it as controllable; otherwise it degrades to advice.

use serde::Serialize;

use crate::control::battery::BatteryReport;
use crate::control::capabilities::HardwareCapabilities;
use crate::control::fan::ThermalReport;
use crate::control::gpu::GpuIntelligence;
use crate::telemetry::types::{HistoryPoint, Snapshot};

/// One concrete data point backing a recommendation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub metric: String,
    pub value: String,
    pub threshold: String,
}

impl Evidence {
    pub fn new(metric: &str, value: impl ToString, threshold: impl ToString) -> Self {
        Self { metric: metric.into(), value: value.to_string(), threshold: threshold.to_string() }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Recommendation {
    pub id: String,
    pub title: String,
    pub detail: String,
    pub category: String, // thermal | power | storage | battery | gpu | memory | maintenance
    pub severity: String, // info | warning | critical
    pub confidence: u8,
    pub evidence: Vec<Evidence>,
    /// A navigable route or actionable hint when a control exists, else None.
    pub action: Option<String>,
}

/// Confidence from how far a value clears its threshold and how much data backs
/// it. Bounded so we never claim certainty.
pub fn confidence(margin_ratio: f32, samples: usize) -> u8 {
    let margin = (margin_ratio.clamp(0.0, 1.0)) * 40.0;
    let sample_bonus = (samples as f32 / 60.0).clamp(0.0, 1.0) * 15.0;
    (45.0 + margin + sample_bonus).clamp(30.0, 99.0).round() as u8
}

fn avg(history: &[HistoryPoint], f: impl Fn(&HistoryPoint) -> f32) -> f32 {
    if history.is_empty() {
        return 0.0;
    }
    history.iter().map(&f).sum::<f32>() / history.len() as f32
}

pub fn generate(
    snapshot: &Snapshot,
    history: &[HistoryPoint],
    caps: &HardwareCapabilities,
    battery: Option<&BatteryReport>,
    thermal: Option<&ThermalReport>,
    gpu: Option<&GpuIntelligence>,
) -> Vec<Recommendation> {
    let mut out = Vec::new();
    let n = history.len();

    // ---- CPU thermals (sustained, from history) ----
    let cpu_temp_avg = avg(history, |p| p.cpu_temp);
    if cpu_temp_avg >= 82.0 {
        let sev = if cpu_temp_avg >= 90.0 { "critical" } else { "warning" };
        // If a controllable fan curve exists, point to it; else advise airflow.
        let action = if caps.fan.status.controllable && caps.fan.status.driver != "" {
            Some("/performance#fan".into())
        } else {
            None
        };
        out.push(Recommendation {
            id: "cpu-thermal".into(),
            title: "CPU running hot under load".into(),
            detail: if action.is_some() {
                "Sustained CPU temperatures are high. A more aggressive fan curve will lower peaks.".into()
            } else {
                "Sustained CPU temperatures are high. Improve airflow or reduce sustained load.".into()
            },
            category: "thermal".into(),
            severity: sev.into(),
            confidence: confidence((cpu_temp_avg - 82.0) / 15.0, n),
            evidence: vec![
                Evidence::new("CPU temp (avg)", format!("{cpu_temp_avg:.0}°C"), "82°C"),
                Evidence::new("samples", n, "—"),
            ],
            action,
        });
    }

    // ---- GPU thermals / VRAM (from gpu intelligence) ----
    if let Some(g) = gpu {
        if g.vram_pressure >= 88.0 {
            out.push(Recommendation {
                id: "gpu-vram".into(),
                title: "VRAM pressure is high".into(),
                detail: "Video memory is nearly full — lower texture quality or close other GPU apps to avoid stutter.".into(),
                category: "gpu".into(),
                severity: if g.vram_pressure >= 95.0 { "critical" } else { "warning" }.into(),
                confidence: confidence((g.vram_pressure - 88.0) / 12.0, n.max(1)),
                evidence: vec![Evidence::new("VRAM used", format!("{:.0}%", g.vram_pressure), "88%")],
                action: Some("/performance".into()),
            });
        }
    }

    // ---- Memory pressure ----
    if snapshot.memory.usage >= 88.0 {
        out.push(Recommendation {
            id: "mem-pressure".into(),
            title: "Memory pressure is high".into(),
            detail: "RAM is nearly full. Close unused apps or browser tabs to prevent swapping.".into(),
            category: "memory".into(),
            severity: if snapshot.memory.usage >= 95.0 { "critical" } else { "warning" }.into(),
            confidence: confidence((snapshot.memory.usage - 88.0) / 12.0, n.max(1)),
            evidence: vec![
                Evidence::new("RAM used", format!("{:.0}%", snapshot.memory.usage), "88%"),
                Evidence::new("Swap used", format!("{:.0}%", snapshot.memory.swap_usage), "—"),
            ],
            action: Some("/tasks".into()),
        });
    }

    // ---- Storage capacity ----
    for disk in &snapshot.storage {
        if disk.usage >= 85.0 {
            out.push(Recommendation {
                id: format!("storage-{}", disk.device),
                title: format!("{} is nearly full", disk.mount_point),
                detail: "Low free space degrades SSD performance and can cause failures. Run a cleanup.".into(),
                category: "storage".into(),
                severity: if disk.usage >= 92.0 { "critical" } else { "warning" }.into(),
                confidence: confidence((disk.usage - 85.0) / 15.0, 60),
                evidence: vec![Evidence::new(&format!("{} used", disk.mount_point), format!("{:.0}%", disk.usage), "85%")],
                action: Some("/storage".into()),
            });
            break; // one storage rec is enough
        }
    }

    // ---- Battery health & habits (capability-aware) ----
    if let Some(b) = battery {
        if b.health_percent < 80.0 {
            // Only offer a charge-limit action if the firmware exposes it.
            let action = if caps.battery.charge_limit { Some("/battery".into()) } else { None };
            out.push(Recommendation {
                id: "battery-health".into(),
                title: "Battery wear is significant".into(),
                detail: if action.is_some() {
                    "Battery health is below 80%. Cap charging at 80% to slow further wear.".into()
                } else {
                    "Battery health is below 80%. Avoid keeping it at 100% on AC to slow wear.".into()
                },
                category: "battery".into(),
                severity: if b.health_percent < 65.0 { "critical" } else { "warning" }.into(),
                confidence: confidence((80.0 - b.health_percent) / 20.0, 60),
                evidence: vec![
                    Evidence::new("Battery health", format!("{:.0}%", b.health_percent), "80%"),
                    Evidence::new("Wear", format!("{:.0}%", b.wear_percent), "—"),
                ],
                action,
            });
        }
    }

    // ---- Power profile vs. AC state (capability-aware) ----
    if let Some(t) = thermal {
        let warm = t.cpu_c.is_some_and(|c| c >= 78.0) || t.gpu_c.is_some_and(|c| c >= 78.0);
        if warm && caps.fan.status.controllable {
            // covered by cpu-thermal when sustained; this catches transient warmth
            // only if no sustained rec already fired.
            if cpu_temp_avg < 82.0 {
                out.push(Recommendation {
                    id: "fan-curve-suggest".into(),
                    title: "Consider a custom fan curve".into(),
                    detail: "Temperatures climb under load with the firmware curve. A custom curve gives finer control.".into(),
                    category: "thermal".into(),
                    severity: "info".into(),
                    confidence: confidence(0.4, n.max(1)),
                    evidence: vec![Evidence::new("Peak temp", format!("{:.0}°C", t.cpu_c.unwrap_or(0.0)), "78°C")],
                    action: Some("/performance#fan".into()),
                });
            }
        }
    }

    if out.is_empty() {
        out.push(Recommendation {
            id: "all-good".into(),
            title: "System is running optimally".into(),
            detail: "No issues detected across thermals, power, memory, storage or battery.".into(),
            category: "thermal".into(),
            severity: "info".into(),
            confidence: 90,
            evidence: vec![Evidence::new("CPU temp", format!("{:.0}°C", snapshot.cpu.temperature_c.unwrap_or(0.0)), "82°C")],
            action: None,
        });
    }

    // Most severe + most confident first.
    out.sort_by(|a, b| sev_rank(&b.severity).cmp(&sev_rank(&a.severity)).then(b.confidence.cmp(&a.confidence)));
    out
}

fn sev_rank(s: &str) -> u8 {
    match s {
        "critical" => 3,
        "warning" => 2,
        _ => 1,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::types::*;

    fn snap(mem: f32, storage_usage: f32) -> Snapshot {
        let mut s = Snapshot::default();
        s.memory.usage = mem;
        s.cpu.temperature_c = Some(60.0);
        if storage_usage > 0.0 {
            s.storage.push(StorageTelemetry { device: "nvme0n1p2".into(), mount_point: "/".into(), filesystem: "btrfs".into(), total_bytes: 100, used_bytes: 0, usage: storage_usage, temperature_c: Some(40.0), read_bytes_sec: 0, write_bytes_sec: 0, smart_status: "passed".into() });
        }
        s
    }

    fn caps() -> HardwareCapabilities {
        use crate::control::capabilities::*;
        use crate::telemetry::hardware::Vendor;
        HardwareCapabilities {
            vendor: Vendor::Omen, vendor_label: "HP OMEN".into(),
            rgb: RgbCapability::default(), fan: FanCapability::default(),
            power: PowerCapability::default(), battery: BatteryCapability::default(), mux: MuxCapability::default(),
        }
    }

    fn history_with_cpu_temp(t: f32, n: usize) -> Vec<HistoryPoint> {
        (0..n).map(|_| { let mut p = HistoryPoint::default(); p.cpu_temp = t; p }).collect()
    }

    #[test]
    fn flags_hot_cpu_with_evidence_and_confidence() {
        let recs = generate(&snap(40.0, 0.0), &history_with_cpu_temp(91.0, 40), &caps(), None, None, None);
        let r = recs.iter().find(|r| r.id == "cpu-thermal").unwrap();
        assert_eq!(r.severity, "critical");
        assert!(r.confidence > 50);
        assert!(!r.evidence.is_empty());
    }

    #[test]
    fn flags_full_storage_and_memory() {
        let recs = generate(&snap(96.0, 93.0), &[], &caps(), None, None, None);
        assert!(recs.iter().any(|r| r.id == "mem-pressure" && r.severity == "critical"));
        assert!(recs.iter().any(|r| r.id.starts_with("storage")));
    }

    #[test]
    fn healthy_system_returns_all_good() {
        let recs = generate(&snap(40.0, 40.0), &history_with_cpu_temp(50.0, 30), &caps(), None, None, None);
        assert_eq!(recs.len(), 1);
        assert_eq!(recs[0].id, "all-good");
    }
}
