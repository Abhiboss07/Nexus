//! Fan & Thermal subsystem.
//!
//! Phase 3.4A (this): discovery, telemetry, capability detection, thermal
//! intelligence — all READ-ONLY, validated against the real omen-rgb-keyboard
//! fan interface before any write support.
//!
//! Phase 3.4B (prepared, not active): fan writes (curve / thermal_profile /
//! max_fan) reusing the RGB safety model (capability detection, validation,
//! verify-after-write, rollback, permission handling, transactional writes).

pub mod control; // Phase 3.4B — real fan writes
pub mod engine;
pub mod profiles;

pub use control::FanControlEngine;
pub use engine::{CurvePoint, FanInfo, FanThermalEngine, ThermalReport};
pub use profiles::{FanProfile, FanProfileStore};
