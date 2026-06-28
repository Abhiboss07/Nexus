//! Backend battery-event engine — the single source of truth for power-transition
//! events. It runs on the telemetry poll thread, so events fire whether or not
//! the UI window is open. For each detected edge it:
//!   1. records a persistent notification (the bell history),
//!   2. fires a native desktop notification (visible with the window closed),
//!   3. emits `battery://event` so an open UI can layer on its toast + sound +
//!      animation.
//!
//! Detection mirrors the former React hook (hysteresis bands, fast/slow-charge
//! classification) so behaviour is identical — just moved off the webview.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::telemetry::types::BatteryTelemetry;

/// Charge-wattage bands for fast/slow classification (heuristic).
const FAST_W: f32 = 45.0;
const SLOW_W: f32 = 18.0;
/// Level hysteresis so events fire on entry and don't flap at the boundary.
const LOW_ON: f32 = 20.0;
const LOW_OFF: f32 = 23.0;
const CRIT_ON: f32 = 10.0;
const CRIT_OFF: f32 = 13.0;
const FULL_ON: f32 = 99.5;
const FULL_OFF: f32 = 97.0;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Event {
    Connect,
    Disconnect,
    FastCharge,
    SlowCharge,
    Full,
    Low,
    Critical,
}

impl Event {
    /// Stable id matching the frontend `BatteryEvent` union.
    fn id(self) -> &'static str {
        match self {
            Event::Connect => "connect",
            Event::Disconnect => "disconnect",
            Event::FastCharge => "fastCharge",
            Event::SlowCharge => "slowCharge",
            Event::Full => "full",
            Event::Low => "low",
            Event::Critical => "critical",
        }
    }

    fn title(self) -> &'static str {
        match self {
            Event::Connect => "AC Power Connected",
            Event::Disconnect => "Running on Battery",
            Event::FastCharge => "Fast Charging",
            Event::SlowCharge => "Slow Charging",
            Event::Full => "Fully Charged",
            Event::Low => "Battery Low",
            Event::Critical => "Battery Critical",
        }
    }

    fn severity(self) -> &'static str {
        match self {
            Event::Low => "warning",
            Event::Critical => "critical",
            _ => "info",
        }
    }

    fn body(self, b: &BatteryTelemetry) -> String {
        let pct = b.charge_percent.round() as i32;
        match self {
            Event::Connect => format!("Charging · {pct}%"),
            Event::Disconnect => format!("{pct}% · unplugged"),
            Event::FastCharge => format!("{:.0} W · {pct}%", b.power_draw_w),
            Event::SlowCharge => format!("{:.0} W · trickle charge", b.power_draw_w),
            Event::Full => "Battery at 100%".to_string(),
            Event::Low => format!("{pct}% remaining"),
            Event::Critical => format!("{pct}% — plug in soon"),
        }
    }
}

/// Active-charging check from a Linux power-supply status string. Mirrors the TS
/// `isCharging`: never match "discharging" / "not charging".
fn is_charging(status: &str) -> bool {
    let s = status.to_ascii_lowercase();
    if s.contains("discharg") || s.contains("not charg") {
        return false;
    }
    s.contains("charg")
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EventPayload {
    event: &'static str,
    charge_percent: f32,
    status: String,
    power_w: f32,
}

/// Stateful edge detector. One instance lives on the telemetry thread.
#[derive(Default)]
pub struct BatteryEventEngine {
    seeded: bool,
    prev_charging: bool,
    charge_class_fired: bool,
    in_low: bool,
    in_critical: bool,
    was_full: bool,
}

impl BatteryEventEngine {
    pub fn new() -> Self {
        Self::default()
    }

    /// Evaluate a battery reading and fire any events detected. The first reading
    /// only seeds baselines, so we never fire on launch.
    pub fn evaluate(&mut self, app: &AppHandle, bat: &BatteryTelemetry) {
        if !bat.present {
            return;
        }
        let charging = is_charging(&bat.status);
        let pct = bat.charge_percent;
        let full = bat.status.eq_ignore_ascii_case("full") || pct >= FULL_ON;

        if !self.seeded {
            self.seeded = true;
            self.prev_charging = charging;
            self.in_low = !charging && pct <= LOW_ON;
            self.in_critical = !charging && pct <= CRIT_ON;
            self.was_full = full;
            self.charge_class_fired = charging;
            return;
        }

        // AC connect / disconnect edges.
        if charging != self.prev_charging {
            if charging {
                self.fire(app, Event::Connect, bat);
                self.charge_class_fired = false; // re-classify fast/slow for the new session
            } else {
                self.fire(app, Event::Disconnect, bat);
            }
            self.prev_charging = charging;
        }

        // Fast / slow classification, once per charging session.
        if charging && !self.charge_class_fired && bat.power_draw_w > 1.0 {
            self.charge_class_fired = true;
            if bat.power_draw_w >= FAST_W {
                self.fire(app, Event::FastCharge, bat);
            } else if bat.power_draw_w <= SLOW_W {
                self.fire(app, Event::SlowCharge, bat);
            }
        }

        // Fully charged (hysteresis).
        if full && !self.was_full {
            self.fire(app, Event::Full, bat);
            self.was_full = true;
        } else if !full && self.was_full && pct < FULL_OFF {
            self.was_full = false;
        }

        // Low / critical — only while discharging, with hysteresis.
        if !charging {
            if !self.in_critical && pct <= CRIT_ON {
                self.fire(app, Event::Critical, bat);
                self.in_critical = true;
            } else if self.in_critical && pct > CRIT_OFF {
                self.in_critical = false;
            }
            if !self.in_low && pct <= LOW_ON && pct > CRIT_ON {
                self.fire(app, Event::Low, bat);
                self.in_low = true;
            } else if self.in_low && pct > LOW_OFF {
                self.in_low = false;
            }
        } else {
            if pct > LOW_OFF {
                self.in_low = false;
            }
            if pct > CRIT_OFF {
                self.in_critical = false;
            }
        }
    }

    fn fire(&self, app: &AppHandle, ev: Event, bat: &BatteryTelemetry) {
        let body = ev.body(bat);
        // 1) persistent bell record
        crate::notifications::push(app, "battery", ev.severity(), ev.title(), &body);
        // 2) native desktop notification (visible with the window closed)
        crate::notifications::notify_native(app, ev.title(), &body);
        // 3) live event for an open UI (toast + sound + in-app animation)
        let _ = app.emit(
            "battery://event",
            EventPayload {
                event: ev.id(),
                charge_percent: bat.charge_percent,
                status: bat.status.clone(),
                power_w: bat.power_draw_w,
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bat(status: &str, pct: f32, power: f32) -> BatteryTelemetry {
        BatteryTelemetry {
            present: true,
            status: status.to_string(),
            charge_percent: pct,
            health_percent: 90.0,
            cycle_count: 100,
            energy_now_wh: 40.0,
            energy_full_wh: 50.0,
            energy_design_wh: 58.0,
            power_draw_w: power,
            voltage_v: 12.0,
            time_remaining_min: None,
        }
    }

    #[test]
    fn is_charging_never_matches_discharging() {
        assert!(is_charging("Charging"));
        assert!(!is_charging("Discharging"));
        assert!(!is_charging("Not charging"));
        assert!(!is_charging("full")); // "full" isn't actively charging
    }

    #[test]
    fn ids_match_frontend_union() {
        assert_eq!(Event::Connect.id(), "connect");
        assert_eq!(Event::FastCharge.id(), "fastCharge");
        assert_eq!(Event::Critical.id(), "critical");
    }

    #[test]
    fn body_formats_percent() {
        assert_eq!(Event::Connect.body(&bat("Charging", 73.4, 45.0)), "Charging · 73%");
        assert_eq!(Event::Critical.body(&bat("Discharging", 8.0, 12.0)), "8% — plug in soon");
    }

    #[test]
    fn severity_mapping() {
        assert_eq!(Event::Low.severity(), "warning");
        assert_eq!(Event::Critical.severity(), "critical");
        assert_eq!(Event::Connect.severity(), "info");
    }
}
