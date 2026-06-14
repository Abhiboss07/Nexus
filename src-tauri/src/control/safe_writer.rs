//! Safe sysfs write layer.
//!
//! Every hardware write goes through here. Guarantees:
//!   * **Allowlist** — writes are confined to a single base directory; the leaf
//!     name may not contain `/` or `..` (no path traversal).
//!   * **Transactional** — a multi-file write reads & stashes prior values, then
//!     applies; if any write fails, already-applied writes are **rolled back**.
//!   * **Typed errors** — EACCES → PermissionDenied, ENOENT → DriverUnavailable.
//!
//! `FsOps` abstracts the filesystem so the whole layer is unit-testable without
//! touching real sysfs.

use std::io;
use std::sync::Arc;

use crate::control::traits::ControlError;

pub trait FsOps: Send + Sync {
    fn read(&self, path: &str) -> io::Result<String>;
    fn write(&self, path: &str, value: &str) -> io::Result<()>;
    fn exists(&self, path: &str) -> bool;
}

/// Real filesystem.
pub struct RealFs;

impl FsOps for RealFs {
    fn read(&self, path: &str) -> io::Result<String> {
        std::fs::read_to_string(path).map(|s| s.trim().to_string())
    }
    fn write(&self, path: &str, value: &str) -> io::Result<()> {
        std::fs::write(path, value.as_bytes())
    }
    fn exists(&self, path: &str) -> bool {
        std::path::Path::new(path).exists()
    }
}

/// A single attribute write (`file` is a leaf within the base dir).
#[derive(Debug, Clone)]
pub struct WriteOp {
    pub file: String,
    pub value: String,
}

impl WriteOp {
    pub fn new(file: impl Into<String>, value: impl Into<String>) -> Self {
        Self { file: file.into(), value: value.into() }
    }
}

pub struct SafeWriter {
    base: String,
    fs: Arc<dyn FsOps>,
}

fn map_io(e: &io::Error) -> ControlError {
    match e.kind() {
        io::ErrorKind::PermissionDenied => ControlError::PermissionDenied,
        io::ErrorKind::NotFound => ControlError::DriverUnavailable("sysfs node missing".into()),
        _ => ControlError::Io(e.to_string()),
    }
}

impl SafeWriter {
    pub fn new(base: impl Into<String>, fs: Arc<dyn FsOps>) -> Self {
        Self { base: base.into(), fs }
    }

    /// Resolve a validated absolute path for a leaf file inside the base dir.
    fn resolve(&self, file: &str) -> Result<String, ControlError> {
        if file.is_empty() || file.contains('/') || file.contains("..") {
            return Err(ControlError::InvalidParameter(format!("unsafe path '{file}'")));
        }
        Ok(format!("{}/{}", self.base.trim_end_matches('/'), file))
    }

    pub fn read(&self, file: &str) -> Result<String, ControlError> {
        let path = self.resolve(file)?;
        self.fs.read(&path).map_err(|e| map_io(&e))
    }

    /// Apply a batch of writes transactionally. On any failure, previously
    /// applied writes in this batch are restored to their prior values.
    pub fn apply(&self, ops: &[WriteOp]) -> Result<(), ControlError> {
        // Validate all paths up front.
        let mut resolved = Vec::with_capacity(ops.len());
        for op in ops {
            resolved.push((self.resolve(&op.file)?, op.value.clone()));
        }

        // Stash prior values for rollback (best-effort; missing reads → None).
        let mut applied: Vec<(String, Option<String>)> = Vec::new();

        for (path, value) in &resolved {
            let prior = self.fs.read(path).ok();
            match self.fs.write(path, value) {
                Ok(()) => applied.push((path.clone(), prior)),
                Err(e) => {
                    let mapped = map_io(&e);
                    self.rollback(&applied);
                    return Err(mapped);
                }
            }
        }
        Ok(())
    }

    fn rollback(&self, applied: &[(String, Option<String>)]) {
        for (path, prior) in applied.iter().rev() {
            if let Some(prev) = prior {
                let _ = self.fs.write(path, prev); // best-effort restore
            }
        }
    }
}

#[cfg(test)]
pub mod test_fs {
    use super::*;
    use std::collections::{HashMap, HashSet};
    use std::sync::Mutex;

    /// In-memory filesystem. `readonly` files fail writes with PermissionDenied.
    pub struct MockFs {
        pub files: Mutex<HashMap<String, String>>,
        pub readonly: HashSet<String>,
    }

    impl MockFs {
        pub fn new(initial: &[(&str, &str)], readonly: &[&str]) -> Self {
            Self {
                files: Mutex::new(initial.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()),
                readonly: readonly.iter().map(|s| s.to_string()).collect(),
            }
        }
        pub fn get(&self, path: &str) -> Option<String> {
            self.files.lock().unwrap().get(path).cloned()
        }
    }

    impl FsOps for MockFs {
        fn read(&self, path: &str) -> io::Result<String> {
            self.files
                .lock()
                .unwrap()
                .get(path)
                .cloned()
                .ok_or_else(|| io::Error::from(io::ErrorKind::NotFound))
        }
        fn write(&self, path: &str, value: &str) -> io::Result<()> {
            if self.readonly.contains(path) {
                return Err(io::Error::from(io::ErrorKind::PermissionDenied));
            }
            self.files.lock().unwrap().insert(path.to_string(), value.to_string());
            Ok(())
        }
        fn exists(&self, path: &str) -> bool {
            self.files.lock().unwrap().contains_key(path)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_fs::MockFs;
    use super::*;

    const BASE: &str = "/sys/devices/platform/omen-rgb-keyboard/rgb_zones";

    fn writer(fs: MockFs) -> SafeWriter {
        SafeWriter::new(BASE, Arc::new(fs))
    }

    #[test]
    fn rejects_path_traversal() {
        let w = writer(MockFs::new(&[], &[]));
        assert!(matches!(w.read("../../etc/passwd"), Err(ControlError::InvalidParameter(_))));
        assert!(matches!(
            w.apply(&[WriteOp::new("a/b", "x")]),
            Err(ControlError::InvalidParameter(_))
        ));
    }

    #[test]
    fn applies_batch() {
        let fs = MockFs::new(&[
            (&format!("{BASE}/zone00"), "#000000"),
            (&format!("{BASE}/all"), "#000000"),
        ], &[]);
        let w = writer(fs);
        w.apply(&[WriteOp::new("all", "ff0000"), WriteOp::new("brightness", "80")]).unwrap();
        assert_eq!(w.read("all").unwrap(), "ff0000");
        assert_eq!(w.read("brightness").unwrap(), "80");
    }

    #[test]
    fn rolls_back_on_failure() {
        // `animation_speed` is read-only → the second write fails; the first
        // (animation_mode) must be restored to its prior value.
        let mode = format!("{BASE}/animation_mode");
        let speed = format!("{BASE}/animation_speed");
        let fs = MockFs::new(&[(&mode, "static"), (&speed, "1")], &[&speed]);
        let w = writer(fs);
        let res = w.apply(&[WriteOp::new("animation_mode", "aurora"), WriteOp::new("animation_speed", "5")]);
        assert!(matches!(res, Err(ControlError::PermissionDenied)));
        // Rolled back:
        assert_eq!(w.read("animation_mode").unwrap(), "static");
    }

    #[test]
    fn permission_denied_maps_cleanly() {
        let all = format!("{BASE}/all");
        let fs = MockFs::new(&[(&all, "#000000")], &[&all]);
        let w = writer(fs);
        assert!(matches!(w.apply(&[WriteOp::new("all", "00ff00")]), Err(ControlError::PermissionDenied)));
    }
}
