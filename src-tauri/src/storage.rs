//! Storage Analyzer Pro — a WinDirStat/Filelight-class storage suite: treemap
//! data (per-folder sizes with zoom), largest files, a content-hash duplicate
//! finder, per-application space breakdown, and scan categories. Everything is
//! bounded and runs at scan time via the async command layer (spawn_blocking),
//! never on the UI thread. Destructive ops are HOME-scoped.

use std::collections::HashMap;
use std::hash::Hasher;
use std::io::Read;
use std::process::Command;
use std::time::UNIX_EPOCH;

use serde::Serialize;

fn home() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/root".into())
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    Some(String::from_utf8_lossy(&out.stdout).to_string())
}

fn has(cmd: &str) -> bool {
    std::env::var_os("PATH")
        .map(|p| std::env::split_paths(&p).any(|d| d.join(cmd).is_file()))
        .unwrap_or(false)
}

fn du_bytes(path: &str) -> u64 {
    run("du", &["-sxb", path])
        .and_then(|s| s.split_whitespace().next().and_then(|x| x.parse().ok()))
        .unwrap_or(0)
}

fn ext_of(path: &str) -> String {
    std::path::Path::new(path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

/* ------------------------------ scan roots ------------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanRoot {
    pub id: String,
    pub label: String,
    pub path: String,
    pub size_bytes: u64,
}

/// The category roots the user can target, with sizes (only those that exist).
pub fn scan_roots() -> Vec<ScanRoot> {
    let h = home();
    let mut out = Vec::new();
    let mut add = |id: &str, label: &str, path: String| {
        if std::path::Path::new(&path).exists() {
            out.push(ScanRoot {
                id: id.into(),
                label: label.into(),
                size_bytes: du_bytes(&path),
                path,
            });
        }
    };
    add("home", "Home", h.clone());
    add("downloads", "Downloads", format!("{h}/Downloads"));
    add("documents", "Documents", format!("{h}/Documents"));
    add("videos", "Videos", format!("{h}/Videos"));
    add("pictures", "Pictures", format!("{h}/Pictures"));
    add("projects", "Projects", format!("{h}/Projects"));
    // Steam library (common locations).
    for cand in [
        format!("{h}/.local/share/Steam/steamapps"),
        format!("{h}/.steam/steam/steamapps"),
    ] {
        if std::path::Path::new(&cand).exists() {
            out.push(ScanRoot {
                id: "steam".into(),
                label: "Steam Library".into(),
                size_bytes: du_bytes(&cand),
                path: cand,
            });
            break;
        }
    }
    out
}

/* -------------------------------- treemap -------------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub is_dir: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeLevel {
    pub path: String,
    pub size_bytes: u64,
    pub children: Vec<TreeNode>,
}

/// One level of the treemap: immediate children of `path` with their sizes,
/// sorted largest-first. The UI zooms by re-querying with a child's path —
/// progressive, so we never walk the whole tree up front.
pub fn tree_level(path: &str) -> TreeLevel {
    let mut children: Vec<TreeNode> = Vec::new();

    // Subdirectory sizes in one pass.
    let mut dir_sizes: HashMap<String, u64> = HashMap::new();
    if let Some(out) = run("du", &["-xb", "--max-depth=1", path]) {
        for line in out.lines() {
            if let Some((sz, p)) = line.split_once('\t') {
                if p != path {
                    if let Ok(n) = sz.trim().parse::<u64>() {
                        dir_sizes.insert(p.to_string(), n);
                    }
                }
            }
        }
    }

    if let Ok(rd) = std::fs::read_dir(path) {
        for entry in rd.flatten() {
            let p = entry.path();
            let ps = p.to_string_lossy().to_string();
            let name = entry.file_name().to_string_lossy().to_string();
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            if meta.is_dir() {
                let size = dir_sizes.get(&ps).copied().unwrap_or(0);
                children.push(TreeNode {
                    name,
                    path: ps,
                    size_bytes: size,
                    is_dir: true,
                });
            } else if meta.is_file() {
                children.push(TreeNode {
                    name,
                    path: ps,
                    size_bytes: meta.len(),
                    is_dir: false,
                });
            }
        }
    }

    children.sort_by_key(|c| std::cmp::Reverse(c.size_bytes));
    children.truncate(60);
    let total = du_bytes(path);
    TreeLevel {
        path: path.to_string(),
        size_bytes: total,
        children,
    }
}

/* ----------------------------- largest files ----------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub name: String,
    pub path: String,
    pub size_bytes: u64,
    pub modified: u64,
    pub ext: String,
}

/// Largest files under `root`, up to `limit`. Caller sorts client-side by
/// size/date/type — we return them size-desc by default.
pub fn largest_files(root: &str, limit: usize) -> Vec<FileInfo> {
    let limit = limit.clamp(1, 500);
    let out = run(
        "find",
        &[root, "-xdev", "-type", "f", "-printf", "%s\t%T@\t%p\n"],
    )
    .unwrap_or_default();
    let mut files: Vec<FileInfo> = out
        .lines()
        .filter_map(|l| {
            let mut it = l.splitn(3, '\t');
            let size: u64 = it.next()?.trim().parse().ok()?;
            let modified: u64 = it.next()?.trim().split('.').next()?.parse().ok()?;
            let path = it.next()?.to_string();
            let name = std::path::Path::new(&path)
                .file_name()?
                .to_string_lossy()
                .to_string();
            Some(FileInfo {
                ext: ext_of(&path),
                name,
                path,
                size_bytes: size,
                modified,
            })
        })
        .collect();
    files.sort_by_key(|f| std::cmp::Reverse(f.size_bytes));
    files.truncate(limit);
    files
}

/* --------------------------- duplicate finder ---------------------------- */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DupGroup {
    pub size_bytes: u64,
    pub files: Vec<FileInfo>,
    /// Bytes reclaimable if all but one copy are removed.
    pub wasted_bytes: u64,
}

fn category_exts(category: &str) -> Option<&'static [&'static str]> {
    match category {
        "images" => Some(&["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "heic"]),
        "videos" => Some(&["mp4", "mkv", "avi", "mov", "webm", "flv", "wmv", "m4v"]),
        "archives" => Some(&["zip", "tar", "gz", "xz", "zst", "7z", "rar", "bz2"]),
        "isos" => Some(&["iso", "img"]),
        _ => None, // "generic" / "all" → no filter
    }
}

/// Hash a file's full contents with a fast non-crypto hasher (collision risk is
/// acceptable for a "candidate duplicates" finder; size match is required too).
fn hash_file(path: &str) -> Option<u64> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.write(&buf[..n]);
    }
    Some(hasher.finish())
}

/// Find duplicate files under `root` filtered by `category`. Bounded: only files
/// ≥ 1 MiB are considered and at most 8000 candidates are hashed, so a scan
/// stays responsive. Two files match when size AND content hash match.
pub fn find_duplicates(root: &str, category: &str) -> Vec<DupGroup> {
    let exts = category_exts(category);
    let listing = run(
        "find",
        &[
            root, "-xdev", "-type", "f", "-size", "+1M", "-printf", "%s\t%p\n",
        ],
    )
    .unwrap_or_default();

    // Group candidate paths by size (cheap pre-filter).
    let mut by_size: HashMap<u64, Vec<String>> = HashMap::new();
    let mut count = 0usize;
    for line in listing.lines() {
        if count >= 8000 {
            break;
        }
        let Some((sz, path)) = line.split_once('\t') else {
            continue;
        };
        let Ok(size) = sz.trim().parse::<u64>() else {
            continue;
        };
        if let Some(exts) = exts {
            if !exts.contains(&ext_of(path).as_str()) {
                continue;
            }
        }
        by_size.entry(size).or_default().push(path.to_string());
        count += 1;
    }

    let mut groups: Vec<DupGroup> = Vec::new();
    for (size, paths) in by_size {
        if paths.len() < 2 {
            continue;
        }
        // Hash only same-size files; bucket by content hash.
        let mut by_hash: HashMap<u64, Vec<String>> = HashMap::new();
        for p in paths {
            if let Some(h) = hash_file(&p) {
                by_hash.entry(h).or_default().push(p);
            }
        }
        for (_h, dupes) in by_hash {
            if dupes.len() < 2 {
                continue;
            }
            let files: Vec<FileInfo> = dupes
                .into_iter()
                .map(|path| {
                    let modified = std::fs::metadata(&path)
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_secs())
                        .unwrap_or(0);
                    let name = std::path::Path::new(&path)
                        .file_name()
                        .map(|n| n.to_string_lossy().to_string())
                        .unwrap_or_default();
                    FileInfo {
                        ext: ext_of(&path),
                        name,
                        path,
                        size_bytes: size,
                        modified,
                    }
                })
                .collect();
            let wasted = size * (files.len() as u64 - 1);
            groups.push(DupGroup {
                size_bytes: size,
                wasted_bytes: wasted,
                files,
            });
        }
    }
    groups.sort_by_key(|g| std::cmp::Reverse(g.wasted_bytes));
    groups.truncate(100);
    groups
}

/* --------------------------- space by application ------------------------ */

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUsage {
    pub app: String,
    pub total_bytes: u64,
    pub config_bytes: u64,
    pub cache_bytes: u64,
    pub data_bytes: u64,
    pub present: bool,
}

fn dir_size(path: &str) -> u64 {
    if std::path::Path::new(path).exists() {
        du_bytes(path)
    } else {
        0
    }
}

/// Per-application storage: config + cache + data, for well-known Linux apps.
#[allow(clippy::type_complexity)]
pub fn space_by_app() -> Vec<AppUsage> {
    let h = home();
    // (app, config dirs, cache dirs, data dirs)
    let specs: &[(&str, &[String], &[String], &[String])] = &[
        (
            "Steam",
            &[],
            &[],
            &[format!("{h}/.local/share/Steam"), format!("{h}/.steam")],
        ),
        (
            "Chrome",
            &[format!("{h}/.config/google-chrome")],
            &[format!("{h}/.cache/google-chrome")],
            &[],
        ),
        (
            "Chromium",
            &[format!("{h}/.config/chromium")],
            &[format!("{h}/.cache/chromium")],
            &[],
        ),
        (
            "Firefox",
            &[],
            &[format!("{h}/.cache/mozilla")],
            &[format!("{h}/.mozilla")],
        ),
        (
            "Discord",
            &[format!("{h}/.config/discord")],
            &[format!("{h}/.config/discord/Cache")],
            &[],
        ),
        (
            "VS Code",
            &[format!("{h}/.config/Code")],
            &[format!("{h}/.config/Code/CachedData")],
            &[format!("{h}/.vscode")],
        ),
        (
            "Docker",
            &[],
            &[],
            &[format!("{h}/.local/share/docker"), "/var/lib/docker".into()],
        ),
        ("Flatpak apps", &[], &[], &[format!("{h}/.var/app")]),
        (
            "Lutris",
            &[format!("{h}/.config/lutris")],
            &[format!("{h}/.cache/lutris")],
            &[format!("{h}/.local/share/lutris")],
        ),
        ("Heroic", &[format!("{h}/.config/heroic")], &[], &[]),
        (
            "Bottles",
            &[],
            &[],
            &[
                format!("{h}/.local/share/bottles"),
                format!("{h}/.var/app/com.usebottles.bottles"),
            ],
        ),
        (
            "Spotify",
            &[format!("{h}/.config/spotify")],
            &[format!("{h}/.cache/spotify")],
            &[],
        ),
    ];

    let mut out: Vec<AppUsage> = specs
        .iter()
        .map(|(app, cfg, cache, data)| {
            let config_bytes: u64 = cfg.iter().map(|p| dir_size(p)).sum();
            let cache_bytes: u64 = cache.iter().map(|p| dir_size(p)).sum();
            let data_bytes: u64 = data.iter().map(|p| dir_size(p)).sum();
            let total = config_bytes + cache_bytes + data_bytes;
            AppUsage {
                app: (*app).to_string(),
                total_bytes: total,
                config_bytes,
                cache_bytes,
                data_bytes,
                present: total > 0,
            }
        })
        .filter(|a| a.present)
        .collect();
    out.sort_by_key(|a| std::cmp::Reverse(a.total_bytes));
    out
}

/* ------------------------------- file ops -------------------------------- */

fn under_home(path: &str) -> Result<(), String> {
    let h = home();
    let canon = std::fs::canonicalize(path).map_err(|e| format!("{path}: {e}"))?;
    if canon.starts_with(&h) {
        Ok(())
    } else {
        Err("Refusing to operate outside your home directory.".into())
    }
}

/// Move a file to the Trash via gio/trash-put (reversible). HOME-scoped.
pub fn trash_file(path: &str) -> Result<String, String> {
    under_home(path)?;
    if has("gio") {
        let out = Command::new("gio")
            .args(["trash", path])
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            return Ok(format!("Moved to Trash: {path}"));
        }
    }
    if has("trash-put") {
        let out = Command::new("trash-put")
            .arg(path)
            .output()
            .map_err(|e| e.to_string())?;
        if out.status.success() {
            return Ok(format!("Moved to Trash: {path}"));
        }
    }
    Err(
        "No trash backend (install gio/glib2 or trash-cli). Use Delete to remove permanently."
            .into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_filters_known() {
        assert!(category_exts("images").unwrap().contains(&"png"));
        assert!(category_exts("generic").is_none());
    }

    #[test]
    fn ext_extraction() {
        assert_eq!(ext_of("/a/b/c.TAR.GZ"), "gz");
        assert_eq!(ext_of("/a/b/noext"), "");
    }

    #[test]
    fn roots_include_home() {
        // scan_roots always includes an existing HOME on Linux test hosts.
        assert!(scan_roots().iter().any(|r| r.id == "home"));
    }

    #[test]
    fn trash_rejects_outside_home() {
        assert!(trash_file("/etc/hostname").is_err());
    }
}
