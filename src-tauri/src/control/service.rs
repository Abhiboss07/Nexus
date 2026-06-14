//! `ControlService` — the façade the IPC layer talks to. Owns the detected
//! capabilities and the resolved controller bundle, and validates control
//! actions. In Phase 2B it only ever *previews* (dry-run): it confirms the
//! action is supported and a driver is attached, then describes what Phase 3
//! will do — without writing to hardware.

use std::sync::Mutex;

use serde::Deserialize;

use super::automation::AutomationConfig;
use super::battery::{BatteryEngine, BatteryReport, BatterySample};
use super::capabilities::HardwareCapabilities;
use super::detector::{CapabilityDetector, LiveProbe};
use super::fan::{
    CurvePoint, FanControlEngine, FanInfo, FanProfile, FanProfileStore, FanThermalEngine,
    ThermalReport,
};
use super::hardware_support::{CompatibilityReport, GateInputs, WriteGate};
use super::games::profiles::GameLaunch;
use super::games::{
    mangohud, scan, Game, GameProfile, GameProfileStore, LauncherStatus, MangoHudStatus,
};
use super::gpu::{self, GpuCapabilities, GpuInfo, GpuIntelligence};
use super::intelligence::{self, CommandResult, IntelligenceReport};
use crate::telemetry::types::{HistoryPoint, Snapshot};
use super::nexus::{NexusProfile, NexusProfileStore};
use super::power::{PowerEngine, PowerInfo};
use super::registry::{DriverInfo, DriverRegistry, VendorController};
use super::rgb::{RgbEngine, RgbProfile};
use super::traits::{ControlError, ControlOutcome, ControlResult, RgbRequest, RgbState};
use crate::telemetry::hardware::HardwareProfile;

fn automation_path() -> std::path::PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|_| {
            std::path::PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())).join(".config")
        });
    base.join("nexus").join("automation.json")
}

fn load_automation() -> AutomationConfig {
    std::fs::read_to_string(automation_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

/// A UI-initiated control request. Vendor-neutral: the UI never names a driver.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ControlAction {
    SetPowerProfile { profile: String },
    SetFanMode { mode: String, speed_percent: Option<u8> },
    SetChargeLimit { limit: u8 },
    SetRgb { effect: String, hue: u16, brightness: u8, speed: u8 },
    SetMux { mode: String },
}

pub struct ControlService {
    profile: HardwareProfile,
    capabilities: HardwareCapabilities,
    controllers: VendorController,
    rgb: RgbEngine,
    power: PowerEngine,
    nexus: NexusProfileStore,
    automation: Mutex<AutomationConfig>,
    active_profile: Mutex<Option<String>>,
    battery: BatteryEngine,
    fan: FanThermalEngine,
    fan_control: FanControlEngine,
    fan_profiles: FanProfileStore,
    game_profiles: GameProfileStore,
    /// Multi-hardware safety gate (finding C1): default-deny write policy.
    write_gate: WriteGate,
}

impl ControlService {
    /// Build from the live system (used at startup).
    pub fn detect(profile: HardwareProfile) -> Self {
        let probe = LiveProbe;
        let mut capabilities = CapabilityDetector::new(&probe).detect(&profile);

        // Resolve the write-safety gate from the *authoritative* fan interface
        // and RGB platform, then enforce it on the capability set so the UI
        // hides controls we must not expose on unvalidated hardware.
        let iface = super::fan::engine::fan_interface();
        let write_gate = WriteGate::evaluate(&GateInputs {
            vendor: profile.vendor,
            board_name: &profile.board_name,
            fan_iface: &iface.name,
            fan_table_valid: iface.curve_supported,
            rgb_platform: &capabilities.rgb.status.driver,
        });
        write_gate.apply_to(&mut capabilities);

        let controllers = DriverRegistry::resolve(&profile, &capabilities);
        let rgb = RgbEngine::new(&capabilities.rgb, profile.vendor);
        let power = PowerEngine::new(&capabilities.power, profile.vendor);
        Self {
            profile,
            capabilities,
            controllers,
            rgb,
            power,
            nexus: NexusProfileStore::new(),
            automation: Mutex::new(load_automation()),
            active_profile: Mutex::new(None),
            battery: BatteryEngine::new(),
            fan: FanThermalEngine::new(),
            fan_control: FanControlEngine::new(),
            fan_profiles: FanProfileStore::new(),
            game_profiles: GameProfileStore::new(),
            write_gate,
        }
    }

    /* ---- Multi-hardware safety gate (Release Hardening, finding C1) ---- */

    /// Refuse a fan write unless this hardware's fan interface is validated.
    fn guard_fan(&self) -> Result<(), ControlError> {
        if self.write_gate.fan_writes {
            Ok(())
        } else {
            Err(ControlError::HardwareNotValidated(format!(
                "fan control not validated for this hardware ({})",
                self.write_gate.tier.label()
            )))
        }
    }

    /// Refuse an RGB write unless this hardware's RGB platform is validated.
    fn guard_rgb(&self) -> Result<(), ControlError> {
        if self.write_gate.rgb_writes {
            Ok(())
        } else {
            Err(ControlError::HardwareNotValidated(format!(
                "RGB control not validated for this hardware ({})",
                self.write_gate.tier.label()
            )))
        }
    }

    /// Compatibility report consumed by `get_compatibility` and diagnostics.
    pub fn compatibility_report(&self) -> CompatibilityReport {
        let iface = super::fan::engine::fan_interface();
        CompatibilityReport::build(
            &self.profile,
            &self.write_gate,
            &iface.name,
            self.capabilities.power.status.controllable,
        )
    }

    /* ---- GPU discovery & intelligence (Phase 4.0) ---- */

    pub fn gpu_info(&self) -> Option<GpuInfo> {
        gpu::gpu_info()
    }
    pub fn gpu_capabilities(&self) -> GpuCapabilities {
        gpu::capabilities().clone()
    }
    pub fn gpu_intelligence(&self, cpu_util: Option<f32>) -> Option<GpuIntelligence> {
        gpu::gpu_info().map(|info| gpu::intelligence(&info, cpu_util))
    }

    /* ---- Gaming Center (Phase 4.0) ---- */

    pub fn scan_games(&self, include_tools: bool) -> Vec<Game> {
        scan(include_tools)
    }
    pub fn game_launchers(&self) -> LauncherStatus {
        super::games::launchers()
    }
    pub fn get_game_profile(&self, game_id: &str) -> GameProfile {
        self.game_profiles.get(game_id).unwrap_or_else(|| GameProfile::empty(game_id))
    }
    pub fn save_game_profile(&self, profile: &GameProfile) -> Result<(), ControlError> {
        self.game_profiles.save(profile).map_err(ControlError::Io)
    }
    pub fn delete_game_profile(&self, game_id: &str) -> Result<(), ControlError> {
        self.game_profiles.delete(game_id).map_err(ControlError::Io)
    }
    pub fn game_launch_info(&self, game_id: &str) -> Option<GameLaunch> {
        let game = scan(true).into_iter().find(|g| g.id == game_id)?;
        let profile = self.get_game_profile(game_id);
        Some(GameLaunch {
            command: profile.launch_command(&game),
            steam_launch_options: profile.steam_launch_options(),
        })
    }

    /// Apply a game's profile (power + RGB + fan) — used on launch / manually.
    pub fn apply_game_profile(&self, game_id: &str) -> ControlResult {
        let profile = self.get_game_profile(game_id);
        let mut applied = false;
        let mut notes: Vec<String> = Vec::new();

        if let Some(power) = &profile.power {
            if self.power.has_controller() {
                match self.power.set(power) {
                    Ok(o) => { applied = true; notes.push(o.message); }
                    Err(e) => notes.push(format!("Power: {e}")),
                }
            }
        }
        if let Some(rgb) = &profile.rgb {
            if self.rgb.has_controller() && self.guard_rgb().is_ok() {
                let req = RgbRequest { effect: rgb.effect.clone(), hue: rgb.hue, brightness: rgb.brightness, speed: rgb.speed, zone: None };
                match self.rgb.apply(&req) {
                    Ok(_) => { applied = true; notes.push(format!("RGB → {}", rgb.effect)); }
                    Err(e) => notes.push(format!("RGB: {e}")),
                }
            }
        }
        if let Some(fan) = &profile.fan {
            if self.guard_fan().is_ok() {
                if let Some(fp) = self.fan_profiles.get(fan) {
                    match self.fan_control.apply_profile(&fp) {
                        Ok(_) => { applied = true; notes.push(format!("Fan → {fan}")); }
                        Err(e) => notes.push(format!("Fan: {e}")),
                    }
                }
            }
        }

        Ok(ControlOutcome { applied, dry_run: false, message: notes.join("; ") })
    }

    /* ---- MangoHud overlay ---- */

    pub fn mangohud_status(&self) -> MangoHudStatus {
        mangohud::status()
    }
    pub fn mangohud_apply(&self, config: &str) -> Result<(), ControlError> {
        mangohud::write_config(config).map_err(ControlError::Io)
    }

    /* ---- System integrations (Phase 4.5) ---- */

    pub fn integrations(&self) -> Vec<super::integrations::Integration> {
        super::integrations::detect_all()
    }

    /* ---- Intelligence Core (Phase 5.0) ---- */

    /// Build the full intelligence report from a telemetry snapshot + history
    /// (supplied by the command layer) and this service's engine outputs.
    pub fn intelligence_report(
        &self,
        snapshot: &Snapshot,
        history: &[HistoryPoint],
        cpu_util: Option<f32>,
    ) -> IntelligenceReport {
        let battery = self.battery.report();
        let thermal = self.fan.thermal_report();
        let gpu = self.gpu_intelligence(cpu_util);
        let automation = self.get_automation();
        intelligence::report(
            snapshot,
            history,
            &self.capabilities,
            battery.as_ref(),
            Some(&thermal),
            gpu.as_ref(),
            &automation,
        )
    }

    pub fn nlp_command(&self, input: &str, snapshot: Option<&Snapshot>) -> CommandResult {
        intelligence::parse(input, &self.capabilities, snapshot)
    }

    /* ---- Battery intelligence (Phase 3.3A) ---- */

    pub fn battery_report(&self) -> Option<BatteryReport> {
        self.battery.report()
    }
    pub fn battery_history(&self) -> Vec<BatterySample> {
        self.battery.history()
    }
    pub fn battery_export(&self) -> Option<String> {
        self.battery.export_markdown()
    }

    /* ---- Fan & thermal intelligence (Phase 3.4A — read-only) ---- */

    pub fn fan_info(&self) -> FanInfo {
        self.fan.fan_info()
    }
    pub fn thermal_report(&self) -> ThermalReport {
        self.fan.thermal_report()
    }

    /* ---- Fan control (Phase 3.4B — real writes, Victus-S verified) ---- */

    pub fn fan_set_thermal_profile(&self, name: &str) -> ControlResult {
        self.guard_fan()?;
        self.fan_control.set_thermal_profile(name)
    }
    pub fn fan_set_curve(&self, points: Vec<CurvePoint>) -> ControlResult {
        self.guard_fan()?;
        self.fan_control.set_fan_curve(&points)
    }
    pub fn fan_set_max_fan(&self, on: bool) -> ControlResult {
        self.guard_fan()?;
        self.fan_control.set_max_fan(on)
    }
    pub fn fan_disable_curve(&self) -> ControlResult {
        self.guard_fan()?;
        self.fan_control.disable_curve()
    }
    pub fn fan_list_profiles(&self) -> Vec<FanProfile> {
        self.fan_profiles.list()
    }
    pub fn fan_apply_profile(&self, name: &str) -> ControlResult {
        self.guard_fan()?;
        let profile = self
            .fan_profiles
            .get(name)
            .ok_or_else(|| ControlError::InvalidParameter(format!("unknown fan profile '{name}'")))?;
        self.fan_control.apply_profile(&profile)
    }
    pub fn fan_save_profile(&self, profile: &FanProfile) -> Result<(), ControlError> {
        self.fan_profiles.save(profile)
    }
    pub fn fan_delete_profile(&self, name: &str) -> Result<(), ControlError> {
        self.fan_profiles.delete(name)
    }
    pub fn fan_export_profile(&self, name: &str) -> Result<String, ControlError> {
        self.fan_profiles.export(name)
    }
    pub fn fan_import_profile(&self, json: &str) -> Result<FanProfile, ControlError> {
        self.fan_profiles.import(json)
    }

    /* ---- Power & performance (Phase 3.2) ---- */

    pub fn power_info(&self) -> PowerInfo {
        self.power.info()
    }

    pub fn power_current(&self) -> Option<String> {
        self.power.current()
    }

    pub fn power_available(&self) -> Vec<String> {
        self.power.available()
    }

    pub fn power_set(&self, name: &str) -> ControlResult {
        self.power.set(name)
    }

    /* ---- Nexus profiles ---- */

    pub fn list_nexus_profiles(&self) -> Vec<NexusProfile> {
        self.nexus.list()
    }

    pub fn active_nexus_profile(&self) -> Option<String> {
        self.active_profile.lock().ok().and_then(|g| g.clone())
    }

    pub fn save_nexus_profile(&self, profile: &NexusProfile) -> Result<(), ControlError> {
        self.nexus.save(profile).map_err(ControlError::Io)
    }

    pub fn delete_nexus_profile(&self, id: &str) -> Result<(), ControlError> {
        self.nexus.delete(id).map_err(ControlError::Io)
    }

    /// Apply a Nexus profile: compose power + RGB. Tolerant of partial support —
    /// applies what it can and reports the rest, so e.g. power can switch even
    /// if RGB writes need the `input` group.
    pub fn apply_nexus_profile(&self, id: &str) -> ControlResult {
        let profile = self
            .nexus
            .get(id)
            .ok_or_else(|| ControlError::InvalidParameter(format!("unknown profile '{id}'")))?;

        let mut applied_any = false;
        let mut notes: Vec<String> = Vec::new();

        if let Some(power) = &profile.power {
            if self.power.has_controller() {
                match self.power.set(power) {
                    Ok(o) => {
                        applied_any = true;
                        notes.push(o.message);
                    }
                    Err(e) => notes.push(format!("Power: {e}")),
                }
            }
        }

        if let Some(rgb) = &profile.rgb {
            if self.rgb.has_controller() && self.guard_rgb().is_ok() {
                let req = RgbRequest {
                    effect: rgb.effect.clone(),
                    hue: rgb.hue,
                    brightness: rgb.brightness,
                    speed: rgb.speed,
                    zone: None,
                };
                match self.rgb.apply(&req) {
                    Ok(_) => {
                        applied_any = true;
                        notes.push(format!("RGB → {}", rgb.effect));
                    }
                    Err(e) => notes.push(format!("RGB: {e}")),
                }
            }
        }

        if let Ok(mut g) = self.active_profile.lock() {
            *g = Some(id.to_string());
        }

        Ok(ControlOutcome {
            applied: applied_any,
            dry_run: false,
            message: format!("{}: {}", profile.name, notes.join("; ")),
        })
    }

    /* ---- Automation ---- */

    pub fn get_automation(&self) -> AutomationConfig {
        self.automation.lock().map(|g| g.clone()).unwrap_or_default()
    }

    pub fn set_automation(&self, config: AutomationConfig) {
        if let Ok(json) = serde_json::to_string_pretty(&config) {
            let _ = std::fs::write(automation_path(), json);
        }
        if let Ok(mut g) = self.automation.lock() {
            *g = config;
        }
    }

    pub fn capabilities(&self) -> HardwareCapabilities {
        self.capabilities.clone()
    }

    pub fn drivers(&self) -> Vec<DriverInfo> {
        let mut out = self.controllers.drivers();
        // RGB is owned by the engine, not the generic registry.
        out.insert(
            0,
            DriverInfo {
                domain: "rgb".into(),
                driver: if self.capabilities.rgb.status.controllable {
                    Some(self.capabilities.rgb.status.driver.clone())
                } else {
                    None
                },
            },
        );
        out
    }

    /* ---- RGB control (Phase 3.1) ---- */

    pub fn rgb_apply(&self, req: &RgbRequest) -> ControlResult {
        self.guard_rgb()?;
        self.rgb.apply(req)
    }
    pub fn rgb_off(&self) -> ControlResult {
        self.guard_rgb()?;
        self.rgb.off()
    }
    pub fn rgb_state(&self) -> Option<RgbState> {
        self.rgb.state()
    }
    pub fn rgb_presets(&self) -> Vec<RgbProfile> {
        self.rgb.presets()
    }
    pub fn rgb_list_profiles(&self) -> Vec<RgbProfile> {
        self.rgb.list_profiles()
    }
    pub fn rgb_save_profile(&self, profile: &RgbProfile) -> Result<(), ControlError> {
        self.rgb.save_profile(profile)
    }
    pub fn rgb_apply_profile(&self, name: &str) -> ControlResult {
        self.guard_rgb()?;
        self.rgb.apply_profile(name)
    }
    pub fn rgb_delete_profile(&self, name: &str) -> Result<(), ControlError> {
        self.rgb.delete_profile(name)
    }
    pub fn rgb_export_profile(&self, name: &str) -> Result<String, ControlError> {
        self.rgb.export_profile(name)
    }
    pub fn rgb_import_profile(&self, json: &str) -> Result<RgbProfile, ControlError> {
        self.rgb.import_profile(json)
    }

    pub fn profile(&self) -> HardwareProfile {
        self.profile.clone()
    }

    /// Validate + describe an action without applying it. This is the only write
    /// surface exposed in Phase 2B.
    pub fn preview(&self, action: &ControlAction) -> ControlResult {
        match action {
            ControlAction::SetPowerProfile { profile } => {
                self.require(self.capabilities.power.status.controllable, self.controllers.power.is_some())?;
                if !self.capabilities.power.profiles.is_empty()
                    && !self.capabilities.power.profiles.iter().any(|p| p == profile)
                {
                    return Err(ControlError::InvalidParameter(format!(
                        "unknown profile '{profile}'"
                    )));
                }
                Ok(ControlOutcome::planned(format!("Would set power profile → {profile}")))
            }
            ControlAction::SetFanMode { mode, speed_percent } => {
                self.require(self.capabilities.fan.status.controllable, self.controllers.fan.is_some())?;
                let detail = speed_percent
                    .map(|s| format!(" @ {s}%"))
                    .unwrap_or_default();
                Ok(ControlOutcome::planned(format!("Would set fan mode → {mode}{detail}")))
            }
            ControlAction::SetChargeLimit { limit } => {
                self.require(self.capabilities.battery.status.controllable, self.controllers.battery.is_some())?;
                if *limit < 20 || *limit > 100 {
                    return Err(ControlError::InvalidParameter("limit must be 20–100".into()));
                }
                Ok(ControlOutcome::planned(format!("Would cap charge at {limit}%")))
            }
            ControlAction::SetRgb { effect, hue, brightness, speed } => {
                self.require(self.capabilities.rgb.status.controllable, self.rgb.has_controller())?;
                Ok(ControlOutcome::planned(format!(
                    "Would apply RGB → {effect} (hue {hue}, {brightness}% bright, speed {speed})"
                )))
            }
            ControlAction::SetMux { mode } => {
                self.require(self.capabilities.mux.status.controllable, self.controllers.mux.is_some())?;
                Ok(ControlOutcome::planned(format!("Would switch GPU MUX → {mode} (reboot required)")))
            }
        }
    }

    fn require(&self, capable: bool, has_driver: bool) -> Result<(), ControlError> {
        if !capable {
            return Err(ControlError::Unsupported);
        }
        if !has_driver {
            return Err(ControlError::DriverUnavailable("no controller attached".into()));
        }
        Ok(())
    }
}
