//! Bottleneck Detection Engine. Holistic — weighs CPU / GPU / memory / VRAM /
//! disk utilization from the live snapshot to identify the limiting subsystem,
//! with confidence + evidence.

use serde::Serialize;

use super::recommendations::Evidence;
use crate::telemetry::types::Snapshot;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BottleneckReport {
    /// cpu | gpu | vram | memory | disk | none
    pub bottleneck: String,
    pub confidence: u8,
    pub detail: String,
    pub evidence: Vec<Evidence>,
}

pub fn detect(snapshot: &Snapshot) -> BottleneckReport {
    let cpu = snapshot.cpu.usage;
    let gpu = snapshot.gpu.as_ref().map(|g| g.usage).unwrap_or(0.0);
    let mem = snapshot.memory.usage;
    let vram = snapshot
        .gpu
        .as_ref()
        .filter(|g| g.vram_total_mb > 0)
        .map(|g| g.vram_used_mb as f32 / g.vram_total_mb as f32 * 100.0)
        .unwrap_or(0.0);
    let disk = snapshot
        .storage
        .iter()
        .map(|s| (s.read_bytes_sec + s.write_bytes_sec) as f32 / 1_048_576.0)
        .fold(0.0_f32, f32::max);

    // VRAM / memory exhaustion take priority — they cause hard stalls.
    if vram >= 92.0 {
        return report(
            "vram",
            conf(vram - 92.0, 8.0),
            "Video memory is exhausted, forcing texture eviction.",
            vec![Evidence::new("VRAM", format!("{vram:.0}%"), "92%")],
        );
    }
    if mem >= 92.0 {
        return report(
            "memory",
            conf(mem - 92.0, 8.0),
            "System RAM is exhausted; swapping will cause stalls.",
            vec![Evidence::new("RAM", format!("{mem:.0}%"), "92%")],
        );
    }

    // Compute-bound: whichever of CPU/GPU is pegged while the other has headroom.
    if gpu >= 92.0 && cpu < 80.0 {
        return report(
            "gpu",
            conf(gpu - cpu, 40.0),
            "GPU is saturated while the CPU has headroom — GPU-bound.",
            vec![
                Evidence::new("GPU", format!("{gpu:.0}%"), "92%"),
                Evidence::new("CPU", format!("{cpu:.0}%"), "80%"),
            ],
        );
    }
    if cpu >= 92.0 && gpu < 70.0 {
        return report(
            "cpu",
            conf(cpu - gpu, 40.0),
            "CPU is saturated while the GPU is underused — CPU-bound.",
            vec![
                Evidence::new("CPU", format!("{cpu:.0}%"), "92%"),
                Evidence::new("GPU", format!("{gpu:.0}%"), "70%"),
            ],
        );
    }
    if disk >= 400.0 && cpu < 70.0 && gpu < 70.0 {
        return report(
            "disk",
            conf(disk - 400.0, 400.0),
            "Heavy disk I/O with idle CPU/GPU — storage-bound.",
            vec![Evidence::new(
                "Disk I/O",
                format!("{disk:.0} MB/s"),
                "400 MB/s",
            )],
        );
    }

    report(
        "none",
        85,
        "No single subsystem is limiting performance right now.",
        vec![
            Evidence::new("CPU", format!("{cpu:.0}%"), "—"),
            Evidence::new("GPU", format!("{gpu:.0}%"), "—"),
        ],
    )
}

fn conf(margin: f32, span: f32) -> u8 {
    (55.0 + (margin / span).clamp(0.0, 1.0) * 40.0)
        .clamp(40.0, 98.0)
        .round() as u8
}

fn report(b: &str, confidence: u8, detail: &str, evidence: Vec<Evidence>) -> BottleneckReport {
    BottleneckReport {
        bottleneck: b.into(),
        confidence,
        detail: detail.into(),
        evidence,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::types::*;

    fn snap(cpu: f32, gpu: f32, mem: f32, vram_used: u64, vram_total: u64) -> Snapshot {
        let mut s = Snapshot::default();
        s.cpu.usage = cpu;
        s.memory.usage = mem;
        s.gpu = Some(GpuTelemetry {
            usage: gpu,
            vram_used_mb: vram_used,
            vram_total_mb: vram_total,
            ..Default::default()
        });
        s
    }

    #[test]
    fn detects_gpu_and_cpu_bound() {
        assert_eq!(
            detect(&snap(40.0, 98.0, 50.0, 1000, 6000)).bottleneck,
            "gpu"
        );
        assert_eq!(
            detect(&snap(98.0, 30.0, 50.0, 1000, 6000)).bottleneck,
            "cpu"
        );
    }

    #[test]
    fn vram_and_memory_take_priority() {
        assert_eq!(
            detect(&snap(99.0, 99.0, 50.0, 5900, 6000)).bottleneck,
            "vram"
        );
        assert_eq!(
            detect(&snap(50.0, 50.0, 96.0, 1000, 6000)).bottleneck,
            "memory"
        );
    }

    #[test]
    fn balanced_when_no_pressure() {
        assert_eq!(
            detect(&snap(40.0, 40.0, 40.0, 1000, 6000)).bottleneck,
            "none"
        );
    }
}
