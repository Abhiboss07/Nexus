//! Modular telemetry engine: hardware discovery, per-subsystem collectors,
//! a polling service with a rolling history cache, and streaming over IPC.

pub mod collectors;
pub mod fps;
pub mod hardware;
pub mod hwmon;
pub mod processes;
pub mod service;
pub mod store;
pub mod sysfs;
pub mod types;

pub use hardware::HardwareProfile;
pub use processes::ProcessMonitor;
pub use service::TelemetryService;
pub use store::TelemetryStore;
pub use types::*;
