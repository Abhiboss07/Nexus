//! Concrete controller implementations.
//!
//! Phase 2B ships three: `OmenController` (HP OMEN/Victus via hp-wmi),
//! `OpenRgbController` (any device with an OpenRGB server), and
//! `GenericController` (vendor-neutral sysfs: platform_profile, charge
//! thresholds, pwm, supergfxctl). Other vendors (ROG/TUF/Legion/Alienware) fall
//! back to Generic + OpenRGB until dedicated drivers arrive in Phase 3.

pub mod generic;
pub mod omen;

pub use generic::GenericController;
pub use omen::OmenController;
