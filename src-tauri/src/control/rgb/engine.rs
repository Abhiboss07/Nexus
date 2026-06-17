//! `RgbEngine` — the high-level RGB façade used by IPC. Owns the active RGB
//! controller (selected from the detected capability) and the profile store, and
//! exposes apply / off / state / presets / profile CRUD + import-export.

use std::sync::{Arc, Mutex};

use super::omen::{OmenRgbController, OMEN_RGB_BASE};
use super::openrgb::OpenRgbController;
use super::profiles::{presets, ProfileStore, RgbProfile};
use crate::control::capabilities::RgbCapability;
use crate::control::safe_writer::RealFs;
use crate::control::traits::{
    ControlError, ControlOutcome, ControlResult, RgbController, RgbRequest, RgbState,
};
use crate::telemetry::hardware::Vendor;

/// Where an RGB write originated — surfaced in `[RGB WRITE][source=…]` logs so a
/// regression (unsolicited writes on startup/hydration/telemetry) is traceable
/// to its caller. Only `User`, `Profile`, and `Automation` are ever legitimate;
/// `Startup`/`Telemetry` exist purely so an accidental write is *named* in logs.
#[derive(Debug, Clone, Copy)]
pub enum RgbSource {
    /// Explicit user gesture (Apply, slider/effect change, command bar).
    User,
    /// A saved/built-in profile was explicitly loaded.
    Profile,
    /// Per-game / nexus automation rule fired.
    Automation,
    #[allow(dead_code)]
    Startup,
    #[allow(dead_code)]
    Telemetry,
}

impl RgbSource {
    fn as_str(self) -> &'static str {
        match self {
            RgbSource::User => "user",
            RgbSource::Profile => "profile",
            RgbSource::Automation => "automation",
            RgbSource::Startup => "startup",
            RgbSource::Telemetry => "telemetry",
        }
    }
}

pub struct RgbEngine {
    controller: Option<Box<dyn RgbController>>,
    store: ProfileStore,
    /// Last request actually written to hardware. Drives the "skip identical
    /// re-write" safeguard so a stray apply with unchanged values is a no-op.
    last: Mutex<Option<RgbRequest>>,
}

impl RgbEngine {
    /// Pick the controller implied by the detected RGB capability.
    pub fn new(caps: &RgbCapability, vendor: Vendor) -> Self {
        let controller: Option<Box<dyn RgbController>> = if caps.status.controllable {
            match caps.status.driver.as_str() {
                "omen-rgb-keyboard" => Some(Box::new(OmenRgbController::new(
                    vendor,
                    OMEN_RGB_BASE,
                    Arc::new(RealFs),
                ))),
                "openrgb" => Some(Box::new(OpenRgbController::new(vendor))),
                _ => None,
            }
        } else {
            None
        };
        Self {
            controller,
            store: ProfileStore::new(),
            last: Mutex::new(None),
        }
    }

    pub fn has_controller(&self) -> bool {
        self.controller.is_some()
    }

    fn ctl(&self) -> Result<&dyn RgbController, ControlError> {
        self.controller
            .as_deref()
            .ok_or_else(|| ControlError::DriverUnavailable("no RGB controller".into()))
    }

    /// The single hardware-write chokepoint. Every RGB write — user, profile, or
    /// automation — flows through here so logging, source attribution, and the
    /// skip-if-unchanged safeguard are applied uniformly and cannot be bypassed.
    pub fn apply(&self, req: &RgbRequest, source: RgbSource) -> ControlResult {
        // Safeguard (#7): never touch hardware when the request matches what we
        // last wrote. Makes redundant applies (re-loads, re-mounts) free no-ops.
        if let Ok(last) = self.last.lock() {
            if last.as_ref() == Some(req) {
                crate::logging::line(
                    "INFO",
                    &format!(
                        "[RGB WRITE][source={}] skipped — unchanged (effect={} hue={} brightness={} speed={})",
                        source.as_str(), req.effect, req.hue, req.brightness, req.speed
                    ),
                );
                return Ok(ControlOutcome {
                    applied: false,
                    dry_run: false,
                    message: "Lighting already matches — no hardware write".into(),
                });
            }
        }
        crate::logging::line(
            "INFO",
            &format!(
                "[RGB WRITE][source={}] apply effect={} hue={} brightness={} speed={}",
                source.as_str(), req.effect, req.hue, req.brightness, req.speed
            ),
        );
        let outcome = self.ctl()?.set(req)?;
        if let Ok(mut last) = self.last.lock() {
            *last = Some(req.clone());
        }
        Ok(outcome)
    }

    pub fn off(&self, source: RgbSource) -> ControlResult {
        crate::logging::line(
            "INFO",
            &format!("[RGB WRITE][source={}] off", source.as_str()),
        );
        let outcome = self.ctl()?.off()?;
        // Invalidate the cache so the next apply always re-writes (the panel is
        // now dark and won't match any prior request).
        if let Ok(mut last) = self.last.lock() {
            *last = None;
        }
        Ok(outcome)
    }

    pub fn state(&self) -> Option<RgbState> {
        self.controller.as_ref().and_then(|c| c.state())
    }

    #[allow(dead_code)]
    pub fn zone_count(&self) -> u32 {
        self.controller
            .as_ref()
            .map(|c| c.zone_count())
            .unwrap_or(0)
    }

    pub fn presets(&self) -> Vec<RgbProfile> {
        presets()
    }

    pub fn list_profiles(&self) -> Vec<RgbProfile> {
        self.store.list()
    }

    pub fn save_profile(&self, profile: &RgbProfile) -> Result<(), ControlError> {
        self.store.save(profile)
    }

    /// Load a saved profile and apply it to the hardware.
    pub fn apply_profile(&self, name: &str, source: RgbSource) -> ControlResult {
        let profile = self.store.load(name)?;
        let outcome = self.apply(&profile.to_request(), source)?;
        Ok(ControlOutcome {
            message: format!("Applied profile '{}'", profile.name),
            ..outcome
        })
    }

    pub fn delete_profile(&self, name: &str) -> Result<(), ControlError> {
        self.store.delete(name)
    }

    pub fn export_profile(&self, name: &str) -> Result<String, ControlError> {
        self.store.export(name)
    }

    pub fn import_profile(&self, json: &str) -> Result<RgbProfile, ControlError> {
        self.store.import(json)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control::traits::Controller;

    /// Minimal stand-in controller — every `set`/`off` succeeds. The dedupe
    /// safeguard lives in the engine, so we observe it via the `applied` flag.
    struct FakeController;

    impl Controller for FakeController {
        fn name(&self) -> &'static str {
            "fake"
        }
        fn vendor(&self) -> Vendor {
            Vendor::Generic
        }
    }

    impl RgbController for FakeController {
        fn set(&self, _req: &RgbRequest) -> ControlResult {
            Ok(ControlOutcome {
                applied: true,
                dry_run: false,
                message: "ok".into(),
            })
        }
        fn off(&self) -> ControlResult {
            Ok(ControlOutcome {
                applied: true,
                dry_run: false,
                message: "off".into(),
            })
        }
        fn state(&self) -> Option<RgbState> {
            None
        }
        fn zone_count(&self) -> u32 {
            4
        }
    }

    fn engine() -> RgbEngine {
        RgbEngine {
            controller: Some(Box::new(FakeController)),
            store: ProfileStore::new(),
            last: Mutex::new(None),
        }
    }

    fn req(effect: &str, hue: u16) -> RgbRequest {
        RgbRequest {
            effect: effect.into(),
            hue,
            brightness: 80,
            speed: 50,
            zone: None,
        }
    }

    #[test]
    fn identical_reapply_is_skipped() {
        let e = engine();
        let r = req("aurora", 270);

        // First apply writes hardware.
        let first = e.apply(&r, RgbSource::User).unwrap();
        assert!(first.applied, "first apply should hit hardware");

        // Second identical apply is a no-op (safeguard #7).
        let second = e.apply(&r, RgbSource::User).unwrap();
        assert!(!second.applied, "identical re-apply must be skipped");

        // A changed value writes again.
        let third = e.apply(&req("rainbow", 0), RgbSource::User).unwrap();
        assert!(third.applied, "changed request must hit hardware");
    }

    #[test]
    fn off_invalidates_cache_so_next_apply_writes() {
        let e = engine();
        let r = req("static", 120);
        assert!(e.apply(&r, RgbSource::User).unwrap().applied);
        assert!(!e.apply(&r, RgbSource::User).unwrap().applied); // deduped
        e.off(RgbSource::User).unwrap();
        // After off, the same request must write again (panel is dark now).
        assert!(e.apply(&r, RgbSource::User).unwrap().applied);
    }
}
