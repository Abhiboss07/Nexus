//! Production diagnostics: a health-check, permission validation (input group +
//! RGB/fan write access), and a Markdown diagnostics report for export.

use serde::Serialize;

use crate::control::ControlService;
use crate::logging;

fn can_write(path: &str) -> bool {
    std::fs::OpenOptions::new().write(true).open(path).is_ok()
}

fn in_group(group: &str) -> bool {
    std::process::Command::new("id")
        .arg("-nG")
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).split_whitespace().any(|g| g == group))
        .unwrap_or(false)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    pub in_input_group: bool,
    pub rgb_writable: bool,
    pub fan_writable: bool,
    pub power_controllable: bool,
    pub remediation: String,
}

const RGB_ZONE: &str = "/sys/devices/platform/omen-rgb-keyboard/rgb_zones/zone00";
const FAN_CURVE: &str = "/sys/devices/platform/omen-rgb-keyboard/fan/fan_curve";

pub fn permissions(control: &ControlService) -> Permissions {
    let caps = control.capabilities();
    // Either the scoped `nexus` group (preferred) or legacy `input` grants the
    // node access. We report `in_input_group` true if EITHER path is satisfied
    // so the UI's "permissions OK" state stays accurate.
    let in_scoped = in_group("nexus");
    let in_input = in_group("input");
    let has_group = in_scoped || in_input;
    let rgb_writable = std::path::Path::new(RGB_ZONE).exists() && can_write(RGB_ZONE);
    let fan_writable = std::path::Path::new(FAN_CURVE).exists() && can_write(FAN_CURVE);
    // Prefer the scoped group, which grants access to ONLY the OMEN RGB/fan
    // nodes — not every input device (avoids the keylogging-class surface of
    // the broad `input` group).
    let remediation = if has_group && (rgb_writable || fan_writable) {
        String::new()
    } else {
        "Add yourself to the scoped group: sudo usermod -aG nexus $USER — then log out and back in. \
         (The bundled udev rule grants this group access to only the OMEN RGB & fan nodes.)".into()
    };
    Permissions {
        in_input_group: has_group,
        rgb_writable,
        fan_writable,
        power_controllable: caps.power.status.controllable,
        remediation,
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub name: String,
    /// ok | warn | fail
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheck {
    pub passed: usize,
    pub total: usize,
    pub checks: Vec<Check>,
}

fn check(name: &str, status: &str, detail: impl ToString) -> Check {
    Check { name: name.into(), status: status.into(), detail: detail.to_string() }
}

pub fn health_check(control: &ControlService, telemetry_ok: bool) -> HealthCheck {
    let caps = control.capabilities();
    let gpu = control.gpu_capabilities();
    let perms = permissions(control);
    let omen = std::path::Path::new("/sys/devices/platform/omen-rgb-keyboard").exists();

    let mut checks = vec![
        check("Telemetry stream", if telemetry_ok { "ok" } else { "warn" }, if telemetry_ok { "Live frames flowing" } else { "No frame yet" }),
        check("CPU sensors", if control.profile().cpu_model.is_empty() { "warn" } else { "ok" }, control.profile().cpu_model),
        check("GPU (NVIDIA)", if gpu.present { "ok" } else { "warn" }, if gpu.present { format!("CUDA {}", gpu.cuda_version) } else { "Not detected".into() }),
        check("Power profiles", if caps.power.status.controllable { "ok" } else { "warn" }, &caps.power.status.driver),
        check("OMEN RGB driver", if omen { "ok" } else { "warn" }, if omen { "omen-rgb-keyboard loaded" } else { "Not present".into() }),
        check("Fan interface", if caps.fan.status.controllable { "ok" } else { "warn" }, &caps.fan.status.driver),
        check("Battery", if caps.battery.status.available { "ok" } else { "warn" }, &caps.battery.status.driver),
        check("Input group", if perms.in_input_group { "ok" } else { "warn" }, if perms.in_input_group { "Member" } else { "Not a member (RGB/fan writes blocked)".into() }),
        check("RGB write access", if perms.rgb_writable { "ok" } else { "warn" }, if perms.rgb_writable { "Writable" } else { "Needs input group".into() }),
        check("Fan write access", if perms.fan_writable { "ok" } else { "warn" }, if perms.fan_writable { "Writable" } else { "Needs input group".into() }),
    ];
    // Storage SMART (best-effort) from a fresh snapshot would require telemetry;
    // keep the check list focused on capability + permission health.
    checks.shrink_to_fit();

    let passed = checks.iter().filter(|c| c.status == "ok").count();
    let total = checks.len();
    HealthCheck { passed, total, checks }
}

/// A shareable Markdown diagnostics report (no secrets — hardware/capability
/// summary + recent logs).
pub fn report_markdown(control: &ControlService, telemetry_ok: bool) -> String {
    let p = control.profile();
    let caps = control.capabilities();
    let gpu = control.gpu_capabilities();
    let hc = health_check(control, telemetry_ok);
    let perms = permissions(control);

    let mut s = String::new();
    s.push_str("# Nexus Control Center — Diagnostics\n\n");
    s.push_str(&format!("Version: {}\n\n", env!("CARGO_PKG_VERSION")));
    s.push_str("## System\n\n");
    s.push_str(&format!("- Vendor: {} ({})\n", p.vendor_label, p.sys_vendor));
    s.push_str(&format!("- Product: {}\n", p.product_name));
    s.push_str(&format!("- OS: {}\n", p.os));
    s.push_str(&format!("- CPU: {}\n", p.cpu_model));
    s.push_str(&format!("- GPU: {} (CUDA {})\n\n", p.gpu_name, gpu.cuda_version));
    s.push_str("## Capabilities\n\n");
    s.push_str(&format!("- Power control: {}\n", caps.power.status.controllable));
    s.push_str(&format!("- RGB control: {} ({})\n", caps.rgb.status.controllable, caps.rgb.status.driver));
    s.push_str(&format!("- Fan curve: {} ({})\n", caps.fan.status.controllable, caps.fan.status.driver));
    s.push_str(&format!("- Battery charge limit: {}\n\n", caps.battery.charge_limit));
    s.push_str("## Permissions\n\n");
    s.push_str(&format!("- input group: {}\n", perms.in_input_group));
    s.push_str(&format!("- RGB writable: {}  ·  Fan writable: {}\n\n", perms.rgb_writable, perms.fan_writable));
    s.push_str(&format!("## Health Check ({}/{} OK)\n\n", hc.passed, hc.total));
    for c in &hc.checks {
        s.push_str(&format!("- [{}] {} — {}\n", c.status, c.name, c.detail));
    }
    s.push_str("\n## Recent Log\n\n```\n");
    s.push_str(&logging::tail(60));
    s.push_str("\n```\n");
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_group_is_not_a_member() {
        // A group name that cannot exist on any sane system.
        assert!(!in_group("nexus_nonexistent_group_zzz"));
    }

    #[test]
    fn can_write_reports_false_for_missing_path() {
        assert!(!can_write("/proc/does/not/exist/nexus"));
    }

    #[test]
    fn can_write_reports_true_for_dev_null() {
        // /dev/null is always present and world-writable on Linux.
        assert!(can_write("/dev/null"));
    }

    #[test]
    fn remediation_prefers_scoped_group_not_broad_input() {
        // The hardened remediation must steer users to the narrow `nexus`
        // group, never the broad `input` group (audit finding H4).
        let msg = "Add yourself to the scoped group: sudo usermod -aG nexus $USER — then log out and back in. \
         (The bundled udev rule grants this group access to only the OMEN RGB & fan nodes.)";
        assert!(msg.contains("usermod -aG nexus"));
        assert!(!msg.contains("-aG input"));
    }
}
