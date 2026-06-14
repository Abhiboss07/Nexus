//! Serializable telemetry contracts shared with the frontend over IPC.
//! Field names are camelCased to match the TypeScript layer exactly.

use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CpuTelemetry {
    pub model: String,
    pub usage: f32,
    pub per_core: Vec<f32>,
    pub frequency_mhz: u32,
    pub max_frequency_mhz: u32,
    pub temperature_c: Option<f32>,
    pub package_power_w: Option<f32>,
    pub core_count: usize,
    pub thread_count: usize,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuTelemetry {
    pub name: String,
    pub vendor: String,
    pub usage: f32,
    pub vram_used_mb: u64,
    pub vram_total_mb: u64,
    pub temperature_c: Option<f32>,
    pub core_clock_mhz: Option<u32>,
    pub mem_clock_mhz: Option<u32>,
    pub power_w: Option<f32>,
    pub power_limit_w: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemoryTelemetry {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub usage: f32,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub swap_usage: f32,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageTelemetry {
    pub device: String,
    pub mount_point: String,
    pub filesystem: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub usage: f32,
    pub temperature_c: Option<f32>,
    pub read_bytes_sec: u64,
    pub write_bytes_sec: u64,
    /// "passed" | "failing" | "unknown"
    pub smart_status: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatteryTelemetry {
    pub present: bool,
    /// charging | discharging | full | unknown
    pub status: String,
    pub charge_percent: f32,
    pub health_percent: f32,
    pub cycle_count: u32,
    pub energy_now_wh: f32,
    pub energy_full_wh: f32,
    pub energy_design_wh: f32,
    pub power_draw_w: f32,
    pub voltage_v: f32,
    pub time_remaining_min: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetworkTelemetry {
    pub interface: String,
    pub download_bytes_sec: u64,
    pub upload_bytes_sec: u64,
    pub total_down_bytes: u64,
    pub total_up_bytes: u64,
    pub latency_ms: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FanTelemetry {
    pub label: String,
    pub rpm: u32,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThermalSensor {
    pub source: String,
    pub label: String,
    pub temperature_c: f32,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ThermalsTelemetry {
    pub cpu_c: Option<f32>,
    pub gpu_c: Option<f32>,
    pub storage_c: Option<f32>,
    pub sensors: Vec<ThermalSensor>,
}

/// One complete telemetry frame.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub timestamp: u64,
    pub cpu: CpuTelemetry,
    pub gpu: Option<GpuTelemetry>,
    pub memory: MemoryTelemetry,
    pub storage: Vec<StorageTelemetry>,
    pub battery: Option<BatteryTelemetry>,
    pub network: NetworkTelemetry,
    pub fans: Vec<FanTelemetry>,
    pub thermals: ThermalsTelemetry,
}

/// Compact point retained in the rolling history cache for charts.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
    pub ts: u64,
    pub cpu_usage: f32,
    pub cpu_temp: f32,
    pub gpu_usage: f32,
    pub gpu_temp: f32,
    pub mem_usage: f32,
    pub net_down: u64,
    pub net_up: u64,
    pub cpu_fan_rpm: u32,
    pub gpu_fan_rpm: u32,
}
