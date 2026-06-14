//! Color primitives + validation for the RGB engine.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

impl Rgb {
    pub const BLACK: Rgb = Rgb { r: 0, g: 0, b: 0 };

    pub fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    /// The omen-rgb-keyboard driver parses `kstrtoul(buf, 16)` into a packed
    /// `struct { u8 blue; u8 green; u8 red }`. On little-endian that means the
    /// integer is exactly `0xRRGGBB`, so we emit standard bare hex (no '#').
    pub fn to_driver_hex(self) -> String {
        format!("{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    /// Parse a `#rrggbb` or `rrggbb` string (as read back from the driver).
    pub fn parse(s: &str) -> Option<Rgb> {
        let h = s.trim().trim_start_matches('#');
        if h.len() != 6 || !h.bytes().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        Some(Rgb {
            r: u8::from_str_radix(&h[0..2], 16).ok()?,
            g: u8::from_str_radix(&h[2..4], 16).ok()?,
            b: u8::from_str_radix(&h[4..6], 16).ok()?,
        })
    }

    /// HSV → RGB. `h` in degrees [0,360), `s`,`v` in [0,1].
    pub fn from_hsv(h: f32, s: f32, v: f32) -> Rgb {
        let h = ((h % 360.0) + 360.0) % 360.0;
        let c = v * s;
        let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
        let m = v - c;
        let (r1, g1, b1) = match (h / 60.0) as u32 {
            0 => (c, x, 0.0),
            1 => (x, c, 0.0),
            2 => (0.0, c, x),
            3 => (0.0, x, c),
            4 => (x, 0.0, c),
            _ => (c, 0.0, x),
        };
        Rgb {
            r: (((r1 + m) * 255.0).round()) as u8,
            g: (((g1 + m) * 255.0).round()) as u8,
            b: (((b1 + m) * 255.0).round()) as u8,
        }
    }

    /// Build a vivid color from a hue in degrees (full saturation/value).
    pub fn from_hue(hue: u16) -> Rgb {
        Rgb::from_hsv(hue as f32, 1.0, 1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn driver_hex_is_standard_rrggbb() {
        assert_eq!(Rgb::new(0xff, 0x00, 0x00).to_driver_hex(), "ff0000");
        assert_eq!(Rgb::new(0x0d, 0x8a, 0x7c).to_driver_hex(), "0d8a7c");
    }

    #[test]
    fn parse_round_trips_with_driver_read_format() {
        // Driver reads back as "#rrggbb".
        let c = Rgb::parse("#0d8a7c").unwrap();
        assert_eq!(c, Rgb::new(0x0d, 0x8a, 0x7c));
        assert_eq!(format!("#{}", c.to_driver_hex()), "#0d8a7c");
    }

    #[test]
    fn parse_rejects_bad_input() {
        assert!(Rgb::parse("#12345").is_none());
        assert!(Rgb::parse("nothex").is_none());
        assert!(Rgb::parse("#gggggg").is_none());
    }

    #[test]
    fn hue_primaries() {
        assert_eq!(Rgb::from_hue(0), Rgb::new(255, 0, 0));
        assert_eq!(Rgb::from_hue(120), Rgb::new(0, 255, 0));
        assert_eq!(Rgb::from_hue(240), Rgb::new(0, 0, 255));
    }
}
