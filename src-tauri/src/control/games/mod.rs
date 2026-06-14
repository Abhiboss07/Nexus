//! Gaming Center (Phase 4.0) — library scanner, per-game profiles, launcher
//! integration, and MangoHud overlay configuration.

pub mod mangohud;
pub mod profiles;
pub mod scanner;

pub use mangohud::MangoHudStatus;
pub use profiles::{GameProfile, GameProfileStore};
pub use scanner::{scan, launchers, Game, LauncherStatus};
