//! Gaming Intelligence v1 — analysis layer over the persistent telemetry store.
//!
//! Architecture: the store owns storage + SQL aggregation ([`SessionAnalytics`],
//! `session_series`); THIS module owns interpretation — bottleneck/limiter
//! detection ("why FPS dropped") and cross-session trend/regression analysis.
//! The UI consumes the verdicts and renders them; it holds no business logic.
//!
//! FPS-specific outputs degrade gracefully: until a frame-rate source (e.g.
//! MangoHud) records into the `fps` column they report `hasFps = false` and the
//! limiter analysis falls back to thermal/usage/memory signals, which are real
//! today.

use serde::Serialize;

use crate::telemetry::store::{SessionAnalytics, TelemetryStore};

fn clamp_conf(v: f64) -> u8 {
    v.round().clamp(5.0, 99.0) as u8
}

/* ------------------------- why FPS dropped (limiter) --------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Limiter {
    /// cpu | gpu | thermal | memory
    pub kind: String,
    pub confidence: u8,
    pub title: String,
    pub detail: String,
    pub recommendation: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FpsAnalysis {
    pub session_id: i64,
    /// Did this session carry real frame-rate samples?
    pub has_fps: bool,
    pub fps_avg: f64,
    pub fps_min: f64,
    pub fps_low1pct: f64,
    /// Highest-confidence limiter, if any.
    pub primary: Option<Limiter>,
    /// All detected limiters, ranked by confidence (desc).
    pub factors: Vec<Limiter>,
    pub summary: String,
}

/// Classify what constrained performance during a session. Works from real
/// thermal/usage/memory data today; sharper once FPS samples exist.
pub fn fps_analysis(
    store: &TelemetryStore,
    session_id: i64,
) -> Result<Option<FpsAnalysis>, String> {
    let Some(a) = store.session_analytics(session_id)? else {
        return Ok(None);
    };
    let factors = detect_limiters(&a);
    let primary = factors.first().cloned();
    let has_fps = a.fps_samples > 0;

    let summary = match (&primary, has_fps) {
        (Some(p), true) => format!(
            "Likely {} — {} (avg {:.0} fps, 1% low {:.0}).",
            p.kind,
            p.title.to_lowercase(),
            a.fps_avg,
            a.fps_low1pct
        ),
        (Some(p), false) => format!(
            "Main limiter: {}. Install MangoHud to record FPS for frame-level analysis.",
            p.title.to_lowercase()
        ),
        (None, true) => format!(
            "No single bottleneck — the system had headroom (avg {:.0} fps).",
            a.fps_avg
        ),
        (None, false) => {
            "No thermal/usage bottleneck detected. Add a frame-rate source (MangoHud) for FPS-aware analysis.".into()
        }
    };

    Ok(Some(FpsAnalysis {
        session_id,
        has_fps,
        fps_avg: a.fps_avg,
        fps_min: a.fps_min,
        fps_low1pct: a.fps_low1pct,
        primary,
        factors,
        summary,
    }))
}

/// Pure scoring of limiters from a session's aggregates (unit-testable).
pub fn detect_limiters(a: &SessionAnalytics) -> Vec<Limiter> {
    let mut factors: Vec<Limiter> = Vec::new();
    let hottest_peak = a.cpu_temp_max.max(a.gpu_temp_max);

    // Thermal throttling — the strongest signal when present.
    if a.throttle_pct > 1.0 || hottest_peak >= 90.0 {
        let conf = clamp_conf(40.0 + a.throttle_pct * 4.0 + (hottest_peak - 88.0).max(0.0) * 4.0);
        factors.push(Limiter {
            kind: "thermal".into(),
            confidence: conf,
            title: "Thermal throttling".into(),
            detail: format!(
                "≥90°C on {:.0}% of samples (CPU peak {:.0}°C, GPU peak {:.0}°C) — clocks drop to stay safe.",
                a.throttle_pct, a.cpu_temp_max, a.gpu_temp_max
            ),
            recommendation: "Raise the fan curve, clean the intakes, or cap power/TGP to hold clocks.".into(),
        });
    }

    // Memory pressure — paging/stutter risk.
    if a.mem_usage_max >= 95.0 || a.mem_usage_avg >= 85.0 {
        let conf = clamp_conf(
            35.0 + (a.mem_usage_avg - 80.0).max(0.0) * 3.0 + (a.mem_usage_max - 90.0).max(0.0) * 3.0,
        );
        factors.push(Limiter {
            kind: "memory".into(),
            confidence: conf,
            title: "Memory pressure".into(),
            detail: format!(
                "RAM averaged {:.0}% (peak {:.0}%) — swapping causes frame-time spikes.",
                a.mem_usage_avg, a.mem_usage_max
            ),
            recommendation: "Close background apps or add RAM to remove the stutter source.".into(),
        });
    }

    // CPU-bound — CPU pinned while the GPU has headroom.
    if a.cpu_usage_avg >= 85.0 && a.gpu_usage_avg < 80.0 {
        let conf = clamp_conf(40.0 + (a.cpu_usage_avg - 85.0) * 3.0 + (80.0 - a.gpu_usage_avg) * 0.8);
        factors.push(Limiter {
            kind: "cpu".into(),
            confidence: conf,
            title: "CPU-bound".into(),
            detail: format!(
                "CPU averaged {:.0}% while the GPU sat at {:.0}% — the CPU is the limiter.",
                a.cpu_usage_avg, a.gpu_usage_avg
            ),
            recommendation: "Lower CPU-heavy settings (crowds, draw distance, physics) or cap FPS.".into(),
        });
    }

    // GPU-bound — the GPU is the ceiling (often expected at max settings).
    if a.gpu_usage_avg >= 90.0 {
        let conf = clamp_conf(45.0 + (a.gpu_usage_avg - 90.0) * 4.0);
        factors.push(Limiter {
            kind: "gpu".into(),
            confidence: conf,
            title: "GPU-bound".into(),
            detail: format!(
                "GPU averaged {:.0}% — the graphics card is the ceiling (normal when maxing visuals).",
                a.gpu_usage_avg
            ),
            recommendation: "Lower resolution/quality or enable upscaling (DLSS/FSR) for more frames.".into(),
        });
    }

    factors.sort_by_key(|l| std::cmp::Reverse(l.confidence));
    factors
}

/* ----------------------------- trend engine ------------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetricTrend {
    pub metric: String,
    pub label: String,
    pub current: f64,
    pub baseline: f64,
    pub delta_pct: f64,
    /// up | down | flat
    pub direction: String,
    /// improved | regressed | stable
    pub verdict: String,
    pub higher_is_better: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrendReport {
    pub current_session_id: Option<i64>,
    /// Number of prior sessions averaged into the baseline.
    pub baseline_sessions: usize,
    pub trends: Vec<MetricTrend>,
    pub summary: String,
}

fn metric_trend(metric: &str, label: &str, cur: f64, base: f64, higher_better: bool) -> MetricTrend {
    let delta = cur - base;
    let delta_pct = if base.abs() > 1e-6 { delta / base * 100.0 } else { 0.0 };
    let significant = delta_pct.abs() >= 5.0;
    let direction = if delta_pct > 0.5 {
        "up"
    } else if delta_pct < -0.5 {
        "down"
    } else {
        "flat"
    };
    let improved = if higher_better { delta > 0.0 } else { delta < 0.0 };
    let verdict = if !significant {
        "stable"
    } else if improved {
        "improved"
    } else {
        "regressed"
    };
    MetricTrend {
        metric: metric.into(),
        label: label.into(),
        current: cur,
        baseline: base,
        delta_pct,
        direction: direction.into(),
        verdict: verdict.into(),
        higher_is_better: higher_better,
    }
}

/// Compare the most recent session against the average of the prior sessions and
/// flag per-metric regressions/improvements.
pub fn trends(store: &TelemetryStore, limit: i64) -> Result<TrendReport, String> {
    let sessions = store.sessions(limit.clamp(2, 50))?;
    let analytics: Vec<SessionAnalytics> = sessions
        .iter()
        .filter_map(|s| store.session_analytics(s.id).ok().flatten())
        .filter(|a| a.samples > 0)
        .collect();

    if analytics.len() < 2 {
        return Ok(TrendReport {
            current_session_id: analytics.first().map(|a| a.session_id),
            baseline_sessions: 0,
            trends: Vec::new(),
            summary: "Not enough recorded sessions yet — a couple more and trends appear here.".into(),
        });
    }

    let current = &analytics[0];
    let baseline = &analytics[1..];
    let n = baseline.len() as f64;
    let avg = |f: fn(&SessionAnalytics) -> f64| baseline.iter().map(f).sum::<f64>() / n;

    let mut trends = vec![
        metric_trend("cpuTempMax", "Peak CPU temp", current.cpu_temp_max, avg(|a| a.cpu_temp_max), false),
        metric_trend("gpuTempMax", "Peak GPU temp", current.gpu_temp_max, avg(|a| a.gpu_temp_max), false),
        metric_trend("throttlePct", "Throttling", current.throttle_pct, avg(|a| a.throttle_pct), false),
        metric_trend("cpuUsageAvg", "Avg CPU load", current.cpu_usage_avg, avg(|a| a.cpu_usage_avg), false),
        metric_trend("powerAvgW", "Avg power draw", current.power_avg_w, avg(|a| a.power_avg_w), false),
    ];
    // FPS trend only when the current session actually recorded frame rates.
    if current.fps_samples > 0 {
        trends.insert(0, metric_trend("fpsAvg", "Avg FPS", current.fps_avg, avg(|a| a.fps_avg), true));
    }

    let regressed = trends.iter().filter(|t| t.verdict == "regressed").count();
    let improved = trends.iter().filter(|t| t.verdict == "improved").count();
    let summary = match (improved, regressed) {
        (0, 0) => "Steady — this session matched your recent average.".into(),
        (i, 0) => format!("{i} metric(s) improved vs your recent average."),
        (0, r) => format!("{r} metric(s) regressed vs your recent average."),
        (i, r) => format!("{i} improved, {r} regressed vs your recent average."),
    };

    Ok(TrendReport {
        current_session_id: Some(current.session_id),
        baseline_sessions: baseline.len(),
        trends,
        summary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn analytics(cpu: f64, gpu: f64, mem: f64, cpu_t: f64, gpu_t: f64, throttle: f64) -> SessionAnalytics {
        SessionAnalytics {
            samples: 1000,
            cpu_usage_avg: cpu,
            gpu_usage_avg: gpu,
            mem_usage_avg: mem,
            mem_usage_max: mem + 8.0,
            cpu_temp_max: cpu_t,
            gpu_temp_max: gpu_t,
            throttle_pct: throttle,
            ..Default::default()
        }
    }

    #[test]
    fn thermal_throttle_is_top_limiter() {
        let a = analytics(70.0, 95.0, 60.0, 94.0, 88.0, 20.0);
        let f = detect_limiters(&a);
        assert_eq!(f.first().unwrap().kind, "thermal");
    }

    #[test]
    fn cpu_bound_when_cpu_pinned_gpu_idle() {
        let a = analytics(96.0, 55.0, 50.0, 70.0, 60.0, 0.0);
        let f = detect_limiters(&a);
        assert!(f.iter().any(|l| l.kind == "cpu"));
        assert!(!f.iter().any(|l| l.kind == "gpu"));
    }

    #[test]
    fn gpu_bound_when_gpu_maxed() {
        let a = analytics(50.0, 98.0, 50.0, 70.0, 75.0, 0.0);
        let f = detect_limiters(&a);
        assert_eq!(f.first().unwrap().kind, "gpu");
    }

    #[test]
    fn memory_pressure_detected() {
        let a = analytics(50.0, 60.0, 92.0, 70.0, 70.0, 0.0);
        let f = detect_limiters(&a);
        assert!(f.iter().any(|l| l.kind == "memory"));
    }

    #[test]
    fn healthy_session_has_no_limiters() {
        let a = analytics(45.0, 70.0, 55.0, 68.0, 66.0, 0.0);
        assert!(detect_limiters(&a).is_empty());
    }

    #[test]
    fn metric_trend_flags_regression() {
        // Peak temp up 10% (lower is better) → regressed.
        let t = metric_trend("cpuTempMax", "Peak CPU temp", 88.0, 80.0, false);
        assert_eq!(t.verdict, "regressed");
        assert_eq!(t.direction, "up");
        // FPS up 10% (higher is better) → improved.
        let t = metric_trend("fpsAvg", "Avg FPS", 110.0, 100.0, true);
        assert_eq!(t.verdict, "improved");
    }
}
