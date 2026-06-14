//! Intelligence Core (Phase 5.0) — a deterministic, on-device reasoning layer
//! above every engine. No LLM, no cloud, no hardcoded responses: every output is
//! derived from real telemetry + the existing engines, with confidence + the
//! concrete evidence it was computed from.
//!
//!   health          — System Health Engine (weighted subsystem scoring)
//!   recommendations — evidence-based, capability-aware suggestions
//!   trends          — Historical Analytics (least-squares direction)
//!   maintenance     — Predictive Maintenance (battery EOL, storage, thermal drift)
//!   bottlenecks     — holistic Bottleneck Detection
//!   automation      — Automation Rules suggestions from observed patterns
//!   nlp             — deterministic Natural Language Command Layer
//!   engine          — aggregates all of the above into one report

pub mod automation;
pub mod bottlenecks;
pub mod engine;
pub mod health;
pub mod maintenance;
pub mod nlp;
pub mod recommendations;
pub mod trends;

pub use engine::{report, IntelligenceReport};
pub use nlp::{parse, CommandResult};
