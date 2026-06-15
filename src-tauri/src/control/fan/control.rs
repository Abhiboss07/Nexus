//! Phase 3.4B — Fan Control Engine (PREPARED, not yet wired to IPC/UI).
//!
//! Implements fan writes for the omen-rgb-keyboard interface using the same
//! safety model as RGB:
//!   * capability detection  — refuses if the node is absent / not writable
//!   * validation            — curve points, ranges, profile names
//!   * transactional writes  — via SafeWriter (allowlist + batch + rollback)
//!   * verify-after-write    — reads back and restores on mismatch
//!   * permission handling   — EACCES → PermissionDenied (needs `input` group)
//!
//! Discovery + telemetry are proven on real hardware (Phase 3.4A); these write
//! paths are unit-tested against a mock FS and intentionally NOT exposed through
//! a Tauri command until explicitly activated.

use std::sync::Arc;

use super::engine::{CurvePoint, FAN_BASE, MAX_CURVE_POINTS, PCT_RANGE, TEMP_RANGE};
use super::profiles::FanProfile;
#[cfg(test)]
use crate::control::safe_writer::FsOps;
use crate::control::safe_writer::{RealFs, SafeWriter, WriteOp};
use crate::control::traits::{ControlError, ControlOutcome, ControlResult};

pub const THERMAL_PROFILES: [&str; 3] = ["performance", "normal", "silent"];

/// Validate a fan curve against the driver's constraints (2–8 points, temp
/// 0–120, pct 0–100). Pure → unit-testable.
pub fn validate_curve(points: &[CurvePoint]) -> Result<(), ControlError> {
    if points.len() < 2 || points.len() as u32 > MAX_CURVE_POINTS {
        return Err(ControlError::InvalidParameter(format!(
            "curve needs 2–{MAX_CURVE_POINTS} points (got {})",
            points.len()
        )));
    }
    for p in points {
        if p.temp_c < TEMP_RANGE.0 || p.temp_c > TEMP_RANGE.1 {
            return Err(ControlError::InvalidParameter(format!(
                "temp {} out of 0–120",
                p.temp_c
            )));
        }
        if p.pct < PCT_RANGE.0 || p.pct > PCT_RANGE.1 {
            return Err(ControlError::InvalidParameter(format!(
                "pct {} out of 0–100",
                p.pct
            )));
        }
    }
    Ok(())
}

pub fn format_curve(points: &[CurvePoint]) -> String {
    points
        .iter()
        .map(|p| format!("{}:{}", p.temp_c, p.pct))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Stronger validation with **safety limits** — on top of range/count checks:
///
/// * sorted, strictly-increasing temperatures (no duplicates)
/// * monotonic non-decreasing fan % (never ramp *down* as temps rise)
/// * the top point must command ≥50% fan; ≥85°C ⇒ ≥50%; ≥90°C ⇒ ≥70%
///
/// Returns the safe, sorted points ready to write.
pub fn validate_curve_safe(points: &[CurvePoint]) -> Result<Vec<CurvePoint>, ControlError> {
    validate_curve(points)?;
    let mut sorted = points.to_vec();
    sorted.sort_by_key(|p| p.temp_c);

    for w in sorted.windows(2) {
        if w[0].temp_c == w[1].temp_c {
            return Err(ControlError::InvalidParameter(
                "duplicate temperature point".into(),
            ));
        }
        if w[1].pct < w[0].pct {
            return Err(ControlError::InvalidParameter(
                "fan % must not decrease as temperature rises".into(),
            ));
        }
    }
    let top = sorted.last().expect("validated ≥2 points");
    if top.pct < 50 {
        return Err(ControlError::InvalidParameter(
            "highest curve point must command ≥50% fan for safety".into(),
        ));
    }
    for p in &sorted {
        if p.temp_c >= 90 && p.pct < 70 {
            return Err(ControlError::InvalidParameter(
                "at ≥90°C the fan must be ≥70%".into(),
            ));
        }
        if p.temp_c >= 85 && p.pct < 50 {
            return Err(ControlError::InvalidParameter(
                "at ≥85°C the fan must be ≥50%".into(),
            ));
        }
    }
    Ok(sorted)
}

/// A captured fan state for rollback / restore-previous-profile.
#[derive(Debug, Clone)]
pub struct FanSnapshot {
    pub thermal_profile: Option<String>,
    pub fan_curve: Option<String>,
    pub fan_curve_enable: Option<String>,
    pub max_fan: Option<String>,
}

pub struct FanControlEngine {
    writer: SafeWriter,
}

impl FanControlEngine {
    pub fn new() -> Self {
        Self {
            writer: SafeWriter::new(FAN_BASE, Arc::new(RealFs)),
        }
    }

    #[cfg(test)]
    fn with_fs(fs: Arc<dyn FsOps>) -> Self {
        Self {
            writer: SafeWriter::new(FAN_BASE, fs),
        }
    }

    /// Verify a node now reads `expected`; if not, restore `prior` and error.
    fn verify(
        &self,
        file: &str,
        expected: &str,
        prior: Option<String>,
    ) -> Result<(), ControlError> {
        match self.writer.read(file) {
            Ok(now) if now == expected => Ok(()),
            Ok(now) => {
                if let Some(p) = prior {
                    let _ = self.writer.apply(&[WriteOp::new(file, p)]);
                }
                Err(ControlError::Io(format!(
                    "{file} did not take (still '{now}')"
                )))
            }
            Err(_) => Ok(()), // unreadable EC-backed nodes can't be verified; accept the write
        }
    }

    pub fn set_thermal_profile(&self, name: &str) -> ControlResult {
        if !THERMAL_PROFILES.contains(&name) {
            return Err(ControlError::InvalidParameter(format!(
                "unknown profile '{name}'"
            )));
        }
        let prior = self.writer.read("thermal_profile").ok();
        self.writer
            .apply(&[WriteOp::new("thermal_profile", name)])?;
        // thermal_profile reads back via EC byte→name; only fail on a *different
        // known* value (an unreadable/"unknown" node is accepted).
        if let Ok(now) = self.writer.read("thermal_profile") {
            if now != name && THERMAL_PROFILES.contains(&now.as_str()) {
                if let Some(p) = prior {
                    let _ = self.writer.apply(&[WriteOp::new("thermal_profile", p)]);
                }
                return Err(ControlError::Io(format!(
                    "profile did not switch (still '{now}')"
                )));
            }
        }
        Ok(ControlOutcome {
            applied: true,
            dry_run: false,
            message: format!("Thermal profile → {name}"),
        })
    }

    pub fn set_max_fan(&self, on: bool) -> ControlResult {
        let value = if on { "1" } else { "0" };
        let prior = self.writer.read("max_fan").ok();
        self.writer.apply(&[WriteOp::new("max_fan", value)])?;
        self.verify("max_fan", value, prior)?;
        Ok(ControlOutcome {
            applied: true,
            dry_run: false,
            message: format!("Max fan {}", if on { "on" } else { "off" }),
        })
    }

    /// Apply a custom curve and enable it. Transactional: SafeWriter rolls back
    /// the curve write if enabling fails (e.g. EBUSY while max_fan is active),
    /// and we verify the enable flag took.
    pub fn set_fan_curve(&self, points: &[CurvePoint]) -> ControlResult {
        let safe = validate_curve_safe(points)?; // sorted + safety-checked
        let prior_curve = self.writer.read("fan_curve").ok();
        let prior_enable = self.writer.read("fan_curve_enable").ok();

        self.writer.apply(&[
            WriteOp::new("fan_curve", format_curve(&safe)),
            WriteOp::new("fan_curve_enable", "1"),
        ])?;

        if self.writer.read("fan_curve_enable").ok().as_deref() != Some("1") {
            // Roll back both nodes to their prior state.
            let mut restore = Vec::new();
            if let Some(c) = prior_curve {
                restore.push(WriteOp::new("fan_curve", c));
            }
            restore.push(WriteOp::new(
                "fan_curve_enable",
                prior_enable.unwrap_or_else(|| "0".into()),
            ));
            let _ = self.writer.apply(&restore);
            return Err(ControlError::Io("fan curve did not engage".into()));
        }
        Ok(ControlOutcome {
            applied: true,
            dry_run: false,
            message: format!("Custom fan curve applied ({} points)", points.len()),
        })
    }

    pub fn disable_curve(&self) -> ControlResult {
        self.writer
            .apply(&[WriteOp::new("fan_curve_enable", "0")])?;
        Ok(ControlOutcome {
            applied: true,
            dry_run: false,
            message: "Reverted to firmware fan control".into(),
        })
    }

    /// Capture the current fan state so a failed multi-step change can be undone.
    pub fn snapshot(&self) -> FanSnapshot {
        FanSnapshot {
            thermal_profile: self.writer.read("thermal_profile").ok(),
            fan_curve: self.writer.read("fan_curve").ok(),
            fan_curve_enable: self.writer.read("fan_curve_enable").ok(),
            max_fan: self.writer.read("max_fan").ok(),
        }
    }

    /// Restore a previously captured fan state (best-effort, transactional).
    pub fn restore(&self, snap: &FanSnapshot) -> ControlResult {
        let mut ops = Vec::new();
        // Clear max boost first so the curve can re-engage.
        if let Some(m) = &snap.max_fan {
            ops.push(WriteOp::new("max_fan", m.clone()));
        }
        if let Some(c) = &snap.fan_curve {
            if !c.contains("unset") {
                ops.push(WriteOp::new("fan_curve", c.clone()));
            }
        }
        if let Some(e) = &snap.fan_curve_enable {
            ops.push(WriteOp::new("fan_curve_enable", e.clone()));
        }
        if let Some(tp) = &snap.thermal_profile {
            if THERMAL_PROFILES.contains(&tp.as_str()) {
                ops.push(WriteOp::new("thermal_profile", tp.clone()));
            }
        }
        self.writer.apply(&ops)?;
        Ok(ControlOutcome {
            applied: true,
            dry_run: false,
            message: "Restored previous fan state".into(),
        })
    }

    /// Apply a full fan profile. Composes thermal profile + curve/max-fan into a
    /// single logical change: snapshots first, and on ANY failure restores the
    /// captured state so the machine never ends up half-configured.
    pub fn apply_profile(&self, profile: &FanProfile) -> ControlResult {
        profile.validate()?;
        let snap = self.snapshot();

        let steps = || -> ControlResult {
            if let Some(tp) = &profile.thermal_profile {
                self.set_thermal_profile(tp)?;
            }
            if profile.max_fan {
                let _ = self.disable_curve(); // max_fan overrides any curve
                self.set_max_fan(true)?;
            } else {
                let _ = self.set_max_fan(false);
                if profile.curve.len() >= 2 {
                    self.set_fan_curve(&profile.curve)?;
                } else {
                    let _ = self.disable_curve();
                }
            }
            Ok(ControlOutcome {
                applied: true,
                dry_run: false,
                message: format!("Applied fan profile '{}'", profile.name),
            })
        };

        match steps() {
            Ok(o) => Ok(o),
            Err(e) => {
                let _ = self.restore(&snap);
                Err(e)
            }
        }
    }
}

impl Default for FanControlEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::control::safe_writer::test_fs::MockFs;

    fn pt(t: u32, p: u32) -> CurvePoint {
        CurvePoint { temp_c: t, pct: p }
    }

    fn engine(readonly: &[&str], extra: &[(&str, &str)]) -> (FanControlEngine, Arc<MockFs>) {
        let mut files = vec![
            (format!("{FAN_BASE}/thermal_profile"), "normal".to_string()),
            (format!("{FAN_BASE}/max_fan"), "0".to_string()),
            (format!("{FAN_BASE}/fan_curve"), "(unset)".to_string()),
            (format!("{FAN_BASE}/fan_curve_enable"), "0".to_string()),
        ];
        for (k, v) in extra {
            files.push((format!("{FAN_BASE}/{k}"), v.to_string()));
        }
        let refs: Vec<(&str, &str)> = files
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .collect();
        let fs = Arc::new(MockFs::new(&refs, readonly));
        (FanControlEngine::with_fs(fs.clone()), fs)
    }

    #[test]
    fn validates_curve_bounds() {
        assert!(validate_curve(&[pt(50, 30)]).is_err()); // too few
        assert!(validate_curve(&[pt(50, 30), pt(130, 50)]).is_err()); // temp > 120
        assert!(validate_curve(&[pt(50, 30), pt(80, 120)]).is_err()); // pct > 100
        assert!(validate_curve(&[pt(50, 30), pt(80, 100)]).is_ok());
        let nine: Vec<_> = (0..9).map(|i| pt(40 + i * 5, 10 + i * 5)).collect();
        assert!(validate_curve(&nine).is_err()); // > 8 points
    }

    #[test]
    fn sets_thermal_profile_and_verifies() {
        let (e, fs) = engine(&[], &[]);
        let out = e.set_thermal_profile("performance").unwrap();
        assert!(out.applied);
        assert_eq!(
            fs.get(&format!("{FAN_BASE}/thermal_profile")).unwrap(),
            "performance"
        );
        assert!(e.set_thermal_profile("turbo").is_err()); // invalid name
    }

    #[test]
    fn applies_and_enables_curve() {
        let (e, fs) = engine(&[], &[]);
        e.set_fan_curve(&[pt(45, 20), pt(70, 60), pt(88, 100)])
            .unwrap();
        assert_eq!(
            fs.get(&format!("{FAN_BASE}/fan_curve")).unwrap(),
            "45:20 70:60 88:100"
        );
        assert_eq!(
            fs.get(&format!("{FAN_BASE}/fan_curve_enable")).unwrap(),
            "1"
        );
    }

    #[test]
    fn permission_denied_is_mapped_and_nothing_changes() {
        let tp = format!("{FAN_BASE}/thermal_profile");
        let (e, fs) = engine(&[&tp], &[]);
        assert!(matches!(
            e.set_thermal_profile("silent"),
            Err(ControlError::PermissionDenied)
        ));
        assert_eq!(fs.get(&tp).unwrap(), "normal"); // unchanged
    }

    #[test]
    fn safety_limits_reject_dangerous_curves() {
        // Decreasing fan % as temp rises.
        assert!(validate_curve_safe(&[pt(45, 60), pt(80, 30)]).is_err());
        // Drops to 0% at high temp.
        assert!(validate_curve_safe(&[pt(45, 40), pt(95, 0)]).is_err());
        // ≥90°C must be ≥70%.
        assert!(validate_curve_safe(&[pt(45, 30), pt(92, 60)]).is_err());
        // A sane curve passes and comes back sorted.
        let ok = validate_curve_safe(&[pt(88, 100), pt(45, 30), pt(60, 55)]).unwrap();
        assert_eq!(ok.first().unwrap().temp_c, 45);
        assert_eq!(ok.last().unwrap().temp_c, 88);
    }

    #[test]
    fn apply_profile_composes_and_enables() {
        let (e, fs) = engine(&[], &[]);
        let p = FanProfile {
            name: "Gaming".into(),
            builtin: true,
            thermal_profile: Some("performance".into()),
            curve: vec![pt(45, 35), pt(60, 55), pt(75, 80), pt(88, 100)],
            max_fan: false,
        };
        e.apply_profile(&p).unwrap();
        assert_eq!(
            fs.get(&format!("{FAN_BASE}/thermal_profile")).unwrap(),
            "performance"
        );
        assert_eq!(
            fs.get(&format!("{FAN_BASE}/fan_curve")).unwrap(),
            "45:35 60:55 75:80 88:100"
        );
        assert_eq!(
            fs.get(&format!("{FAN_BASE}/fan_curve_enable")).unwrap(),
            "1"
        );
    }

    #[test]
    fn apply_profile_rolls_back_on_failure() {
        // thermal_profile read-only → first step fails → whole profile rolls back.
        let tp = format!("{FAN_BASE}/thermal_profile");
        let (e, fs) = engine(&[&tp], &[]);
        let p = FanProfile {
            name: "Gaming".into(),
            builtin: true,
            thermal_profile: Some("performance".into()),
            curve: vec![pt(45, 35), pt(88, 100)],
            max_fan: false,
        };
        assert!(e.apply_profile(&p).is_err());
        assert_eq!(fs.get(&tp).unwrap(), "normal"); // unchanged
        assert_eq!(fs.get(&format!("{FAN_BASE}/fan_curve")).unwrap(), "(unset)");
        // never applied
    }

    #[test]
    fn curve_rolls_back_when_enable_blocked() {
        // fan_curve_enable is read-only → enabling fails; SafeWriter rolls back
        // the curve write, so fan_curve returns to its prior value.
        let enable = format!("{FAN_BASE}/fan_curve_enable");
        let (e, fs) = engine(&[&enable], &[]);
        let res = e.set_fan_curve(&[pt(45, 20), pt(80, 90)]);
        assert!(res.is_err());
        assert_eq!(fs.get(&format!("{FAN_BASE}/fan_curve")).unwrap(), "(unset)");
    }
}
