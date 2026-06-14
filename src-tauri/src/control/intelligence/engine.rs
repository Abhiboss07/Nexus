//! Intelligence Core façade. Composes every reasoning engine into one report
//! from real data sources. Pure — the command layer supplies telemetry (from the
//! TelemetryService) + engine outputs (from the ControlService).

use serde::Serialize;

use super::automation::{suggest, AutomationSuggestion};
use super::bottlenecks::{detect, BottleneckReport};
use super::health::{compute, SystemHealth};
use super::maintenance::{predict, MaintenanceInsight};
use super::recommendations::{generate, Recommendation};
use super::trends::{analyze, TrendReport};

use crate::control::automation::AutomationConfig;
use crate::control::battery::BatteryReport;
use crate::control::capabilities::HardwareCapabilities;
use crate::control::fan::ThermalReport;
use crate::control::gpu::GpuIntelligence;
use crate::telemetry::types::{HistoryPoint, Snapshot};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntelligenceReport {
    pub health: SystemHealth,
    pub bottleneck: BottleneckReport,
    pub recommendations: Vec<Recommendation>,
    pub trends: TrendReport,
    pub maintenance: Vec<MaintenanceInsight>,
    pub automation_suggestions: Vec<AutomationSuggestion>,
}

#[allow(clippy::too_many_arguments)]
pub fn report(
    snapshot: &Snapshot,
    history: &[HistoryPoint],
    caps: &HardwareCapabilities,
    battery: Option<&BatteryReport>,
    thermal: Option<&ThermalReport>,
    gpu: Option<&GpuIntelligence>,
    automation_cfg: &AutomationConfig,
) -> IntelligenceReport {
    IntelligenceReport {
        health: compute(snapshot, battery, thermal, gpu),
        bottleneck: detect(snapshot),
        recommendations: generate(snapshot, history, caps, battery, thermal, gpu),
        trends: analyze(history),
        maintenance: predict(snapshot, history, battery),
        automation_suggestions: suggest(history, snapshot, automation_cfg, caps),
    }
}
