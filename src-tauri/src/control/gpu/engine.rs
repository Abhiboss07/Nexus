//! GPU Discovery + Intelligence (Phase 4.0 — read-only).
//!
//! Collects live GPU telemetry via `nvidia-smi` (NVML present but the CLI keeps
//! us dependency-free and consistent with the rest of the stack), detects real
//! capabilities (no assumptions), and computes health / thermal / efficiency /
//! gaming-readiness scores + bottleneck + VRAM-pressure analysis.
//!
//! Validated on RTX 4050 Laptop: power-limit control is **N/A → unsupported**;
//! Dynamic Boost + RTD3 present; PCIe gen4 x8; CUDA 13.3.

use std::process::Command;
use std::sync::OnceLock;

use serde::Serialize;

fn smi_query(fields: &str) -> Option<Vec<String>> {
    let out = Command::new("nvidia-smi")
        .args([&format!("--query-gpu={fields}"), "--format=csv,noheader,nounits"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let line = String::from_utf8_lossy(&out.stdout);
    let first = line.lines().next()?;
    Some(first.split(',').map(|s| s.trim().to_string()).collect())
}

fn opt_f32(s: &str) -> Option<f32> {
    let t = s.trim();
    if t.is_empty() || t.contains("N/A") {
        return None;
    }
    t.parse().ok()
}
fn opt_u32(s: &str) -> Option<u32> {
    opt_f32(s).map(|v| v as u32)
}
fn opt_u64(s: &str) -> Option<u64> {
    opt_f32(s).map(|v| v as u64)
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub present: bool,
    pub vendor: String,
    pub name: String,
    pub driver_version: String,
    pub vbios_version: String,
    pub cuda_version: String,
    pub temperature_c: Option<f32>,
    pub utilization: f32,
    pub memory_utilization: f32,
    pub vram_used_mb: u64,
    pub vram_total_mb: u64,
    pub clock_graphics_mhz: Option<u32>,
    pub clock_sm_mhz: Option<u32>,
    pub clock_memory_mhz: Option<u32>,
    pub clock_video_mhz: Option<u32>,
    pub power_draw_w: Option<f32>,
    /// Enforced settable limit (N/A on Dynamic-Boost laptops ⇒ None ⇒ no control).
    pub power_limit_w: Option<f32>,
    pub power_default_w: Option<f32>,
    pub power_min_w: Option<f32>,
    pub power_max_w: Option<f32>,
    pub pcie_gen_current: Option<u32>,
    pub pcie_gen_max: Option<u32>,
    pub pcie_width_current: Option<u32>,
    pub pstate: String,
    /// Effective memory data rate (Gbps/pin) — a portable estimate from the
    /// memory clock (bus width isn't exposed, so we don't fake a total).
    pub mem_effective_gbps: Option<f32>,
}

const QUERY: &str = "name,driver_version,vbios_version,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.total,clocks.gr,clocks.sm,clocks.mem,clocks.video,power.draw,power.limit,power.default_limit,power.min_limit,power.max_limit,pcie.link.gen.current,pcie.link.gen.max,pcie.link.width.current,pstate";

pub fn gpu_info() -> Option<GpuInfo> {
    let f = smi_query(QUERY)?;
    if f.len() < 21 {
        return None;
    }
    let mem_clock = opt_u32(&f[10]);
    Some(GpuInfo {
        present: true,
        vendor: "NVIDIA".into(),
        name: f[0].clone(),
        driver_version: f[1].clone(),
        vbios_version: f[2].clone(),
        cuda_version: capabilities().cuda_version.clone(),
        temperature_c: opt_f32(&f[3]),
        utilization: opt_f32(&f[4]).unwrap_or(0.0),
        memory_utilization: opt_f32(&f[5]).unwrap_or(0.0),
        vram_used_mb: opt_u64(&f[6]).unwrap_or(0),
        vram_total_mb: opt_u64(&f[7]).unwrap_or(0),
        clock_graphics_mhz: opt_u32(&f[8]),
        clock_sm_mhz: opt_u32(&f[9]),
        clock_memory_mhz: mem_clock,
        clock_video_mhz: opt_u32(&f[11]),
        power_draw_w: opt_f32(&f[12]),
        power_limit_w: opt_f32(&f[13]),
        power_default_w: opt_f32(&f[14]),
        power_min_w: opt_f32(&f[15]),
        power_max_w: opt_f32(&f[16]),
        pcie_gen_current: opt_u32(&f[17]),
        pcie_gen_max: opt_u32(&f[18]),
        pcie_width_current: opt_u32(&f[19]),
        pstate: f[20].clone(),
        // GDDR6 is DDR ⇒ effective per-pin rate ≈ 2 × memory clock.
        mem_effective_gbps: mem_clock.map(|c| (c as f32 * 2.0) / 1000.0),
    })
}

/* --------------------------------------------------------------------------
   Capability discovery — real interfaces only, no assumptions.
   -------------------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuCapabilities {
    pub present: bool,
    pub vendor: String,
    pub cuda_version: String,
    pub has_nvml: bool,
    /// Settable enforced power limit exists AND is writable. False when N/A.
    pub power_limit_control: bool,
    pub dynamic_boost: bool,
    pub rtd3: bool,
    pub prime_offload: bool,
    pub mux_switching: bool,
    pub advanced_optimus: bool,
    pub tgp_control: bool,
    pub notes: String,
}

static CAPS: OnceLock<GpuCapabilities> = OnceLock::new();

fn command_exists(bin: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(bin).is_file()))
        .unwrap_or(false)
}

fn smi_q() -> String {
    Command::new("nvidia-smi")
        .arg("-q")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).to_string())
        .unwrap_or_default()
}

fn nvidia_proc_power() -> String {
    // /proc/driver/nvidia/gpus/<bdf>/power
    if let Ok(rd) = std::fs::read_dir("/proc/driver/nvidia/gpus") {
        for e in rd.flatten() {
            if let Ok(s) = std::fs::read_to_string(e.path().join("power")) {
                return s;
            }
        }
    }
    String::new()
}

fn detect_caps() -> GpuCapabilities {
    // Direct query — must NOT call gpu_info() (re-enters this OnceLock).
    let present = command_exists("nvidia-smi") && smi_query("name").is_some();
    let q = smi_q();
    let cuda_version = q
        .lines()
        .find(|l| l.contains("CUDA Version"))
        .and_then(|l| l.split(':').nth(1))
        .map(|s| s.split_whitespace().next().unwrap_or("").to_string())
        .unwrap_or_default();

    let has_nvml = ["/usr/lib/libnvidia-ml.so.1", "/usr/lib/libnvidia-ml.so", "/usr/lib/x86_64-linux-gnu/libnvidia-ml.so.1"]
        .iter()
        .any(|p| std::path::Path::new(p).exists());

    // Enforced settable power limit present? (N/A on Dynamic-Boost laptops.)
    // NOTE: query directly — do NOT call gpu_info() here, it would re-enter this
    // OnceLock initializer and deadlock.
    let power_limit_control = smi_query("power.limit")
        .and_then(|f| f.first().and_then(|s| opt_f32(s)))
        .is_some();
    let dynamic_boost = q.contains("GPU Ceiling Power Limit");
    let proc_power = nvidia_proc_power();
    let rtd3 = proc_power.contains("Runtime D3 status:") && proc_power.contains("Enabled");

    // GPU mode / MUX — only if a real switching interface exists.
    let prime_offload = command_exists("prime-run") || command_exists("__NV_PRIME_RENDER_OFFLOAD");
    let mux_switching = command_exists("supergfxctl")
        || std::path::Path::new("/sys/devices/platform/asus-nb-wmi/dgpu_disable").exists();

    let mut notes = Vec::new();
    if !power_limit_control {
        notes.push("Power-limit/TGP control unavailable (managed by Dynamic Boost).");
    }
    if !mux_switching {
        notes.push("No GPU MUX switch interface (hybrid/Optimus; use PRIME offload per-app).");
    }

    GpuCapabilities {
        present,
        vendor: "NVIDIA".into(),
        cuda_version,
        has_nvml,
        power_limit_control,
        dynamic_boost,
        rtd3,
        prime_offload,
        mux_switching,
        // Advanced Optimus = dynamic MUX requiring driver/DM support; no CLI to
        // toggle on Linux, so we never claim controllable.
        advanced_optimus: false,
        tgp_control: false,
        notes: notes.join(" "),
    }
}

pub fn capabilities() -> &'static GpuCapabilities {
    CAPS.get_or_init(detect_caps)
}

/* --------------------------------------------------------------------------
   GPU Intelligence — scores, bottleneck, VRAM pressure, recommendations.
   -------------------------------------------------------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuRecommendation {
    pub severity: String,
    pub title: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GpuIntelligence {
    pub health_score: u8,
    pub thermal_score: u8,
    pub efficiency_score: u8,
    pub gaming_readiness: u8,
    pub vram_pressure: f32,
    pub bottleneck: String,
    pub recommendations: Vec<GpuRecommendation>,
}

pub fn thermal_score(temp: f32) -> u8 {
    (100.0 - (temp - 55.0).max(0.0) * 1.6).clamp(0.0, 100.0).round() as u8
}

pub fn efficiency_score(util: f32, power: f32, default_power: f32) -> u8 {
    // Perf-per-watt proxy: utilization delivered per fraction of default TGP.
    if power < 1.0 || default_power < 1.0 {
        return 100;
    }
    let frac = (power / default_power).clamp(0.05, 1.5);
    ((util / frac).clamp(0.0, 100.0)).round() as u8
}

pub fn bottleneck(util: f32, vram_pressure: f32, cpu_util: Option<f32>) -> &'static str {
    if vram_pressure >= 92.0 {
        return "vram";
    }
    if util >= 95.0 {
        return match cpu_util {
            Some(c) if c < 60.0 => "gpu",
            _ => "gpu",
        };
    }
    if let Some(c) = cpu_util {
        if c >= 90.0 && util < 60.0 {
            return "cpu";
        }
    }
    "balanced"
}

pub fn intelligence(info: &GpuInfo, cpu_util: Option<f32>) -> GpuIntelligence {
    let temp = info.temperature_c.unwrap_or(0.0);
    let vram_pressure = if info.vram_total_mb > 0 {
        info.vram_used_mb as f32 / info.vram_total_mb as f32 * 100.0
    } else {
        0.0
    };
    let thermal = thermal_score(temp);
    let efficiency = efficiency_score(
        info.utilization,
        info.power_draw_w.unwrap_or(0.0),
        info.power_default_w.unwrap_or(80.0),
    );
    // Health: driver present + thermal headroom + PCIe at full width.
    let pcie_ok = info.pcie_gen_current == info.pcie_gen_max;
    let health = ((thermal as f32) * 0.6 + if pcie_ok { 40.0 } else { 25.0 }).clamp(0.0, 100.0).round() as u8;
    // Gaming readiness: thermal headroom + VRAM free + full PCIe link.
    let vram_free_score = (100.0 - vram_pressure).clamp(0.0, 100.0);
    let gaming = ((thermal as f32) * 0.4 + vram_free_score * 0.35 + if pcie_ok { 25.0 } else { 10.0 })
        .clamp(0.0, 100.0)
        .round() as u8;

    let bottleneck = bottleneck(info.utilization, vram_pressure, cpu_util).to_string();

    let mut recs = Vec::new();
    if temp >= 85.0 {
        recs.push(rec("warning", "GPU thermal headroom low", "GPU is hot — improve airflow or raise the fan curve before extended gaming."));
    }
    if vram_pressure >= 90.0 {
        recs.push(rec("warning", "VRAM pressure high", "VRAM is nearly full — lower texture quality or close other GPU apps."));
    } else if vram_pressure >= 75.0 {
        recs.push(rec("info", "VRAM filling up", "VRAM usage is climbing; watch for stutter at higher settings."));
    }
    if !pcie_ok && info.pcie_gen_max.is_some() {
        recs.push(rec("info", "PCIe link downshifted", "GPU is below its max PCIe gen (power saving). It will ramp under load."));
    }
    if bottleneck == "cpu" {
        recs.push(rec("info", "CPU-bound", "The CPU is limiting GPU throughput — a higher power profile may help."));
    }
    if recs.is_empty() {
        recs.push(rec("info", "GPU healthy", "Thermals, VRAM and link are all in good shape."));
    }

    GpuIntelligence {
        health_score: health,
        thermal_score: thermal,
        efficiency_score: efficiency,
        gaming_readiness: gaming,
        vram_pressure,
        bottleneck,
        recommendations: recs,
    }
}

fn rec(severity: &str, title: &str, detail: &str) -> GpuRecommendation {
    GpuRecommendation { severity: severity.into(), title: title.into(), detail: detail.into() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_helpers_handle_na() {
        assert_eq!(opt_f32("[N/A]"), None);
        assert_eq!(opt_f32("45.0"), Some(45.0));
        assert_eq!(opt_u32("120"), Some(120));
    }

    #[test]
    fn scoring_buckets() {
        assert!(thermal_score(45.0) >= 95);
        assert!(thermal_score(90.0) < 50);
        assert_eq!(bottleneck(98.0, 50.0, Some(40.0)), "gpu");
        assert_eq!(bottleneck(40.0, 50.0, Some(95.0)), "cpu");
        assert_eq!(bottleneck(50.0, 95.0, None), "vram");
    }

    #[test]
    fn efficiency_rewards_util_per_watt() {
        // High util at low power → high efficiency.
        assert!(efficiency_score(90.0, 30.0, 80.0) > efficiency_score(90.0, 80.0, 80.0));
    }
}
