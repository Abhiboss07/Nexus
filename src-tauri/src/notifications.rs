//! Notification Center — the persistent event hub for Nexus.
//!
//! A small SQLite store (`notifications.db`) holds the event history: battery /
//! thermal alerts, completed installs, auto-switched profiles, finished Doctor
//! scans, available updates, etc. Both the frontend and backend funnel events
//! through here; each insert emits a `notification://new` event so the bell's
//! unread badge and the drawer update live.

use std::path::Path;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::Serialize;

/// Keep at most this many notifications; older ones are pruned on insert.
const HISTORY_CAP: i64 = 200;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: i64,
    pub ts: i64,
    /// Source category: battery | thermal | integration | profile | doctor |
    /// update | system.
    pub kind: String,
    /// info | success | warning | critical
    pub severity: String,
    pub title: String,
    pub body: String,
    pub read: bool,
}

pub struct NotificationStore {
    conn: Mutex<Connection>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl NotificationStore {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create data dir: {e}"))?;
        }
        Self::from_conn(Connection::open(path).map_err(|e| e.to_string())?)
    }

    pub fn in_memory() -> Result<Self, String> {
        Self::from_conn(Connection::open_in_memory().map_err(|e| e.to_string())?)
    }

    fn from_conn(conn: Connection) -> Result<Self, String> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             CREATE TABLE IF NOT EXISTS notifications (
               id       INTEGER PRIMARY KEY AUTOINCREMENT,
               ts       INTEGER NOT NULL,
               kind     TEXT NOT NULL,
               severity TEXT NOT NULL,
               title    TEXT NOT NULL,
               body     TEXT NOT NULL DEFAULT '',
               read     INTEGER NOT NULL DEFAULT 0
             );
             CREATE INDEX IF NOT EXISTS idx_notif_ts ON notifications(ts);",
        )
        .map_err(|e| e.to_string())?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn.lock().map_err(|_| "notification store poisoned".to_string())
    }

    /// Insert a notification and return the stored row. Prunes history past the
    /// cap. De-dupes a burst: if the most recent notification is identical
    /// (same kind+title+body) and under 3s old, it's returned without a new row.
    pub fn add(&self, kind: &str, severity: &str, title: &str, body: &str) -> Result<Notification, String> {
        let ts = now_ms();
        let conn = self.lock()?;

        let recent: Option<(i64, i64)> = conn
            .query_row(
                "SELECT id, ts FROM notifications
                  WHERE kind = ?1 AND title = ?2 AND body = ?3
                  ORDER BY ts DESC LIMIT 1",
                params![kind, title, body],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        if let Some((id, prev_ts)) = recent {
            if ts - prev_ts < 3000 {
                return Ok(Notification {
                    id,
                    ts: prev_ts,
                    kind: kind.into(),
                    severity: severity.into(),
                    title: title.into(),
                    body: body.into(),
                    read: false,
                });
            }
        }

        conn.execute(
            "INSERT INTO notifications (ts, kind, severity, title, body) VALUES (?1,?2,?3,?4,?5)",
            params![ts, kind, severity, title, body],
        )
        .map_err(|e| e.to_string())?;
        let id = conn.last_insert_rowid();
        // Prune to the most recent HISTORY_CAP.
        let _ = conn.execute(
            "DELETE FROM notifications WHERE id NOT IN
               (SELECT id FROM notifications ORDER BY ts DESC LIMIT ?1)",
            params![HISTORY_CAP],
        );
        Ok(Notification {
            id,
            ts,
            kind: kind.into(),
            severity: severity.into(),
            title: title.into(),
            body: body.into(),
            read: false,
        })
    }

    pub fn list(&self, limit: i64) -> Result<Vec<Notification>, String> {
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT id, ts, kind, severity, title, body, read
                   FROM notifications ORDER BY ts DESC LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit.clamp(1, HISTORY_CAP)], |r| {
                Ok(Notification {
                    id: r.get(0)?,
                    ts: r.get(1)?,
                    kind: r.get(2)?,
                    severity: r.get(3)?,
                    title: r.get(4)?,
                    body: r.get(5)?,
                    read: r.get::<_, i64>(6)? != 0,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    pub fn unread_count(&self) -> Result<i64, String> {
        let conn = self.lock()?;
        conn.query_row("SELECT COUNT(*) FROM notifications WHERE read = 0", [], |r| r.get(0))
            .map_err(|e| e.to_string())
    }

    pub fn mark_read(&self, id: i64) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute("UPDATE notifications SET read = 1 WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn mark_all_read(&self) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute("UPDATE notifications SET read = 1 WHERE read = 0", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn clear(&self) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM notifications", [])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

/// Backend-side helper: persist a notification via the managed store and emit
/// the live event. Best-effort — never panics, so callers (watchers, etc.) can
/// fire-and-forget.
pub fn push(app: &tauri::AppHandle, kind: &str, severity: &str, title: &str, body: &str) {
    use tauri::{Emitter, Manager};
    let store = app.state::<std::sync::Arc<NotificationStore>>();
    if let Ok(n) = store.add(kind, severity, title, body) {
        let _ = app.emit("notification://new", &n);
    }
}

/// Fire a native OS desktop notification (libnotify/DBus on Linux). Best-effort
/// and silent on failure (no notification daemon, etc.). Surfaces to the desktop
/// even when the Nexus window is hidden or closed.
pub fn notify_native(app: &tauri::AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn add_list_and_unread() {
        let s = NotificationStore::in_memory().unwrap();
        s.add("battery", "warning", "Low battery", "15% remaining").unwrap();
        s.add("thermal", "critical", "CPU hot", "94°C").unwrap();
        assert_eq!(s.list(10).unwrap().len(), 2);
        assert_eq!(s.unread_count().unwrap(), 2);
        // Newest first.
        assert_eq!(s.list(10).unwrap()[0].title, "CPU hot");
    }

    #[test]
    fn mark_read_and_clear() {
        let s = NotificationStore::in_memory().unwrap();
        let n = s.add("doctor", "info", "Scan complete", "No issues").unwrap();
        s.mark_read(n.id).unwrap();
        assert_eq!(s.unread_count().unwrap(), 0);
        s.add("update", "info", "Update available", "v1.1").unwrap();
        assert_eq!(s.unread_count().unwrap(), 1);
        s.mark_all_read().unwrap();
        assert_eq!(s.unread_count().unwrap(), 0);
        s.clear().unwrap();
        assert!(s.list(10).unwrap().is_empty());
    }

    #[test]
    fn dedupes_identical_burst() {
        let s = NotificationStore::in_memory().unwrap();
        let a = s.add("profile", "success", "Profile switched", "Gaming").unwrap();
        let b = s.add("profile", "success", "Profile switched", "Gaming").unwrap();
        assert_eq!(a.id, b.id); // collapsed
        assert_eq!(s.list(10).unwrap().len(), 1);
    }
}
