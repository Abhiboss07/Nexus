//! Tiny, allocation-conscious helpers for reading Linux `/proc` and `/sys`.
//! Everything here is best-effort: a missing or unreadable file yields `None`
//! rather than an error, because hardware surfaces vary across machines.

use std::fs;
use std::path::Path;

pub fn read_string(path: &str) -> Option<String> {
    fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

pub fn read_u64(path: &str) -> Option<u64> {
    read_string(path).and_then(|s| s.parse().ok())
}

pub fn read_f32(path: &str) -> Option<f32> {
    read_string(path).and_then(|s| s.parse().ok())
}

pub fn exists(path: &str) -> bool {
    Path::new(path).exists()
}

/// List child entry names of a directory (non-recursive).
pub fn list_dir(path: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(path) {
        for e in entries.flatten() {
            out.push(e.file_name().to_string_lossy().to_string());
        }
    }
    out
}

/// Parse a numeric value following the first `:` on a `key: value` style line.
pub fn parse_kv_u64(line: &str) -> Option<u64> {
    line.split(':')
        .nth(1)?
        .split_whitespace()
        .next()?
        .parse()
        .ok()
}
