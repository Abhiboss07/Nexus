//! Pure battery analytics — health, wear, score, runtime, lifespan. No I/O, so
//! fully unit-testable and reused by the engine and report exporter.

use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BatteryGrade {
    Excellent,
    Good,
    Fair,
    Poor,
}

/// State-of-health = current full-charge capacity ÷ design capacity.
pub fn health_percent(full_wh: f32, design_wh: f32) -> f32 {
    if design_wh <= 0.0 {
        return 0.0;
    }
    (full_wh / design_wh * 100.0).clamp(0.0, 100.0)
}

pub fn wear_percent(full_wh: f32, design_wh: f32) -> f32 {
    (100.0 - health_percent(full_wh, design_wh)).max(0.0)
}

/// Composite 0–100 battery score: health, with a cycle-count penalty.
pub fn score(health: f32, cycles: u32) -> u8 {
    let cycle_penalty = ((cycles as f32) / 50.0).min(20.0);
    (health - cycle_penalty).clamp(0.0, 100.0).round() as u8
}

pub fn grade(score: u8) -> BatteryGrade {
    match score {
        90..=100 => BatteryGrade::Excellent,
        75..=89 => BatteryGrade::Good,
        55..=74 => BatteryGrade::Fair,
        _ => BatteryGrade::Poor,
    }
}

/// Estimated minutes of runtime/charge time from energy + power draw.
/// `charging` flips the calculation to time-to-full.
pub fn runtime_minutes(
    energy_now_wh: f32,
    energy_full_wh: f32,
    power_w: f32,
    charging: bool,
) -> Option<u32> {
    if power_w < 0.5 {
        return None;
    }
    let hours = if charging {
        (energy_full_wh - energy_now_wh).max(0.0) / power_w
    } else {
        energy_now_wh / power_w
    };
    Some((hours * 60.0).round() as u32)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LifespanEstimate {
    /// Approximate equivalent cycles already consumed (from health if firmware
    /// doesn't report a real cycle count).
    pub equivalent_cycles: u32,
    /// Estimated cycles remaining until the 80%-health end-of-life threshold.
    pub cycles_to_eol: u32,
    /// Rough years remaining assuming ~1 full cycle/day.
    pub years_remaining: f32,
    pub summary: String,
}

/// Li-ion reference: ~80% health after ~500 full cycles. Used to translate
/// health ↔ cycles when the EC reports cycle_count = 0 (common on HP).
pub fn lifespan(health: f32, reported_cycles: u32) -> LifespanEstimate {
    const EOL_HEALTH: f32 = 80.0;
    const CYCLES_TO_EOL_REF: f32 = 500.0; // cycles for 100→80%

    // Equivalent cycles from health degradation (20% over 500 cycles).
    let degraded = (100.0 - health).max(0.0);
    let est_from_health = (degraded / 20.0 * CYCLES_TO_EOL_REF).round() as u32;
    let equivalent_cycles = reported_cycles.max(est_from_health);

    let remaining_health = (health - EOL_HEALTH).max(0.0);
    let cycles_to_eol = (remaining_health / 20.0 * CYCLES_TO_EOL_REF).round() as u32;
    let years_remaining = (cycles_to_eol as f32 / 365.0).max(0.0);

    let summary = if health <= EOL_HEALTH {
        "Battery has reached its typical end-of-life threshold (≤80% health).".into()
    } else {
        format!(
            "≈{cycles_to_eol} cycles (~{:.1} years) until the 80% end-of-life threshold.",
            years_remaining
        )
    };

    LifespanEstimate { equivalent_cycles, cycles_to_eol, years_remaining, summary }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn health_and_wear_from_real_omen_values() {
        // BAT1: full 71.19 Wh, design 83 Wh.
        let h = health_percent(71.19, 83.0);
        assert!((h - 85.77).abs() < 0.1, "health {h}");
        assert!((wear_percent(71.19, 83.0) - 14.22).abs() < 0.1);
    }

    #[test]
    fn score_penalizes_cycles() {
        assert_eq!(score(86.0, 0), 86);
        assert!(score(86.0, 1000) < 86);
        assert_eq!(grade(score(86.0, 0)), BatteryGrade::Good);
        assert_eq!(grade(95), BatteryGrade::Excellent);
    }

    #[test]
    fn runtime_none_when_idle() {
        assert_eq!(runtime_minutes(50.0, 71.0, 0.0, false), None);
        assert!(runtime_minutes(50.0, 71.0, 10.0, false).unwrap() > 0);
    }

    #[test]
    fn lifespan_estimates_from_health_when_cycles_zero() {
        let l = lifespan(85.77, 0);
        assert!(l.equivalent_cycles > 0, "should infer cycles from health");
        assert!(l.cycles_to_eol > 0);
    }
}
