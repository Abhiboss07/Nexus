//! Hardware control abstraction layer.
//!
//! Layered, vendor-neutral architecture:
//!   traits        — controller interfaces + control types
//!   capabilities  — serializable HardwareCapabilities (consumed by the UI)
//!   detector      — CapabilityDetector + SystemProbe (testable probing)
//!   controllers   — Omen / OpenRGB / Generic implementations
//!   registry      — DriverRegistry → VendorController bundle
//!   service       — ControlService façade (capabilities + dry-run preview)
//!
//! Phase 2B wires the whole framework but performs no hardware writes.

pub mod automation;
pub mod battery;
pub mod capabilities;
pub mod controllers;
pub mod detector;
pub mod fan;
pub mod games;
pub mod gpu;
pub mod hardware_support;
pub mod integrations;
pub mod intelligence;
pub mod nexus;
pub mod plugins;
pub mod power;
pub mod registry;
pub mod rgb;
pub mod safe_writer;
pub mod service;
pub mod traits;

pub use capabilities::HardwareCapabilities;
pub use hardware_support::CompatibilityReport;
pub use service::{ControlAction, ControlService};
