//! System Health Engine. Aggregates per-subsystem health into a single 0–100
//! score, sourcing real telemetry + the battery / thermal / GPU engines.

use serde::Serialize;

use crate::control::battery::BatteryReport;
use crate::control::fan::ThermalReport;
use crate::control::gpu::GpuIntelligence;
use crate::telemetry::types::Snapshot;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subsystem {
    pub name: String,
    pub score: u8,
    /// optimal | good | warning | critical
    pub status: String,
    pub detail: String,
    /// Relative contribution to the overall score.
    pub weight: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemHealth {
    pub overall_score: u8,
    pub grade: String,
    pub subsystems: Vec<Subsystem>,
}

fn status_for(score: u8) -> &'static str {
    match score {
        85..=100 => "optimal",
        70..=84 => "good",
        50..=69 => "warning",
        _ => "critical",
    }
}

fn thermal_score(temp: f32) -> u8 {
    (100.0 - (temp - 55.0).max(0.0) * 1.6).clamp(0.0, 100.0).round() as u8
}

fn pressure_score(usage: f32) -> u8 {
    (100.0 - (usage - 60.0).max(0.0) * 1.8).clamp(0.0, 100.0).round() as u8
}

fn sub(name: &str, score: u8, detail: String, weight: f32) -> Subsystem {
    Subsystem { name: name.into(), score, status: status_for(score).into(), detail, weight }
}

pub fn compute(
    snapshot: &Snapshot,
    battery: Option<&BatteryReport>,
    thermal: Option<&ThermalReport>,
    gpu: Option<&GpuIntelligence>,
) -> SystemHealth {
    let mut subs: Vec<Subsystem> = Vec::new();

    // CPU — thermal headroom.
    let cpu_temp = thermal.and_then(|t| t.cpu_c).or(snapshot.cpu.temperature_c).unwrap_or(0.0);
    subs.push(sub("CPU", thermal_score(cpu_temp), format!("{cpu_temp:.0}°C · {:.0}% load", snapshot.cpu.usage), 0.22));

    // GPU — from its intelligence (already blends thermal + VRAM + link).
    if let Some(g) = gpu {
        subs.push(sub("GPU", g.health_score, format!("score {} · {:.0}% VRAM", g.gaming_readiness, g.vram_pressure), 0.2));
    }

    // Memory — pressure.
    subs.push(sub("Memory", pressure_score(snapshot.memory.usage), format!("{:.0}% used", snapshot.memory.usage), 0.15));

    // Storage — usage + SMART.
    if let Some(disk) = snapshot.storage.iter().max_by(|a, b| a.usage.total_cmp(&b.usage)) {
        let mut s = pressure_score(disk.usage);
        if disk.smart_status == "failing" {
            s = s.min(20);
        }
        subs.push(sub("Storage", s, format!("{} {:.0}% · SMART {}", disk.mount_point, disk.usage, disk.smart_status), 0.13));
    }

    // Battery — state of health.
    if let Some(b) = battery {
        subs.push(sub("Battery", b.score, format!("{:.0}% health · {} cycles", b.health_percent, b.cycle_count), 0.18));
    }

    // Thermal — overall hottest.
    if let Some(t) = thermal {
        let hottest = [t.cpu_c, t.gpu_c, t.ssd_c].into_iter().flatten().fold(0.0_f32, f32::max);
        subs.push(sub("Thermals", thermal_score(hottest), format!("peak {hottest:.0}°C"), 0.12));
    }

    // Weighted overall (renormalize over present subsystems).
    let total_w: f32 = subs.iter().map(|s| s.weight).sum();
    let overall = if total_w > 0.0 {
        (subs.iter().map(|s| s.score as f32 * s.weight).sum::<f32>() / total_w).round() as u8
    } else {
        0
    };

    SystemHealth {
        overall_score: overall,
        grade: status_for(overall).into(),
        subsystems: subs,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::types::*;

    #[test]
    fn cool_idle_system_scores_high() {
        let mut s = Snapshot::default();
        s.cpu.temperature_c = Some(45.0);
        s.cpu.usage = 10.0;
        s.memory.usage = 30.0;
        let h = compute(&s, None, None, None);
        assert!(h.overall_score >= 85, "{}", h.overall_score);
        assert_eq!(h.grade, "optimal");
    }

    #[test]
    fn hot_loaded_system_scores_lower() {
        let mut s = Snapshot::default();
        s.cpu.temperature_c = Some(95.0);
        s.memory.usage = 95.0;
        let h = compute(&s, None, None, None);
        assert!(h.overall_score < 70, "{}", h.overall_score);
    }
}
