//! Per-subsystem collectors. Each reads the cheapest accurate source and is
//! resilient to missing hardware (returns defaults / `None`). Rate-based metrics
//! receive `dt` (seconds since the previous sample) and the relevant previous
//! counters, which the `TelemetryService` owns.

use std::collections::HashMap;
use std::process::Command;

use serde::Serialize;

use super::hardware::HardwareProfile;
use super::hwmon::HwmonScan;
use super::sysfs;
use super::types::*;

/// Cumulative CPU jiffie counters used to derive usage between samples.
#[derive(Clone, Copy, Default)]
pub struct CpuTimes {
    pub idle: u64,
    pub total: u64,
}

fn parse_proc_stat() -> Vec<CpuTimes> {
    let mut out = Vec::new();
    let content = match sysfs::read_string("/proc/stat") {
        Some(c) => c,
        None => return out,
    };
    for line in content.lines() {
        if !line.starts_with("cpu") {
            continue;
        }
        let mut it = line.split_whitespace();
        let tag = it.next().unwrap_or("");
        // tag is "cpu" (aggregate) or "cpuN" (per logical core)
        let vals: Vec<u64> = it.filter_map(|v| v.parse().ok()).collect();
        if vals.len() < 5 {
            continue;
        }
        let idle = vals[3] + vals.get(4).copied().unwrap_or(0); // idle + iowait
        let total: u64 = vals.iter().sum();
        // Keep aggregate at index 0, cores after, in file order.
        if tag == "cpu" {
            out.insert(0, CpuTimes { idle, total });
        } else {
            out.push(CpuTimes { idle, total });
        }
    }
    out
}

fn usage_between(prev: CpuTimes, now: CpuTimes) -> f32 {
    let d_total = now.total.saturating_sub(prev.total);
    let d_idle = now.idle.saturating_sub(prev.idle);
    if d_total == 0 {
        return 0.0;
    }
    (((d_total - d_idle) as f32) / d_total as f32) * 100.0
}

fn cpu_frequency_mhz() -> (u32, u32) {
    let mut sum = 0u64;
    let mut count = 0u64;
    let mut max = 0u64;
    for name in sysfs::list_dir("/sys/devices/system/cpu") {
        if !name.starts_with("cpu") || !name[3..].chars().all(|c| c.is_ascii_digit()) {
            continue;
        }
        let base = format!("/sys/devices/system/cpu/{name}/cpufreq");
        if let Some(cur) = sysfs::read_u64(&format!("{base}/scaling_cur_freq")) {
            sum += cur;
            count += 1;
        }
        if let Some(m) = sysfs::read_u64(&format!("{base}/cpuinfo_max_freq")) {
            max = max.max(m);
        }
    }
    let avg = sum.checked_div(count).map_or(0, |v| v / 1000);
    (avg as u32, (max / 1000) as u32)
}

fn cpu_core_counts() -> (usize, usize) {
    let mut threads = 0usize;
    let mut cores = 0usize;
    if let Some(c) = sysfs::read_string("/proc/cpuinfo") {
        for line in c.lines() {
            if line.starts_with("processor") {
                threads += 1;
            }
            if line.starts_with("cpu cores") {
                if let Some(v) = sysfs::parse_kv_u64(line) {
                    cores = v as usize;
                }
            }
        }
    }
    if cores == 0 {
        cores = threads;
    }
    (cores, threads)
}

/// Package power via Intel/AMD RAPL energy counter delta.
fn rapl_package_power(prev_uj: &mut Option<u64>, dt: f64) -> Option<f32> {
    let path = "/sys/class/powercap/intel-rapl:0/energy_uj";
    let now = sysfs::read_u64(path)?;
    let result = match *prev_uj {
        Some(p) if now >= p && dt > 0.0 => Some(((now - p) as f64 / 1_000_000.0 / dt) as f32),
        _ => None,
    };
    *prev_uj = Some(now);
    result
}

pub fn cpu(
    prev: &mut Vec<CpuTimes>,
    prev_rapl: &mut Option<u64>,
    dt: f64,
    hw: &HwmonScan,
) -> CpuTelemetry {
    let now = parse_proc_stat();
    let mut usage = 0.0;
    let mut per_core = Vec::new();

    if prev.len() == now.len() && !now.is_empty() {
        usage = usage_between(prev[0], now[0]);
        for i in 1..now.len() {
            per_core.push(usage_between(prev[i], now[i]));
        }
    }
    *prev = now;

    let (freq, max_freq) = cpu_frequency_mhz();
    let (cores, threads) = cpu_core_counts();
    let temperature_c = hw.temp_for(&["coretemp", "k10temp", "zenpower"], Some("Package"));

    let model = sysfs::read_string("/proc/cpuinfo")
        .and_then(|c| {
            c.lines()
                .find(|l| l.starts_with("model name"))
                .and_then(|l| l.split(':').nth(1))
                .map(|s| s.trim().to_string())
        })
        .unwrap_or_else(|| "CPU".into());

    CpuTelemetry {
        model,
        usage,
        per_core,
        frequency_mhz: freq,
        max_frequency_mhz: max_freq,
        temperature_c,
        package_power_w: rapl_package_power(prev_rapl, dt),
        core_count: cores,
        thread_count: threads,
    }
}

pub fn memory() -> MemoryTelemetry {
    let content = sysfs::read_string("/proc/meminfo").unwrap_or_default();
    let get = |key: &str| -> u64 {
        content
            .lines()
            .find(|l| l.starts_with(key))
            .and_then(sysfs::parse_kv_u64)
            .unwrap_or(0)
            * 1024 // meminfo is in kB
    };
    let total = get("MemTotal:");
    let available = get("MemAvailable:");
    let swap_total = get("SwapTotal:");
    let swap_free = get("SwapFree:");
    let used = total.saturating_sub(available);
    let swap_used = swap_total.saturating_sub(swap_free);

    MemoryTelemetry {
        total_bytes: total,
        used_bytes: used,
        available_bytes: available,
        usage: if total > 0 {
            used as f32 / total as f32 * 100.0
        } else {
            0.0
        },
        swap_total_bytes: swap_total,
        swap_used_bytes: swap_used,
        swap_usage: if swap_total > 0 {
            swap_used as f32 / swap_total as f32 * 100.0
        } else {
            0.0
        },
    }
}

fn parse_csv_f32(s: &str) -> Option<f32> {
    let t = s.trim();
    if t.is_empty() || t.contains("N/A") {
        return None;
    }
    t.parse().ok()
}

fn nvidia_gpu() -> Option<GpuTelemetry> {
    let out = Command::new("nvidia-smi")
        .args([
            "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,clocks.gr,clocks.mem,power.draw,power.limit,power.max_limit",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout);
    let first = line.lines().next()?;
    let f: Vec<&str> = first.split(',').collect();
    if f.len() < 9 {
        return None;
    }
    // power.limit is N/A on Dynamic-Boost laptops; fall back to power.max_limit
    // so the UI has the real ceiling (the 120 W TGP), and reject a bogus draw.
    let power_max = f.get(9).and_then(|s| parse_csv_f32(s));
    let power_draw = parse_csv_f32(f[7]).filter(|d| {
        let ceiling = power_max.map(|m| m * 1.25).unwrap_or(400.0);
        *d >= 0.0 && *d <= ceiling
    });
    Some(GpuTelemetry {
        name: f[0].trim().to_string(),
        vendor: "NVIDIA".into(),
        usage: parse_csv_f32(f[1]).unwrap_or(0.0),
        vram_used_mb: parse_csv_f32(f[2]).unwrap_or(0.0) as u64,
        vram_total_mb: parse_csv_f32(f[3]).unwrap_or(0.0) as u64,
        temperature_c: parse_csv_f32(f[4]),
        core_clock_mhz: parse_csv_f32(f[5]).map(|v| v as u32),
        mem_clock_mhz: parse_csv_f32(f[6]).map(|v| v as u32),
        power_w: power_draw,
        power_limit_w: parse_csv_f32(f[8]).or(power_max),
    })
}

fn amd_gpu(hw: &HwmonScan) -> Option<GpuTelemetry> {
    // Find an AMD card via DRM vendor id.
    for name in sysfs::list_dir("/sys/class/drm") {
        if !name.starts_with("card") || name.contains('-') {
            continue;
        }
        let dev = format!("/sys/class/drm/{name}/device");
        if sysfs::read_string(&format!("{dev}/vendor")).as_deref() != Some("0x1002") {
            continue;
        }
        let usage = sysfs::read_f32(&format!("{dev}/gpu_busy_percent")).unwrap_or(0.0);
        let vram_used =
            sysfs::read_u64(&format!("{dev}/mem_info_vram_used")).unwrap_or(0) / 1_048_576;
        let vram_total =
            sysfs::read_u64(&format!("{dev}/mem_info_vram_total")).unwrap_or(0) / 1_048_576;
        return Some(GpuTelemetry {
            name: "AMD Radeon".into(),
            vendor: "AMD".into(),
            usage,
            vram_used_mb: vram_used,
            vram_total_mb: vram_total,
            temperature_c: hw.temp_for(&["amdgpu"], Some("edge")),
            core_clock_mhz: None,
            mem_clock_mhz: None,
            power_w: None,
            power_limit_w: None,
        });
    }
    None
}

pub fn gpu(profile: &HardwareProfile, hw: &HwmonScan) -> Option<GpuTelemetry> {
    if profile.has_nvidia {
        if let Some(g) = nvidia_gpu() {
            return Some(g);
        }
    }
    if profile.has_amd_gpu {
        return amd_gpu(hw);
    }
    None
}

fn base_disk(part: &str) -> String {
    let trimmed = part.trim_end_matches(|c: char| c.is_ascii_digit());
    if trimmed.ends_with('p') && (part.contains("nvme") || part.contains("mmcblk")) {
        trimmed[..trimmed.len() - 1].to_string()
    } else {
        trimmed.to_string()
    }
}

/// Read cumulative (read_bytes, write_bytes) per base disk from /proc/diskstats.
fn read_diskstats() -> HashMap<String, (u64, u64)> {
    let mut map = HashMap::new();
    if let Some(content) = sysfs::read_string("/proc/diskstats") {
        for line in content.lines() {
            let t: Vec<&str> = line.split_whitespace().collect();
            if t.len() < 10 {
                continue;
            }
            let name = t[2].to_string();
            let sectors_read: u64 = t[5].parse().unwrap_or(0);
            let sectors_written: u64 = t[9].parse().unwrap_or(0);
            map.insert(name, (sectors_read * 512, sectors_written * 512));
        }
    }
    map
}

fn smart_status(base: &str) -> String {
    let out = Command::new("smartctl")
        .args(["-H", &format!("/dev/{base}")])
        .output();
    match out {
        Ok(o) => {
            let s = String::from_utf8_lossy(&o.stdout).to_uppercase();
            // Match the specific overall-health result lines. Note: an open
            // failure (no root) prints "...FAILED:" — we must NOT treat that as
            // a health failure, so only "FAILED!" (the real verdict) counts.
            if s.contains("RESULT: PASSED") || s.contains("HEALTH STATUS: OK") {
                "passed".into()
            } else if s.contains("FAILED!") || s.contains("HEALTH STATUS: FAILED") {
                "failing".into()
            } else {
                // Includes the permission-denied / open-failed case.
                "unknown".into()
            }
        }
        Err(_) => "unknown".into(),
    }
}

pub fn storage(
    prev_disk: &mut HashMap<String, (u64, u64)>,
    dt: f64,
    hw: &HwmonScan,
    with_smart: bool,
) -> Vec<StorageTelemetry> {
    let now_stats = read_diskstats();
    let mut out = Vec::new();
    // Btrfs/LVM expose one device under many mounts (subvolumes). Report each
    // physical partition once, keyed by device name.
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();

    let df = Command::new("df")
        .args(["-B1", "--output=source,fstype,target,size,used"])
        .output();
    let text = match df {
        Ok(o) => String::from_utf8_lossy(&o.stdout).to_string(),
        Err(_) => return out,
    };

    for line in text.lines().skip(1) {
        let f: Vec<&str> = line.split_whitespace().collect();
        if f.len() < 5 || !f[0].starts_with("/dev/") {
            continue;
        }
        let fstype = f[1];
        if matches!(
            fstype,
            "tmpfs" | "devtmpfs" | "overlay" | "squashfs" | "efivarfs"
        ) {
            continue;
        }
        let total: u64 = f[3].parse().unwrap_or(0);
        let used: u64 = f[4].parse().unwrap_or(0);
        if total == 0 {
            continue;
        }
        let dev_name = f[0].trim_start_matches("/dev/").to_string();
        if !seen.insert(dev_name.clone()) {
            continue; // already reported this partition (another subvolume mount)
        }
        let base = base_disk(&dev_name);

        // I/O rate from diskstats deltas on the base device.
        let (mut read_rate, mut write_rate) = (0u64, 0u64);
        if let (Some((rn, wn)), Some((rp, wp))) = (now_stats.get(&base), prev_disk.get(&base)) {
            if dt > 0.0 {
                read_rate = ((rn.saturating_sub(*rp)) as f64 / dt) as u64;
                write_rate = ((wn.saturating_sub(*wp)) as f64 / dt) as u64;
            }
        }

        let temperature_c = if base.starts_with("nvme") {
            hw.temp_for(&["nvme"], Some("Composite"))
        } else {
            None
        };

        out.push(StorageTelemetry {
            device: dev_name,
            mount_point: f[2].to_string(),
            filesystem: fstype.to_string(),
            total_bytes: total,
            used_bytes: used,
            usage: used as f32 / total as f32 * 100.0,
            temperature_c,
            read_bytes_sec: read_rate,
            write_bytes_sec: write_rate,
            smart_status: if with_smart {
                smart_status(&base)
            } else {
                "unknown".into()
            },
        });
    }

    *prev_disk = now_stats;
    out
}

pub fn battery() -> Option<BatteryTelemetry> {
    let base = [
        "/sys/class/power_supply/BAT0",
        "/sys/class/power_supply/BAT1",
    ]
    .into_iter()
    .find(|p| sysfs::exists(p))?;

    let r_u = |f: &str| sysfs::read_u64(&format!("{base}/{f}"));
    let status = sysfs::read_string(&format!("{base}/status")).unwrap_or_else(|| "Unknown".into());
    let capacity = sysfs::read_f32(&format!("{base}/capacity")).unwrap_or(0.0);
    let cycle_count = r_u("cycle_count").unwrap_or(0) as u32;
    let voltage_v = r_u("voltage_now")
        .map(|v| v as f32 / 1_000_000.0)
        .unwrap_or(0.0);
    let power_draw_w = r_u("power_now")
        .map(|p| p as f32 / 1_000_000.0)
        .unwrap_or(0.0);

    // Prefer energy_* (µWh); fall back to charge_* (µAh) × voltage.
    let (now_wh, full_wh, design_wh) = if let Some(en) = r_u("energy_now") {
        (
            en as f32 / 1_000_000.0,
            r_u("energy_full").unwrap_or(0) as f32 / 1_000_000.0,
            r_u("energy_full_design").unwrap_or(0) as f32 / 1_000_000.0,
        )
    } else {
        let v = if voltage_v > 0.0 { voltage_v } else { 1.0 };
        (
            r_u("charge_now").unwrap_or(0) as f32 / 1_000_000.0 * v,
            r_u("charge_full").unwrap_or(0) as f32 / 1_000_000.0 * v,
            r_u("charge_full_design").unwrap_or(0) as f32 / 1_000_000.0 * v,
        )
    };

    let health = if design_wh > 0.0 {
        (full_wh / design_wh * 100.0).min(100.0)
    } else {
        0.0
    };

    let time_remaining_min = if status.eq_ignore_ascii_case("Discharging") && power_draw_w > 0.1 {
        Some((now_wh / power_draw_w * 60.0) as u32)
    } else {
        None
    };

    Some(BatteryTelemetry {
        present: true,
        status: status.to_lowercase(),
        charge_percent: capacity,
        health_percent: health,
        cycle_count,
        energy_now_wh: now_wh,
        energy_full_wh: full_wh,
        energy_design_wh: design_wh,
        power_draw_w,
        voltage_v,
        time_remaining_min,
    })
}

/// Raw, unprocessed battery sysfs values for the diagnostics panel — the ground
/// truth, so a "stuck charging" report can be traced to firmware vs. Nexus.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatteryDebug {
    pub path: Option<String>,
    pub present: bool,
    /// Verbatim `status` (NOT lowercased): Charging | Discharging | Full | Not charging | Unknown.
    pub status: Option<String>,
    pub capacity: Option<i64>,
    /// µW (sign per kernel; often unsigned).
    pub power_now: Option<i64>,
    /// µA — negative while discharging on many laptops.
    pub current_now: Option<i64>,
    pub voltage_now: Option<i64>,
    pub charge_now: Option<i64>,
    pub energy_now: Option<i64>,
}

pub fn battery_debug() -> BatteryDebug {
    let Some(base) = ["/sys/class/power_supply/BAT0", "/sys/class/power_supply/BAT1"]
        .into_iter()
        .find(|p| sysfs::exists(p))
    else {
        return BatteryDebug::default();
    };
    let raw_i = |f: &str| {
        sysfs::read_string(&format!("{base}/{f}")).and_then(|s| s.trim().parse::<i64>().ok())
    };
    BatteryDebug {
        path: Some(base.to_string()),
        present: true,
        status: sysfs::read_string(&format!("{base}/status")).map(|s| s.trim().to_string()),
        capacity: raw_i("capacity"),
        power_now: raw_i("power_now"),
        current_now: raw_i("current_now"),
        voltage_now: raw_i("voltage_now"),
        charge_now: raw_i("charge_now"),
        energy_now: raw_i("energy_now"),
    }
}

fn is_virtual_iface(name: &str) -> bool {
    name == "lo"
        || name.starts_with("veth")
        || name.starts_with("br-")
        || name.starts_with("docker")
        || name.starts_with("virbr")
        || name.starts_with("vnet")
        || name.starts_with("tap")
        || name.starts_with("tun")
}

pub fn network(prev: &mut Option<(String, u64, u64)>, dt: f64) -> NetworkTelemetry {
    let content = sysfs::read_string("/proc/net/dev").unwrap_or_default();
    // Choose the active physical interface with the most traffic.
    let mut best: Option<(String, u64, u64)> = None;
    for line in content.lines() {
        let Some((iface, rest)) = line.split_once(':') else {
            continue;
        };
        let iface = iface.trim();
        if is_virtual_iface(iface) {
            continue;
        }
        let operstate = sysfs::read_string(&format!("/sys/class/net/{iface}/operstate"));
        if operstate.as_deref() != Some("up") {
            continue;
        }
        let v: Vec<u64> = rest
            .split_whitespace()
            .filter_map(|x| x.parse().ok())
            .collect();
        if v.len() < 9 {
            continue;
        }
        let (down, up) = (v[0], v[8]);
        if best.as_ref().map_or(true, |b| down + up > b.1 + b.2) {
            best = Some((iface.to_string(), down, up));
        }
    }

    let (iface, down, up) = best.unwrap_or_default();
    let (mut d_rate, mut u_rate) = (0u64, 0u64);
    if let Some((pi, pd, pu)) = prev {
        if *pi == iface && dt > 0.0 {
            d_rate = ((down.saturating_sub(*pd)) as f64 / dt) as u64;
            u_rate = ((up.saturating_sub(*pu)) as f64 / dt) as u64;
        }
    }
    *prev = Some((iface.clone(), down, up));

    NetworkTelemetry {
        interface: iface,
        download_bytes_sec: d_rate,
        upload_bytes_sec: u_rate,
        total_down_bytes: down,
        total_up_bytes: up,
        latency_ms: None,
    }
}

pub fn fans(hw: &HwmonScan) -> Vec<FanTelemetry> {
    let mut out: Vec<FanTelemetry> = hw
        .fans
        .iter()
        .map(|f| FanTelemetry {
            label: f.label.clone(),
            rpm: f.rpm,
        })
        .collect();

    // HP OMEN fan RPMs aren't exposed via hwmon — read them from the
    // omen-rgb-keyboard driver's read-only RPM nodes when present.
    const OMEN_FAN: &str = "/sys/devices/platform/omen-rgb-keyboard/fan";
    for (file, label) in [("cpu_fan_rpm", "CPU Fan"), ("gpu_fan_rpm", "GPU Fan")] {
        if let Some(rpm) = sysfs::read_u64(&format!("{OMEN_FAN}/{file}")) {
            out.push(FanTelemetry {
                label: label.into(),
                rpm: rpm as u32,
            });
        }
    }
    out
}

pub fn thermals(
    hw: &HwmonScan,
    cpu_c: Option<f32>,
    gpu_c: Option<f32>,
    storage_c: Option<f32>,
) -> ThermalsTelemetry {
    let sensors = hw
        .temps
        .iter()
        .map(|t| ThermalSensor {
            source: t.chip.clone(),
            label: t.label.clone(),
            temperature_c: t.celsius,
        })
        .collect();
    ThermalsTelemetry {
        cpu_c,
        gpu_c,
        storage_c,
        sensors,
    }
}

/// One-shot ICMP latency probe (used by an on-demand command, not the hot loop).
pub fn ping_latency(host: &str) -> Option<f32> {
    let out = Command::new("ping")
        .args(["-c", "1", "-W", "1", host])
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let idx = text.find("time=")?;
    text[idx + 5..]
        .split_whitespace()
        .next()?
        .parse::<f32>()
        .ok()
}
