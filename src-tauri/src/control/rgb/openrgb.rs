//! `OpenRgbController` — portable RGB via the OpenRGB CLI (vendor-agnostic).
//!
//! Drives `openrgb --mode <Mode> --color <hex>`; covers any device OpenRGB
//! supports. Phase 3.1 uses the CLI for robustness (no hand-rolled SDK socket
//! protocol); a future revision can swap in the binary SDK without changing the
//! trait surface.

use std::process::Command;

use super::color::Rgb;
use super::effects;
use crate::control::traits::*;
use crate::telemetry::hardware::Vendor;

pub struct OpenRgbController {
    #[allow(dead_code)] // kept for vendor-specific branching
    vendor: Vendor,
}

impl OpenRgbController {
    pub fn new(vendor: Vendor) -> Self {
        Self { vendor }
    }

    fn run(&self, args: &[String]) -> ControlResult {
        match Command::new("openrgb").args(args).output() {
            Ok(out) if out.status.success() => Ok(ControlOutcome {
                applied: true,
                dry_run: false,
                message: "Applied via OpenRGB".into(),
            }),
            Ok(out) => Err(ControlError::Io(
                String::from_utf8_lossy(&out.stderr).trim().to_string(),
            )),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Err(
                ControlError::DriverUnavailable("openrgb not installed".into()),
            ),
            Err(e) => Err(ControlError::Io(e.to_string())),
        }
    }
}

impl Controller for OpenRgbController {
    fn name(&self) -> &'static str {
        "openrgb"
    }
    fn vendor(&self) -> Vendor {
        self.vendor
    }
}

impl RgbController for OpenRgbController {
    fn set(&self, req: &RgbRequest) -> ControlResult {
        if !effects::is_valid(&req.effect) {
            return Err(ControlError::InvalidParameter(format!(
                "unknown effect '{}'",
                req.effect
            )));
        }
        let color = Rgb::from_hue(req.hue);
        let args = vec![
            "--mode".into(),
            effects::to_openrgb_mode(&req.effect).into(),
            "--color".into(),
            color.to_driver_hex(),
            "--brightness".into(),
            req.brightness.min(100).to_string(),
        ];
        self.run(&args)
    }

    fn off(&self) -> ControlResult {
        self.run(&[
            "--mode".into(),
            "Static".into(),
            "--color".into(),
            "000000".into(),
        ])
    }

    fn state(&self) -> Option<RgbState> {
        None // OpenRGB CLI doesn't expose a clean read-back path.
    }

    fn zone_count(&self) -> u32 {
        0
    }
}
