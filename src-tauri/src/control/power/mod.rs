//! Power & performance engine (Phase 3.2).
//!
//!   ppd          — power-profiles-daemon CLI integration
//!   controllers  — LinuxPowerController / OmenPowerController / GenericPowerController
//!   engine       — PowerEngine façade (validate + verify + rollback) + PowerInfo

pub mod controllers;
pub mod engine;
pub mod ppd;

pub use engine::{PowerEngine, PowerInfo, ProfileMeta};
