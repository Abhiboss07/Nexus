//! RGB control engine (Phase 3.1) — the first real hardware-write feature.
//!
//!   color       — Rgb type, HSV→RGB, driver hex encoding
//!   effects     — the 11 effect catalog + speed/mode mapping
//!   safe_writer — allowlisted, transactional, rolled-back sysfs writes (FsOps)
//!   omen        — OmenRgbController (omen-rgb-keyboard sysfs)
//!   openrgb     — OpenRgbController (portable, OpenRGB CLI)
//!   profiles    — RgbProfile, presets, store, import/export
//!   engine      — RgbEngine façade consumed by IPC

pub mod color;
pub mod effects;
pub mod engine;
pub mod omen;
pub mod openrgb;
pub mod profiles;

pub use engine::RgbEngine;
pub use profiles::RgbProfile;
