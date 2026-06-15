//! Runtime smoke tests (Release Hardening, finding H2).
//!
//! These exercise the *command-backing* logic end-to-end against the real
//! machine — building the live `ControlService`, running the health check,
//! permission validation, the safety gate, and the process scanner — without
//! linking the webview. They assert structural invariants (not machine-specific
//! values) so they pass both on validated hardware and on a bare CI runner.
//!
//! GUI-level checks (window creation, tray menu, suspend/resume) cannot run
//! headless and are covered by the WebDriver harness in `e2e/` + the documented
//! manual matrix in docs/RELEASE_HARDENING.md.

#![cfg(test)]

use crate::control::hardware_support::SupportTier;
use crate::control::ControlService;
use crate::diagnostics;
use crate::telemetry::{self, ProcessMonitor};

fn service() -> ControlService {
    ControlService::detect(telemetry::hardware::detect())
}

#[test]
fn service_builds_and_reports_compatibility() {
    let svc = service();
    let report = svc.compatibility_report();

    // Tier must be one of the four, and write flags must be consistent with it:
    // an Unsupported/Unknown machine must NEVER report write access.
    match report.tier {
        SupportTier::Unsupported | SupportTier::Unknown => {
            assert!(
                !report.fan_writes,
                "unvalidated hardware must not enable fan writes"
            );
            assert!(
                !report.rgb_writes,
                "unvalidated hardware must not enable rgb writes"
            );
        }
        SupportTier::Validated | SupportTier::Compatible => {
            // At least one validated interface must back a Compatible+ tier.
            assert!(report.fan_writes || report.rgb_writes);
        }
    }
    assert!(!report.summary.is_empty());
    assert!(!report.tier_label.is_empty());
}

#[test]
fn capabilities_respect_the_safety_gate() {
    let svc = service();
    let caps = svc.capabilities();
    let report = svc.compatibility_report();
    // The UI-facing capability flags must match the gate decision exactly, so
    // controls are never shown for a write path the backend will refuse.
    if !report.fan_writes {
        assert!(
            !caps.fan.status.controllable,
            "fan control must be hidden when gate denies writes"
        );
    }
    if !report.rgb_writes {
        assert!(
            !caps.rgb.status.controllable,
            "rgb control must be hidden when gate denies writes"
        );
    }
}

#[test]
fn fan_capability_is_consistent_between_detector_and_engine() {
    // Task 5: the detector's `caps.fan` (used by the doctor + settings) must
    // agree with the FanThermalEngine inspector (used by the fan-control UI).
    // The old bug: detector only knew hp-wmi/hwmon, so it reported fan
    // "unavailable" while the omen-rgb-keyboard interface was actually present
    // and writable — a false warning. When the omen fan dir exists AND the
    // safety gate allows fan writes, both views must report controllable.
    let svc = service();
    let caps = svc.capabilities();
    let report = svc.compatibility_report();
    let fan_dir_present =
        std::path::Path::new("/sys/devices/platform/omen-rgb-keyboard/fan/fan_curve").exists();

    if fan_dir_present && report.fan_writes {
        assert!(
            caps.fan.status.controllable,
            "omen fan interface present + gate allows writes ⇒ caps.fan must be controllable (no false 'unavailable')"
        );
        assert_eq!(caps.fan.status.driver, "omen-rgb-keyboard");
    }
    // And the capability flag must never contradict the gate (defense-in-depth).
    if !report.fan_writes {
        assert!(!caps.fan.status.controllable);
    }
}

#[test]
fn health_check_runs_and_is_well_formed() {
    let svc = service();
    let hc = diagnostics::health_check(&svc, false);
    assert!(hc.total > 0, "health check must produce checks");
    assert!(hc.passed <= hc.total);
    for c in &hc.checks {
        assert!(
            matches!(c.status.as_str(), "ok" | "warn" | "fail"),
            "unexpected status '{}' on check '{}'",
            c.status,
            c.name
        );
        assert!(!c.name.is_empty());
    }
}

#[test]
fn permissions_remediation_never_recommends_broad_input_group() {
    let svc = service();
    let perms = diagnostics::permissions(&svc);
    // Hardened path (finding H4): we must never tell users to join `input`.
    assert!(
        !perms.remediation.contains("-aG input"),
        "remediation must not recommend the broad input group"
    );
    // If a fix is needed it must name the scoped group.
    if !perms.remediation.is_empty() {
        assert!(perms.remediation.contains("nexus"));
    }
}

#[test]
fn diagnostics_export_is_nonempty_markdown() {
    let svc = service();
    let md = diagnostics::report_markdown(&svc, true);
    assert!(md.starts_with("# Nexus Control Center"));
    assert!(md.contains("## Health Check"));
}

#[test]
fn process_scanner_returns_live_rows() {
    let mut mon = ProcessMonitor::new();
    let _ = mon.sample(40); // first pass primes the CPU deltas
    let rows = mon.sample(40);
    assert!(
        !rows.is_empty(),
        "/proc scan should see at least this test process"
    );
    for r in &rows {
        assert!(r.pid > 0);
        assert!(!r.name.is_empty());
        assert!(!r.state.is_empty());
    }
}
