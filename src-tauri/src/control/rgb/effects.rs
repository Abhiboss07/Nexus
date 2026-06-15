//! The RGB effect catalog. These map 1:1 to the omen-rgb-keyboard driver's
//! `animation_mode` vocabulary (verified against the driver source), and to
//! OpenRGB mode names for the portable path.

/// The eleven supported effects, in UI order.
pub const EFFECTS: [&str; 11] = [
    "static",
    "breathing",
    "rainbow",
    "wave",
    "pulse",
    "chase",
    "sparkle",
    "candle",
    "aurora",
    "disco",
    "gradient",
];

/// Whether `name` is a known effect.
pub fn is_valid(name: &str) -> bool {
    EFFECTS.contains(&name)
}

/// Whether the effect uses a single base color the user picks (vs. generating
/// its own palette). Color-based effects get the base color written first.
pub fn uses_base_color(effect: &str) -> bool {
    matches!(
        effect,
        "static" | "breathing" | "pulse" | "wave" | "candle" | "gradient"
    )
}

/// Map a UI speed (0–100) to the driver's `animation_speed` range (1–10).
pub fn to_driver_speed(speed_percent: u8) -> u8 {
    let s = speed_percent.min(100) as u32;
    (1 + (s * 9) / 100) as u8 // 0→1 .. 100→10
}

/// Map a UI effect to the closest OpenRGB mode name (best-effort).
pub fn to_openrgb_mode(effect: &str) -> &'static str {
    match effect {
        "static" => "Static",
        "breathing" => "Breathing",
        "rainbow" => "Rainbow Wave",
        "wave" => "Rainbow Wave",
        "pulse" => "Breathing",
        "chase" => "Marquee",
        "sparkle" => "Flashing",
        "candle" => "Breathing",
        "aurora" => "Spectrum Cycle",
        "disco" => "Flashing",
        "gradient" => "Static",
        _ => "Static",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_eleven_effects_valid() {
        assert_eq!(EFFECTS.len(), 11);
        for e in EFFECTS {
            assert!(is_valid(e));
        }
        assert!(!is_valid("nope"));
    }

    #[test]
    fn speed_maps_into_driver_range() {
        assert_eq!(to_driver_speed(0), 1);
        assert_eq!(to_driver_speed(100), 10);
        assert!((1..=10).contains(&to_driver_speed(55)));
    }
}
