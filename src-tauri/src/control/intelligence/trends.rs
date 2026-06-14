//! Historical Analytics Engine. Computes per-metric statistics + a least-squares
//! trend direction over the telemetry history ring buffer. Pure + deterministic.

use serde::Serialize;

use crate::telemetry::types::HistoryPoint;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trend {
    pub metric: String,
    pub current: f32,
    pub average: f32,
    pub min: f32,
    pub max: f32,
    /// rising | falling | stable
    pub direction: String,
    /// Change per sample (units/sample) from linear regression.
    pub slope: f32,
    pub samples: usize,
    /// Compact sparkline series for the UI.
    pub series: Vec<f32>,
}

/// Least-squares slope of y over its index.
fn slope(ys: &[f32]) -> f32 {
    let n = ys.len();
    if n < 2 {
        return 0.0;
    }
    let nf = n as f32;
    let mean_x = (nf - 1.0) / 2.0;
    let mean_y = ys.iter().sum::<f32>() / nf;
    let mut num = 0.0;
    let mut den = 0.0;
    for (i, &y) in ys.iter().enumerate() {
        let dx = i as f32 - mean_x;
        num += dx * (y - mean_y);
        den += dx * dx;
    }
    if den == 0.0 {
        0.0
    } else {
        num / den
    }
}

fn trend(metric: &str, ys: Vec<f32>, stable_band: f32) -> Trend {
    let samples = ys.len();
    let current = ys.last().copied().unwrap_or(0.0);
    let average = if samples > 0 { ys.iter().sum::<f32>() / samples as f32 } else { 0.0 };
    let min = ys.iter().cloned().fold(f32::INFINITY, f32::min);
    let max = ys.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
    let s = slope(&ys);
    let direction = if s.abs() < stable_band {
        "stable"
    } else if s > 0.0 {
        "rising"
    } else {
        "falling"
    };
    Trend {
        metric: metric.into(),
        current,
        average,
        min: if min.is_finite() { min } else { 0.0 },
        max: if max.is_finite() { max } else { 0.0 },
        direction: direction.into(),
        slope: s,
        samples,
        // Down-sample to at most 48 points for the UI.
        series: downsample(&ys, 48),
    }
}

fn downsample(ys: &[f32], target: usize) -> Vec<f32> {
    if ys.len() <= target {
        return ys.to_vec();
    }
    let step = ys.len() as f32 / target as f32;
    (0..target).map(|i| ys[(i as f32 * step) as usize]).collect()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrendReport {
    pub metrics: Vec<Trend>,
}

pub fn analyze(history: &[HistoryPoint]) -> TrendReport {
    let metrics = vec![
        trend("CPU Usage", history.iter().map(|p| p.cpu_usage).collect(), 0.05),
        trend("CPU Temp", history.iter().map(|p| p.cpu_temp).collect(), 0.03),
        trend("GPU Usage", history.iter().map(|p| p.gpu_usage).collect(), 0.05),
        trend("GPU Temp", history.iter().map(|p| p.gpu_temp).collect(), 0.03),
        trend("Memory", history.iter().map(|p| p.mem_usage).collect(), 0.03),
        trend("CPU Fan", history.iter().map(|p| p.cpu_fan_rpm as f32).collect(), 2.0),
    ];
    TrendReport { metrics }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::types::HistoryPoint;

    fn hp(cpu_temp: f32) -> HistoryPoint {
        let mut p = HistoryPoint::default();
        p.cpu_temp = cpu_temp;
        p
    }

    #[test]
    fn detects_rising_and_stable() {
        let rising: Vec<_> = (0..20).map(|i| hp(50.0 + i as f32)).collect();
        let r = analyze(&rising);
        let cpu_temp = r.metrics.iter().find(|m| m.metric == "CPU Temp").unwrap();
        assert_eq!(cpu_temp.direction, "rising");
        assert!(cpu_temp.slope > 0.5);

        let flat: Vec<_> = (0..20).map(|_| hp(50.0)).collect();
        let f = analyze(&flat);
        assert_eq!(f.metrics.iter().find(|m| m.metric == "CPU Temp").unwrap().direction, "stable");
    }

    #[test]
    fn computes_min_max_avg() {
        let h: Vec<_> = [40.0, 60.0, 50.0].iter().map(|&t| hp(t)).collect();
        let m = analyze(&h).metrics.into_iter().find(|m| m.metric == "CPU Temp").unwrap();
        assert_eq!(m.min, 40.0);
        assert_eq!(m.max, 60.0);
        assert!((m.average - 50.0).abs() < 0.01);
    }
}
