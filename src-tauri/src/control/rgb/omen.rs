//! `OmenRgbController` — drives the HP OMEN four-zone keyboard via the
//! `omen-rgb-keyboard` sysfs interface, through the SafeWriter.
//!
//! sysfs (base = /sys/devices/platform/omen-rgb-keyboard/rgb_zones):
//!   zone00..zone03  bare `rrggbb` hex   (per-zone color)
//!   all             bare `rrggbb` hex   (all zones)
//!   brightness      0..100
//!   animation_mode  one of the 11 effect names
//!   animation_speed 1..10
//!
//! The driver runs the animation in-kernel, so we just select the mode + speed
//! and (for color-based effects) the base color.

use std::sync::Arc;

use super::color::Rgb;
use super::effects;
use crate::control::safe_writer::{FsOps, SafeWriter, WriteOp};
use crate::control::traits::*;
use crate::telemetry::hardware::Vendor;

pub const OMEN_RGB_BASE: &str = "/sys/devices/platform/omen-rgb-keyboard/rgb_zones";

pub struct OmenRgbController {
    vendor: Vendor,
    writer: SafeWriter,
    zone_count: u32,
}

impl OmenRgbController {
    pub fn new(vendor: Vendor, base: &str, fs: Arc<dyn FsOps>) -> Self {
        // Count zoneNN files present (typically 4).
        let mut zone_count = 0;
        for i in 0..8 {
            if fs.exists(&format!("{base}/{}", zone_file(i))) {
                zone_count += 1;
            } else {
                break;
            }
        }
        Self {
            vendor,
            writer: SafeWriter::new(base, fs),
            zone_count: zone_count.max(1),
        }
    }

    /// Validate a request and lower it to a batch of sysfs writes.
    fn plan(&self, req: &RgbRequest) -> Result<Vec<WriteOp>, ControlError> {
        if !effects::is_valid(&req.effect) {
            return Err(ControlError::InvalidParameter(format!("unknown effect '{}'", req.effect)));
        }
        if req.brightness > 100 {
            return Err(ControlError::InvalidParameter("brightness must be 0–100".into()));
        }
        // Resolve color write target ("all" or a specific zone).
        let target = match &req.zone {
            None => "all".to_string(),
            Some(z) => {
                let idx = z.strip_prefix("zone").and_then(|n| n.parse::<u32>().ok());
                match idx {
                    Some(i) if i < self.zone_count => zone_file(i),
                    _ => return Err(ControlError::InvalidParameter(format!("invalid zone '{z}'"))),
                }
            }
        };

        let color = Rgb::from_hue(req.hue);
        let mut ops = Vec::new();

        // 1) Base color first (driver also records it as the "original" color
        //    that brightness then scales). Only for color-based effects.
        if effects::uses_base_color(&req.effect) {
            ops.push(WriteOp::new(target, color.to_driver_hex()));
        }
        // 2) Brightness.
        ops.push(WriteOp::new("brightness", req.brightness.to_string()));
        // 3) Speed (harmless for static).
        ops.push(WriteOp::new("animation_speed", effects::to_driver_speed(req.speed).to_string()));
        // 4) Mode last, so it engages with the freshly-set color.
        ops.push(WriteOp::new("animation_mode", req.effect.clone()));

        Ok(ops)
    }
}

fn zone_file(i: u32) -> String {
    format!("zone{i:02}")
}

impl Controller for OmenRgbController {
    fn name(&self) -> &'static str {
        "omen-rgb-keyboard"
    }
    fn vendor(&self) -> Vendor {
        self.vendor
    }
}

impl RgbController for OmenRgbController {
    fn set(&self, req: &RgbRequest) -> ControlResult {
        let ops = self.plan(req)?;
        self.writer.apply(&ops)?;
        Ok(ControlOutcome {
            applied: true,
            dry_run: false,
            message: format!("Applied {} @ {}% brightness", req.effect, req.brightness),
        })
    }

    fn off(&self) -> ControlResult {
        // Brightness 0 scales every zone to black (reversible by re-applying).
        self.writer.apply(&[WriteOp::new("brightness", "0")])?;
        Ok(ControlOutcome { applied: true, dry_run: false, message: "Lighting off".into() })
    }

    fn state(&self) -> Option<RgbState> {
        let effect = self.writer.read("animation_mode").ok().unwrap_or_default();
        let brightness = self.writer.read("brightness").ok().and_then(|s| s.parse().ok()).unwrap_or(0);
        let driver_speed: u8 = self.writer.read("animation_speed").ok().and_then(|s| s.parse().ok()).unwrap_or(1);
        let mut zones = Vec::new();
        for i in 0..self.zone_count {
            if let Ok(v) = self.writer.read(&zone_file(i)) {
                // Normalize to "#rrggbb".
                let normalized = Rgb::parse(&v).map(|c| format!("#{}", c.to_driver_hex())).unwrap_or(v);
                zones.push(normalized);
            }
        }
        Some(RgbState {
            effect,
            brightness,
            speed: (driver_speed.min(10) as u32 * 10) as u8, // 1..10 → ~10..100
            zones,
        })
    }

    fn zone_count(&self) -> u32 {
        self.zone_count
    }
}

#[cfg(test)]
mod tests {
    use crate::control::safe_writer::test_fs::MockFs;
    use super::*;

    fn base_files() -> Vec<(String, String)> {
        let mut v = vec![
            (format!("{OMEN_RGB_BASE}/all"), "#000000".into()),
            (format!("{OMEN_RGB_BASE}/brightness"), "100".into()),
            (format!("{OMEN_RGB_BASE}/animation_mode"), "static".into()),
            (format!("{OMEN_RGB_BASE}/animation_speed"), "1".into()),
        ];
        for i in 0..4 {
            v.push((format!("{OMEN_RGB_BASE}/zone{i:02}"), "#000000".into()));
        }
        v
    }

    fn controller(readonly: &[&str]) -> (OmenRgbController, Arc<MockFs>) {
        let files: Vec<(String, String)> = base_files();
        let refs: Vec<(&str, &str)> = files.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let fs = Arc::new(MockFs::new(&refs, readonly));
        let ctl = OmenRgbController::new(Vendor::Omen, OMEN_RGB_BASE, fs.clone());
        (ctl, fs)
    }

    #[test]
    fn detects_four_zones() {
        let (ctl, _) = controller(&[]);
        assert_eq!(ctl.zone_count(), 4);
    }

    #[test]
    fn static_red_writes_color_and_mode() {
        let (ctl, fs) = controller(&[]);
        let req = RgbRequest { effect: "static".into(), hue: 0, brightness: 90, speed: 50, zone: None };
        let out = ctl.set(&req).unwrap();
        assert!(out.applied);
        assert_eq!(fs.get(&format!("{OMEN_RGB_BASE}/all")).unwrap(), "ff0000");
        assert_eq!(fs.get(&format!("{OMEN_RGB_BASE}/animation_mode")).unwrap(), "static");
        assert_eq!(fs.get(&format!("{OMEN_RGB_BASE}/brightness")).unwrap(), "90");
    }

    #[test]
    fn rainbow_skips_base_color() {
        let (ctl, fs) = controller(&[]);
        ctl.set(&RgbRequest { effect: "rainbow".into(), hue: 200, brightness: 80, speed: 100, zone: None }).unwrap();
        // Color not overwritten (rainbow generates its own palette).
        assert_eq!(fs.get(&format!("{OMEN_RGB_BASE}/all")).unwrap(), "#000000");
        assert_eq!(fs.get(&format!("{OMEN_RGB_BASE}/animation_mode")).unwrap(), "rainbow");
        assert_eq!(fs.get(&format!("{OMEN_RGB_BASE}/animation_speed")).unwrap(), "10");
    }

    #[test]
    fn rejects_unknown_effect_and_bad_zone() {
        let (ctl, _) = controller(&[]);
        assert!(ctl.set(&RgbRequest { effect: "lava".into(), hue: 0, brightness: 50, speed: 50, zone: None }).is_err());
        assert!(ctl.set(&RgbRequest { effect: "static".into(), hue: 0, brightness: 50, speed: 50, zone: Some("zone09".into()) }).is_err());
    }

    #[test]
    fn permission_denied_rolls_back() {
        // animation_mode read-only → write fails after color+brightness applied;
        // those must roll back to their prior values.
        let mode = format!("{OMEN_RGB_BASE}/animation_mode");
        let (ctl, fs) = controller(&[&mode]);
        let res = ctl.set(&RgbRequest { effect: "static".into(), hue: 0, brightness: 90, speed: 50, zone: None });
        assert!(matches!(res, Err(ControlError::PermissionDenied)));
        assert_eq!(fs.get(&format!("{OMEN_RGB_BASE}/all")).unwrap(), "#000000");
        assert_eq!(fs.get(&format!("{OMEN_RGB_BASE}/brightness")).unwrap(), "100");
    }

    #[test]
    fn reads_state() {
        let (ctl, _) = controller(&[]);
        ctl.set(&RgbRequest { effect: "aurora".into(), hue: 270, brightness: 75, speed: 60, zone: None }).unwrap();
        let st = ctl.state().unwrap();
        assert_eq!(st.effect, "aurora");
        assert_eq!(st.brightness, 75);
        assert_eq!(st.zones.len(), 4);
    }
}
