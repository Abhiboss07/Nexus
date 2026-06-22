//! The telemetry engine: owns all previous-sample state and the rolling history
//! cache, and assembles a `Snapshot` each tick. Expensive, slow-changing sources
//! (storage / SMART) refresh on a coarser cadence to keep the hot loop light.

use std::collections::{HashMap, VecDeque};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use super::collectors::{self, CpuTimes};
use super::hardware::{self, HardwareProfile};
use super::hwmon;
use super::types::*;

const HISTORY_CAP: usize = 120;
const STORAGE_EVERY: u64 = 5; // refresh disk usage/IO every N ticks
const SMART_EVERY: u64 = 30; // refresh SMART health every N ticks

pub struct TelemetryService {
    profile: HardwareProfile,
    prev_cpu: Vec<CpuTimes>,
    prev_rapl: Option<u64>,
    prev_net: Option<(String, u64, u64)>,
    prev_disk: HashMap<String, (u64, u64)>,
    last_instant: Instant,
    last_storage_instant: Instant,
    tick: u64,
    cached_storage: Vec<StorageTelemetry>,
    latest: Option<Snapshot>,
    history: VecDeque<HistoryPoint>,
    /// Previous battery status, for transition logging (charging diagnostics).
    prev_battery_status: Option<String>,
}

impl TelemetryService {
    pub fn new() -> Self {
        Self {
            profile: hardware::detect(),
            prev_cpu: Vec::new(),
            prev_rapl: None,
            prev_net: None,
            prev_disk: HashMap::new(),
            last_instant: Instant::now(),
            last_storage_instant: Instant::now(),
            tick: 0,
            cached_storage: Vec::new(),
            latest: None,
            history: VecDeque::with_capacity(HISTORY_CAP),
            prev_battery_status: None,
        }
    }

    pub fn profile(&self) -> HardwareProfile {
        self.profile.clone()
    }

    pub fn history(&self) -> Vec<HistoryPoint> {
        self.history.iter().cloned().collect()
    }

    pub fn latest(&self) -> Option<Snapshot> {
        self.latest.clone()
    }

    pub fn collect(&mut self) -> Snapshot {
        let now = Instant::now();
        let dt = now.duration_since(self.last_instant).as_secs_f64();
        self.last_instant = now;

        let hw = hwmon::scan();

        let cpu = collectors::cpu(&mut self.prev_cpu, &mut self.prev_rapl, dt, &hw);
        let gpu = collectors::gpu(&self.profile, &hw);
        let memory = collectors::memory();
        let network = collectors::network(&mut self.prev_net, dt);
        let fans = collectors::fans(&hw);

        // Storage refreshes on a coarse cadence (cheap sources stay hot). The
        // I/O rate uses elapsed time since the *last storage refresh*, not one
        // tick, so MB/s stays accurate despite the coarser cadence.
        if self.tick % STORAGE_EVERY == 0 || self.cached_storage.is_empty() {
            let storage_dt = now.duration_since(self.last_storage_instant).as_secs_f64();
            self.last_storage_instant = now;
            let with_smart = self.tick % SMART_EVERY == 0;
            self.cached_storage =
                collectors::storage(&mut self.prev_disk, storage_dt, &hw, with_smart);
        }
        let storage = self.cached_storage.clone();

        let battery = if self.profile.has_battery {
            collectors::battery()
        } else {
            None
        };

        // Log battery status transitions (charging diagnostics — confirms the
        // backend reflects the real sysfs state, e.g. charging→discharging on unplug).
        let cur_status = battery.as_ref().map(|b| b.status.clone());
        if cur_status != self.prev_battery_status {
            if let Some(s) = &cur_status {
                let pct = battery.as_ref().map(|b| b.charge_percent).unwrap_or(0.0);
                crate::logging::line(
                    "INFO",
                    &format!("Battery status: {s} ({pct:.0}%)"),
                );
            }
            self.prev_battery_status = cur_status;
        }

        let storage_c = storage.iter().find_map(|s| s.temperature_c);
        let gpu_c = gpu.as_ref().and_then(|g| g.temperature_c);
        let thermals = collectors::thermals(&hw, cpu.temperature_c, gpu_c, storage_c);

        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let snapshot = Snapshot {
            timestamp,
            cpu,
            gpu,
            memory,
            storage,
            battery,
            network,
            fans,
            thermals,
        };

        self.push_history(&snapshot);
        self.latest = Some(snapshot.clone());
        self.tick = self.tick.wrapping_add(1);
        snapshot
    }

    fn push_history(&mut self, s: &Snapshot) {
        if self.history.len() >= HISTORY_CAP {
            self.history.pop_front();
        }
        self.history.push_back(HistoryPoint {
            ts: s.timestamp,
            cpu_usage: s.cpu.usage,
            cpu_temp: s.cpu.temperature_c.unwrap_or(0.0),
            gpu_usage: s.gpu.as_ref().map(|g| g.usage).unwrap_or(0.0),
            gpu_temp: s.gpu.as_ref().and_then(|g| g.temperature_c).unwrap_or(0.0),
            mem_usage: s.memory.usage,
            net_down: s.network.download_bytes_sec,
            net_up: s.network.upload_bytes_sec,
            cpu_fan_rpm: fan_rpm(&s.fans, "CPU Fan"),
            gpu_fan_rpm: fan_rpm(&s.fans, "GPU Fan"),
        });
    }
}

impl Default for TelemetryService {
    fn default() -> Self {
        Self::new()
    }
}

/// First fan RPM matching `label`, else 0 (for the compact history point).
fn fan_rpm(fans: &[FanTelemetry], label: &str) -> u32 {
    fans.iter()
        .find(|f| f.label == label)
        .map(|f| f.rpm)
        .unwrap_or(0)
}
