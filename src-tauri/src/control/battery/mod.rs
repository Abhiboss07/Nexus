//! Battery Intelligence (Phase 3.3A — read-only analytics over BAT0/BAT1).

pub mod analytics;
pub mod engine;

pub use engine::{BatteryEngine, BatteryReport, BatterySample};
