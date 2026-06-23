//! Persistent telemetry store (SQLite).
//!
//! The live `TelemetryService` keeps only a 120-point in-memory ring; this store
//! is the durable layer behind it. Every (throttled) snapshot is appended to
//! `samples`, grouped under a `session` (one app run). A background maintenance
//! pass rolls complete hours into `agg_hourly` so long-range history survives
//! after the raw rows are pruned, and enforces retention.
//!
//! Design goals:
//!   • Cheap writes on the hot path (single prepared INSERT, WAL mode).
//!   • Bounded growth (raw retention short, hourly aggregates kept long).
//!   • Query APIs shaped for Gaming Intelligence dashboards (sessions + history
//!     + summary stats), so they consume persisted data rather than the volatile
//!     in-memory ring.
//!
//! All public methods return `Result<_, String>` and are safe to call from any
//! thread (the connection is behind a `Mutex`).

use std::path::Path;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection};
use serde::Serialize;

use super::types::Snapshot;

/// Raw per-tick samples are kept this long (high-resolution recent window for
/// fine-grained analysis like "why FPS dropped"), then pruned once rolled into
/// `agg_hourly`.
const RAW_RETENTION_MS: i64 = 7 * 24 * 3_600_000;
/// Hourly aggregates implement the 30-day retention policy for long-range trends.
const AGG_RETENTION_MS: i64 = 30 * 24 * 3_600_000;
const HOUR_MS: i64 = 3_600_000;

pub struct TelemetryStore {
    conn: Mutex<Connection>,
    /// The session opened by `begin_session` on this run (−1 = none), so a clean
    /// quit can stamp `ended_at` without threading the id around.
    current: AtomicI64,
}

/* ------------------------------ query DTOs ------------------------------- */

/// A session (one app run) with rolled-up summary stats.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionRow {
    pub id: i64,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    /// ended_at − started_at (or now − started_at while active), ms.
    pub duration_ms: i64,
    pub samples: i64,
    pub cpu_usage_avg: f64,
    pub cpu_temp_avg: f64,
    pub cpu_temp_max: f64,
    pub gpu_usage_avg: f64,
    pub gpu_temp_avg: f64,
    pub gpu_temp_max: f64,
    /// Avg / peak FPS for the session (0 until a frame-rate source records it).
    pub fps_avg: f64,
    pub fps_max: f64,
    pub app_version: String,
}

/// One time-series point. For ranges within raw retention these are real
/// samples; for longer ranges they are hourly averages (with peak temps).
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRow {
    pub ts: i64,
    pub cpu_usage: f64,
    pub cpu_temp: f64,
    pub cpu_temp_max: f64,
    pub gpu_usage: f64,
    pub gpu_temp: f64,
    pub gpu_temp_max: f64,
    pub mem_usage: f64,
    /// Frame rate (avg for hourly rows); 0 until a frame-rate source records it.
    pub fps: f64,
    pub fps_max: f64,
    /// Resolution of this point: "raw" | "hourly".
    pub resolution: String,
}

/// Overall store-wide totals (for a "telemetry health" / storage summary).
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StoreStats {
    pub sessions: i64,
    pub samples: i64,
    pub first_sample_ts: Option<i64>,
    pub last_sample_ts: Option<i64>,
    /// Sum of session durations, ms.
    pub tracked_ms: i64,
    pub cpu_temp_peak: f64,
    pub gpu_temp_peak: f64,
    pub fps_peak: f64,
    pub db_bytes: i64,
}

/// Full per-session aggregate set — the substrate Gaming Intelligence reasons
/// over (session analytics, FPS stats, trend comparison, "why FPS dropped").
/// FPS fields are 0 until a frame-rate source records into the `fps` column.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SessionAnalytics {
    pub session_id: i64,
    pub started_at: i64,
    pub ended_at: Option<i64>,
    pub duration_ms: i64,
    pub samples: i64,
    pub cpu_usage_avg: f64,
    pub cpu_usage_max: f64,
    pub gpu_usage_avg: f64,
    pub gpu_usage_max: f64,
    pub mem_usage_avg: f64,
    pub mem_usage_max: f64,
    pub cpu_temp_avg: f64,
    pub cpu_temp_max: f64,
    pub gpu_temp_avg: f64,
    pub gpu_temp_max: f64,
    /// VRAM utilisation (% of total), avg/peak. 0 when total VRAM is unknown.
    pub vram_pct_avg: f64,
    pub vram_pct_max: f64,
    /// Avg combined CPU+GPU package power (W).
    pub power_avg_w: f64,
    /// Number of samples that actually carried a frame rate.
    pub fps_samples: i64,
    pub fps_avg: f64,
    pub fps_min: f64,
    pub fps_max: f64,
    /// Mean of the worst 1% of frames — the standard "1% low" gaming metric.
    pub fps_low1pct: f64,
    /// Share of samples at/over the throttle threshold (≥90°C CPU or GPU), %.
    pub throttle_pct: f64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn hour_bucket(ts: i64) -> i64 {
    ts - ts.rem_euclid(HOUR_MS)
}

impl TelemetryStore {
    /// Open (creating if needed) the store at `path`, applying schema + pragmas.
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("create data dir: {e}"))?;
        }
        let conn = Connection::open(path).map_err(|e| e.to_string())?;
        Self::from_conn(conn)
    }

    /// In-memory store — used by tests and as a graceful fallback when the
    /// on-disk database can't be opened (persistence degrades, app keeps running).
    pub fn in_memory() -> Result<Self, String> {
        let conn = Connection::open_in_memory().map_err(|e| e.to_string())?;
        Self::from_conn(conn)
    }

    fn from_conn(conn: Connection) -> Result<Self, String> {
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;
             PRAGMA busy_timeout = 3000;

             CREATE TABLE IF NOT EXISTS sessions (
               id          INTEGER PRIMARY KEY AUTOINCREMENT,
               started_at  INTEGER NOT NULL,
               ended_at    INTEGER,
               app_version TEXT NOT NULL DEFAULT '',
               host        TEXT NOT NULL DEFAULT ''
             );

             CREATE TABLE IF NOT EXISTS samples (
               session_id    INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
               ts            INTEGER NOT NULL,
               cpu_usage     REAL,
               cpu_temp      REAL,
               cpu_power     REAL,
               gpu_usage     REAL,
               gpu_temp      REAL,
               gpu_power     REAL,
               vram_used     INTEGER,
               mem_usage     REAL,
               cpu_fan       INTEGER,
               gpu_fan       INTEGER,
               battery_pct   REAL,
               battery_power REAL,
               fps           REAL
             );
             CREATE INDEX IF NOT EXISTS idx_samples_ts ON samples(ts);
             CREATE INDEX IF NOT EXISTS idx_samples_session ON samples(session_id);
             -- Composite time-series index for session-scoped range queries.
             CREATE INDEX IF NOT EXISTS idx_samples_session_ts ON samples(session_id, ts);

             CREATE TABLE IF NOT EXISTS agg_hourly (
               bucket        INTEGER PRIMARY KEY,
               samples       INTEGER NOT NULL,
               cpu_usage_avg REAL, cpu_usage_max REAL,
               cpu_temp_avg  REAL, cpu_temp_max  REAL,
               gpu_usage_avg REAL, gpu_usage_max REAL,
               gpu_temp_avg  REAL, gpu_temp_max  REAL,
               mem_usage_avg REAL, mem_usage_max REAL,
               fps_avg       REAL, fps_max       REAL
             );

             CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);",
        )
        .map_err(|e| e.to_string())?;
        // Idempotent migrations for DBs created before a column existed (the
        // ADD COLUMN errors harmlessly when it's already present).
        for stmt in [
            "ALTER TABLE samples ADD COLUMN fps REAL",
            "ALTER TABLE samples ADD COLUMN vram_pct REAL",
            "ALTER TABLE agg_hourly ADD COLUMN fps_avg REAL",
            "ALTER TABLE agg_hourly ADD COLUMN fps_max REAL",
        ] {
            let _ = conn.execute(stmt, []);
        }
        Ok(Self {
            conn: Mutex::new(conn),
            current: AtomicI64::new(-1),
        })
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.conn.lock().map_err(|_| "telemetry store mutex poisoned".to_string())
    }

    /* ----------------------------- sessions ----------------------------- */

    /// Close any session left open by a previous run (crash / hard kill): stamp
    /// `ended_at` with its last sample time (or `started_at` if it has none).
    /// Run once at startup before `begin_session`.
    pub fn close_stale_sessions(&self) -> Result<usize, String> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE sessions
                SET ended_at = COALESCE(
                      (SELECT MAX(ts) FROM samples WHERE samples.session_id = sessions.id),
                      started_at)
              WHERE ended_at IS NULL",
            [],
        )
        .map_err(|e| e.to_string())
    }

    /// Open a new session, returning its id and recording it as the current run.
    pub fn begin_session(&self, app_version: &str, host: &str) -> Result<i64, String> {
        let id = {
            let conn = self.lock()?;
            conn.execute(
                "INSERT INTO sessions (started_at, app_version, host) VALUES (?1, ?2, ?3)",
                params![now_ms(), app_version, host],
            )
            .map_err(|e| e.to_string())?;
            conn.last_insert_rowid()
        };
        self.current.store(id, Ordering::SeqCst);
        Ok(id)
    }

    /// The current run's session id, or `None` before `begin_session`.
    pub fn current_session(&self) -> Option<i64> {
        let id = self.current.load(Ordering::SeqCst);
        (id >= 0).then_some(id)
    }

    /// Mark a session ended (idempotent).
    pub fn end_session(&self, id: i64) -> Result<(), String> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE sessions SET ended_at = ?1 WHERE id = ?2 AND ended_at IS NULL",
            params![now_ms(), id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// End the current run's session (called on a clean quit). Best-effort.
    pub fn end_current_session(&self) {
        if let Some(id) = self.current_session() {
            let _ = self.end_session(id);
        }
    }

    /* ------------------------------ writes ------------------------------ */

    /// Append one sample for a session. The caller throttles cadence (we don't
    /// need 1.5s resolution forever); this is a single prepared INSERT. `fps` is
    /// supplied separately (it isn't part of the hardware `Snapshot`) so a future
    /// MangoHud / overlay source can record real frame rates here without any
    /// schema change — the column already exists for "FPS History" and
    /// "why FPS dropped" analysis.
    pub fn record(&self, session_id: i64, snap: &Snapshot, fps: Option<f32>) -> Result<(), String> {
        let gpu = snap.gpu.as_ref();
        let bat = snap.battery.as_ref();
        let cpu_fan = fan_rpm(&snap.fans, "CPU Fan");
        let gpu_fan = fan_rpm(&snap.fans, "GPU Fan");
        // VRAM utilisation as a % of total — the comparable signal for
        // detecting VRAM pressure (raw `vram_used` MB is kept for the chart).
        let vram_pct = gpu.and_then(|g| {
            (g.vram_total_mb > 0).then(|| g.vram_used_mb as f64 / g.vram_total_mb as f64 * 100.0)
        });
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO samples
               (session_id, ts, cpu_usage, cpu_temp, cpu_power,
                gpu_usage, gpu_temp, gpu_power, vram_used, mem_usage,
                cpu_fan, gpu_fan, battery_pct, battery_power, fps, vram_pct)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                session_id,
                snap.timestamp as i64,
                snap.cpu.usage,
                snap.cpu.temperature_c,
                snap.cpu.package_power_w,
                gpu.map(|g| g.usage),
                gpu.and_then(|g| g.temperature_c),
                gpu.and_then(|g| g.power_w),
                gpu.map(|g| g.vram_used_mb as i64),
                snap.memory.usage,
                cpu_fan,
                gpu_fan,
                bat.map(|b| b.charge_percent),
                bat.map(|b| b.power_draw_w),
                fps,
                vram_pct,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /* -------------------------- aggregation pipeline -------------------- */

    /// Roll every *complete* hour that hasn't been aggregated yet into
    /// `agg_hourly`. Idempotent (upsert by bucket) and cheap — it only scans the
    /// buckets since the last run. Returns the number of buckets written.
    pub fn aggregate(&self) -> Result<usize, String> {
        let conn = self.lock()?;
        let last: i64 = conn
            .query_row(
                "SELECT value FROM meta WHERE key = 'last_agg_bucket'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        let current_hour = hour_bucket(now_ms());

        let mut stmt = conn
            .prepare(
                "SELECT (ts/?1)*?1 AS bucket, COUNT(*),
                        AVG(cpu_usage), MAX(cpu_usage),
                        AVG(cpu_temp),  MAX(cpu_temp),
                        AVG(gpu_usage), MAX(gpu_usage),
                        AVG(gpu_temp),  MAX(gpu_temp),
                        AVG(mem_usage), MAX(mem_usage),
                        AVG(fps),       MAX(fps)
                   FROM samples
                  WHERE ts >= ?2 AND ts < ?3
                  GROUP BY bucket",
            )
            .map_err(|e| e.to_string())?;
        let start = last.max(0);
        let rows = stmt
            .query_map(params![HOUR_MS, start, current_hour], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, Option<f64>>(2)?,
                    r.get::<_, Option<f64>>(3)?,
                    r.get::<_, Option<f64>>(4)?,
                    r.get::<_, Option<f64>>(5)?,
                    r.get::<_, Option<f64>>(6)?,
                    r.get::<_, Option<f64>>(7)?,
                    r.get::<_, Option<f64>>(8)?,
                    r.get::<_, Option<f64>>(9)?,
                    r.get::<_, Option<f64>>(10)?,
                    r.get::<_, Option<f64>>(11)?,
                    r.get::<_, Option<f64>>(12)?,
                    r.get::<_, Option<f64>>(13)?,
                ))
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut written = 0;
        for row in &rows {
            conn.execute(
                "INSERT OR REPLACE INTO agg_hourly
                   (bucket, samples, cpu_usage_avg, cpu_usage_max, cpu_temp_avg, cpu_temp_max,
                    gpu_usage_avg, gpu_usage_max, gpu_temp_avg, gpu_temp_max,
                    mem_usage_avg, mem_usage_max, fps_avg, fps_max)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
                params![
                    row.0, row.1, row.2, row.3, row.4, row.5, row.6, row.7, row.8, row.9, row.10,
                    row.11, row.12, row.13
                ],
            )
            .map_err(|e| e.to_string())?;
            written += 1;
        }

        if current_hour > start {
            conn.execute(
                "INSERT OR REPLACE INTO meta (key, value) VALUES ('last_agg_bucket', ?1)",
                params![current_hour.to_string()],
            )
            .map_err(|e| e.to_string())?;
        }
        Ok(written)
    }

    /// Enforce retention: drop raw samples past `RAW_RETENTION_MS` (already
    /// aggregated), hourly aggregates past `AGG_RETENTION_MS`, and sessions whose
    /// samples are all gone and that ended long ago.
    pub fn prune(&self) -> Result<(), String> {
        let now = now_ms();
        let conn = self.lock()?;
        conn.execute("DELETE FROM samples WHERE ts < ?1", params![now - RAW_RETENTION_MS])
            .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM agg_hourly WHERE bucket < ?1",
            params![now - AGG_RETENTION_MS],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM sessions
              WHERE ended_at IS NOT NULL
                AND ended_at < ?1
                AND NOT EXISTS (SELECT 1 FROM samples WHERE samples.session_id = sessions.id)",
            params![now - AGG_RETENTION_MS],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /* ------------------------------ queries ----------------------------- */

    /// Recent sessions (newest first) with rolled-up summary stats.
    pub fn sessions(&self, limit: i64) -> Result<Vec<SessionRow>, String> {
        let now = now_ms();
        let conn = self.lock()?;
        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.started_at, s.ended_at, s.app_version,
                        COUNT(x.ts),
                        AVG(x.cpu_usage), AVG(x.cpu_temp), MAX(x.cpu_temp),
                        AVG(x.gpu_usage), AVG(x.gpu_temp), MAX(x.gpu_temp),
                        AVG(x.fps), MAX(x.fps)
                   FROM sessions s
                   LEFT JOIN samples x ON x.session_id = s.id
                  GROUP BY s.id
                  ORDER BY s.started_at DESC
                  LIMIT ?1",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![limit], |r| {
                let started: i64 = r.get(1)?;
                let ended: Option<i64> = r.get(2)?;
                Ok(SessionRow {
                    id: r.get(0)?,
                    started_at: started,
                    ended_at: ended,
                    duration_ms: ended.unwrap_or(now) - started,
                    app_version: r.get(3)?,
                    samples: r.get(4)?,
                    cpu_usage_avg: r.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                    cpu_temp_avg: r.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                    cpu_temp_max: r.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                    gpu_usage_avg: r.get::<_, Option<f64>>(8)?.unwrap_or(0.0),
                    gpu_temp_avg: r.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                    gpu_temp_max: r.get::<_, Option<f64>>(10)?.unwrap_or(0.0),
                    fps_avg: r.get::<_, Option<f64>>(11)?.unwrap_or(0.0),
                    fps_max: r.get::<_, Option<f64>>(12)?.unwrap_or(0.0),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    /// One session's summary (same shape as a `sessions()` row).
    pub fn session_summary(&self, id: i64) -> Result<Option<SessionRow>, String> {
        Ok(self.sessions(i64::MAX)?.into_iter().find(|s| s.id == id))
    }

    /// Raw per-sample timeline for one session (down-sampled to ~`max_points`),
    /// independent of the retention window — feeds FPS/thermal history charts.
    pub fn session_series(&self, session_id: i64, max_points: i64) -> Result<Vec<HistoryRow>, String> {
        let max_points = max_points.clamp(10, 5000);
        let conn = self.lock()?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM samples WHERE session_id = ?1",
                params![session_id],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        let stride = (count / max_points).max(1);
        let mut stmt = conn
            .prepare(
                "SELECT ts, cpu_usage, cpu_temp, gpu_usage, gpu_temp, mem_usage, fps
                   FROM (SELECT ts, cpu_usage, cpu_temp, gpu_usage, gpu_temp, mem_usage, fps,
                                ROW_NUMBER() OVER (ORDER BY ts) AS rn
                           FROM samples WHERE session_id = ?1)
                  WHERE (rn - 1) % ?2 = 0
                  ORDER BY ts",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![session_id, stride], |r| {
                let cpu_t = r.get::<_, Option<f64>>(2)?.unwrap_or(0.0);
                let gpu_t = r.get::<_, Option<f64>>(4)?.unwrap_or(0.0);
                let fps = r.get::<_, Option<f64>>(6)?.unwrap_or(0.0);
                Ok(HistoryRow {
                    ts: r.get(0)?,
                    cpu_usage: r.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                    cpu_temp: cpu_t,
                    cpu_temp_max: cpu_t,
                    gpu_usage: r.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                    gpu_temp: gpu_t,
                    gpu_temp_max: gpu_t,
                    mem_usage: r.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                    fps,
                    fps_max: fps,
                    resolution: "raw".into(),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    /// Full aggregate analytics for one session (SQL-computed avgs/peaks/mins +
    /// throttle share + FPS stats incl. the 1% low). `None` if the session has no
    /// samples. This is the per-session substrate the gaming-intelligence layer
    /// interprets — all heavy math stays in the store/SQL, not the UI.
    pub fn session_analytics(&self, session_id: i64) -> Result<Option<SessionAnalytics>, String> {
        let now = now_ms();
        let conn = self.lock()?;

        let meta: Option<(i64, Option<i64>)> = conn
            .query_row(
                "SELECT started_at, ended_at FROM sessions WHERE id = ?1",
                params![session_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .ok();
        let Some((started_at, ended_at)) = meta else {
            return Ok(None);
        };

        let mut a = conn
            .query_row(
                "SELECT COUNT(*),
                        AVG(cpu_usage), MAX(cpu_usage),
                        AVG(gpu_usage), MAX(gpu_usage),
                        AVG(mem_usage), MAX(mem_usage),
                        AVG(cpu_temp),  MAX(cpu_temp),
                        AVG(gpu_temp),  MAX(gpu_temp),
                        AVG(COALESCE(cpu_power,0) + COALESCE(gpu_power,0)),
                        SUM(CASE WHEN fps IS NOT NULL THEN 1 ELSE 0 END),
                        AVG(fps), MIN(fps), MAX(fps),
                        SUM(CASE WHEN cpu_temp >= 90 OR gpu_temp >= 90 THEN 1 ELSE 0 END),
                        AVG(vram_pct), MAX(vram_pct)
                   FROM samples WHERE session_id = ?1",
                params![session_id],
                |r| {
                    Ok(SessionAnalytics {
                        session_id,
                        started_at,
                        ended_at,
                        duration_ms: ended_at.unwrap_or(now) - started_at,
                        samples: r.get(0)?,
                        cpu_usage_avg: r.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                        cpu_usage_max: r.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                        gpu_usage_avg: r.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                        gpu_usage_max: r.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                        mem_usage_avg: r.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                        mem_usage_max: r.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                        cpu_temp_avg: r.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                        cpu_temp_max: r.get::<_, Option<f64>>(8)?.unwrap_or(0.0),
                        gpu_temp_avg: r.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                        gpu_temp_max: r.get::<_, Option<f64>>(10)?.unwrap_or(0.0),
                        // Column 16 (throttle SUM) is recomputed separately below.
                        vram_pct_avg: r.get::<_, Option<f64>>(17)?.unwrap_or(0.0),
                        vram_pct_max: r.get::<_, Option<f64>>(18)?.unwrap_or(0.0),
                        power_avg_w: r.get::<_, Option<f64>>(11)?.unwrap_or(0.0),
                        fps_samples: r.get::<_, Option<i64>>(12)?.unwrap_or(0),
                        fps_avg: r.get::<_, Option<f64>>(13)?.unwrap_or(0.0),
                        fps_min: r.get::<_, Option<f64>>(14)?.unwrap_or(0.0),
                        fps_max: r.get::<_, Option<f64>>(15)?.unwrap_or(0.0),
                        fps_low1pct: 0.0,
                        throttle_pct: 0.0,
                    })
                },
            )
            .map_err(|e| e.to_string())?;

        if a.samples == 0 {
            return Ok(None);
        }
        let throttle_count: i64 = conn
            .query_row(
                "SELECT SUM(CASE WHEN cpu_temp >= 90 OR gpu_temp >= 90 THEN 1 ELSE 0 END)
                   FROM samples WHERE session_id = ?1",
                params![session_id],
                |r| r.get::<_, Option<i64>>(0).map(|v| v.unwrap_or(0)),
            )
            .map_err(|e| e.to_string())?;
        a.throttle_pct = (throttle_count as f64) / (a.samples as f64) * 100.0;

        // 1% low: mean of the worst 1% of frames (min 1 frame).
        if a.fps_samples > 0 {
            let n = (a.fps_samples / 100).max(1);
            a.fps_low1pct = conn
                .query_row(
                    "SELECT AVG(fps) FROM (SELECT fps FROM samples
                       WHERE session_id = ?1 AND fps IS NOT NULL
                       ORDER BY fps ASC LIMIT ?2)",
                    params![session_id, n],
                    |r| r.get::<_, Option<f64>>(0).map(|v| v.unwrap_or(0.0)),
                )
                .map_err(|e| e.to_string())?;
        }

        Ok(Some(a))
    }

    /// Time-series history for `[since, until]`. Picks resolution automatically:
    /// ranges within raw retention return real samples (down-sampled to roughly
    /// `max_points`); longer ranges return hourly aggregates.
    pub fn history(&self, since: i64, until: i64, max_points: i64) -> Result<Vec<HistoryRow>, String> {
        let now = now_ms();
        let max_points = max_points.clamp(10, 5000);
        let conn = self.lock()?;

        // Use raw samples when the whole window is still inside raw retention.
        if since >= now - RAW_RETENTION_MS {
            let count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM samples WHERE ts >= ?1 AND ts <= ?2",
                    params![since, until],
                    |r| r.get(0),
                )
                .map_err(|e| e.to_string())?;
            // Down-sample with modulo on rowid so charts stay light.
            let stride = (count / max_points).max(1);
            let mut stmt = conn
                .prepare(
                    "SELECT ts, cpu_usage, cpu_temp, gpu_usage, gpu_temp, mem_usage, fps
                       FROM (SELECT ts, cpu_usage, cpu_temp, gpu_usage, gpu_temp, mem_usage, fps,
                                    ROW_NUMBER() OVER (ORDER BY ts) AS rn
                               FROM samples WHERE ts >= ?1 AND ts <= ?2)
                      WHERE (rn - 1) % ?3 = 0
                      ORDER BY ts",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![since, until, stride], |r| {
                    let cpu_t = r.get::<_, Option<f64>>(2)?.unwrap_or(0.0);
                    let gpu_t = r.get::<_, Option<f64>>(4)?.unwrap_or(0.0);
                    let fps = r.get::<_, Option<f64>>(6)?.unwrap_or(0.0);
                    Ok(HistoryRow {
                        ts: r.get(0)?,
                        cpu_usage: r.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                        cpu_temp: cpu_t,
                        cpu_temp_max: cpu_t,
                        gpu_usage: r.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                        gpu_temp: gpu_t,
                        gpu_temp_max: gpu_t,
                        mem_usage: r.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                        fps,
                        fps_max: fps,
                        resolution: "raw".into(),
                    })
                })
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            return Ok(rows);
        }

        // Longer window → hourly aggregates.
        let mut stmt = conn
            .prepare(
                "SELECT bucket, cpu_usage_avg, cpu_temp_avg, cpu_temp_max,
                        gpu_usage_avg, gpu_temp_avg, gpu_temp_max, mem_usage_avg,
                        fps_avg, fps_max
                   FROM agg_hourly
                  WHERE bucket >= ?1 AND bucket <= ?2
                  ORDER BY bucket",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![since, until], |r| {
                Ok(HistoryRow {
                    ts: r.get(0)?,
                    cpu_usage: r.get::<_, Option<f64>>(1)?.unwrap_or(0.0),
                    cpu_temp: r.get::<_, Option<f64>>(2)?.unwrap_or(0.0),
                    cpu_temp_max: r.get::<_, Option<f64>>(3)?.unwrap_or(0.0),
                    gpu_usage: r.get::<_, Option<f64>>(4)?.unwrap_or(0.0),
                    gpu_temp: r.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                    gpu_temp_max: r.get::<_, Option<f64>>(6)?.unwrap_or(0.0),
                    mem_usage: r.get::<_, Option<f64>>(7)?.unwrap_or(0.0),
                    fps: r.get::<_, Option<f64>>(8)?.unwrap_or(0.0),
                    fps_max: r.get::<_, Option<f64>>(9)?.unwrap_or(0.0),
                    resolution: "hourly".into(),
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(rows)
    }

    /// Store-wide totals.
    pub fn stats(&self) -> Result<StoreStats, String> {
        let conn = self.lock()?;
        let (sessions, tracked): (i64, i64) = conn
            .query_row(
                "SELECT COUNT(*), COALESCE(SUM(COALESCE(ended_at, started_at) - started_at), 0)
                   FROM sessions",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .map_err(|e| e.to_string())?;
        let (samples, first_ts, last_ts, cpu_peak, gpu_peak, fps_peak) = conn
            .query_row(
                "SELECT COUNT(*), MIN(ts), MAX(ts), MAX(cpu_temp), MAX(gpu_temp), MAX(fps) FROM samples",
                [],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, Option<i64>>(1)?,
                        r.get::<_, Option<i64>>(2)?,
                        r.get::<_, Option<f64>>(3)?,
                        r.get::<_, Option<f64>>(4)?,
                        r.get::<_, Option<f64>>(5)?,
                    ))
                },
            )
            .map_err(|e| e.to_string())?;
        // Hourly aggregates can hold older peaks than the raw window.
        let (agg_cpu_peak, agg_gpu_peak, agg_fps_peak): (Option<f64>, Option<f64>, Option<f64>) =
            conn.query_row(
                "SELECT MAX(cpu_temp_max), MAX(gpu_temp_max), MAX(fps_max) FROM agg_hourly",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .map_err(|e| e.to_string())?;
        let db_bytes: i64 = conn
            .query_row(
                "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()",
                [],
                |r| r.get(0),
            )
            .unwrap_or(0);
        Ok(StoreStats {
            sessions,
            samples,
            first_sample_ts: first_ts,
            last_sample_ts: last_ts,
            tracked_ms: tracked,
            cpu_temp_peak: cpu_peak.unwrap_or(0.0).max(agg_cpu_peak.unwrap_or(0.0)),
            gpu_temp_peak: gpu_peak.unwrap_or(0.0).max(agg_gpu_peak.unwrap_or(0.0)),
            fps_peak: fps_peak.unwrap_or(0.0).max(agg_fps_peak.unwrap_or(0.0)),
            db_bytes,
        })
    }
}

/// First fan RPM matching `label`, else 0.
fn fan_rpm(fans: &[super::types::FanTelemetry], label: &str) -> u32 {
    fans.iter().find(|f| f.label == label).map(|f| f.rpm).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::types::{
        BatteryTelemetry, CpuTelemetry, FanTelemetry, GpuTelemetry, Snapshot,
    };

    fn snap(ts: u64, cpu_t: f32, gpu_t: f32) -> Snapshot {
        Snapshot {
            timestamp: ts,
            cpu: CpuTelemetry {
                usage: 40.0,
                temperature_c: Some(cpu_t),
                package_power_w: Some(25.0),
                ..Default::default()
            },
            gpu: Some(GpuTelemetry {
                usage: 60.0,
                temperature_c: Some(gpu_t),
                vram_used_mb: 1024,
                power_w: Some(45.0),
                ..Default::default()
            }),
            battery: Some(BatteryTelemetry {
                charge_percent: 80.0,
                power_draw_w: 12.0,
                ..Default::default()
            }),
            fans: vec![
                FanTelemetry { label: "CPU Fan".into(), rpm: 2200 },
                FanTelemetry { label: "GPU Fan".into(), rpm: 2400 },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn records_and_summarizes_a_session() {
        let store = TelemetryStore::in_memory().unwrap();
        let sid = store.begin_session("1.0.0-test", "host").unwrap();
        let base = now_ms() as u64;
        for i in 0..10 {
            store
                .record(sid, &snap(base + i * 1000, 60.0 + i as f32, 50.0 + i as f32), Some(120.0 + i as f32))
                .unwrap();
        }
        store.end_session(sid).unwrap();

        let sessions = store.sessions(10).unwrap();
        assert_eq!(sessions.len(), 1);
        let s = &sessions[0];
        assert_eq!(s.samples, 10);
        assert!(s.ended_at.is_some());
        assert!(s.cpu_temp_max >= 69.0); // 60 + 9
        assert!(s.gpu_temp_max >= 59.0);
        assert!(s.cpu_usage_avg > 0.0);
        assert!(s.fps_max >= 129.0); // 120 + 9
        assert!(s.fps_avg > 0.0);

        let one = store.session_summary(sid).unwrap().unwrap();
        assert_eq!(one.id, sid);
    }

    #[test]
    fn close_stale_sessions_stamps_open_runs() {
        let store = TelemetryStore::in_memory().unwrap();
        let sid = store.begin_session("v", "h").unwrap();
        store.record(sid, &snap(now_ms() as u64, 55.0, 45.0), None).unwrap();
        // Simulate a crash: session left open. A fresh boot closes it.
        let closed = store.close_stale_sessions().unwrap();
        assert_eq!(closed, 1);
        let s = &store.sessions(1).unwrap()[0];
        assert!(s.ended_at.is_some());
    }

    #[test]
    fn history_returns_raw_recent_samples() {
        let store = TelemetryStore::in_memory().unwrap();
        let sid = store.begin_session("v", "h").unwrap();
        let base = now_ms();
        for i in 0..50 {
            store.record(sid, &snap((base + i * 1000) as u64, 50.0, 40.0), None).unwrap();
        }
        let rows = store.history(base - 1000, base + 60_000, 1000).unwrap();
        assert_eq!(rows.len(), 50);
        assert!(rows.iter().all(|r| r.resolution == "raw"));
        // Monotonic timestamps.
        assert!(rows.windows(2).all(|w| w[1].ts >= w[0].ts));
    }

    #[test]
    fn history_downsamples_to_max_points() {
        let store = TelemetryStore::in_memory().unwrap();
        let sid = store.begin_session("v", "h").unwrap();
        let base = now_ms();
        for i in 0..400 {
            store.record(sid, &snap((base + i * 100) as u64, 50.0, 40.0), None).unwrap();
        }
        let rows = store.history(base - 1000, base + 60_000, 50).unwrap();
        // Down-sampled to roughly max_points (stride = 400/50 = 8 → ~50 rows).
        assert!(rows.len() <= 60, "expected ~50, got {}", rows.len());
        assert!(rows.len() >= 40);
    }

    #[test]
    fn aggregate_rolls_complete_hours_into_hourly() {
        let store = TelemetryStore::in_memory().unwrap();
        let sid = store.begin_session("v", "h").unwrap();
        // Put samples 3 hours ago (a complete, past hour bucket).
        let three_h_ago = now_ms() - 3 * HOUR_MS;
        for i in 0..6 {
            store
                .record(sid, &snap((three_h_ago + i * 60_000) as u64, 70.0 + i as f32, 60.0), None)
                .unwrap();
        }
        let written = store.aggregate().unwrap();
        assert!(written >= 1);
        // Query a window that starts before raw retention → forces the hourly
        // path; it must include the bucket we just aggregated (3h ago).
        let agg = store.history(now_ms() - AGG_RETENTION_MS, now_ms(), 1000).unwrap();
        assert!(!agg.is_empty());
        assert!(agg.iter().all(|r| r.resolution == "hourly"));
        assert!(agg.iter().any(|r| r.cpu_temp_max >= 70.0));
        // Re-running aggregate is idempotent (no duplicate buckets).
        let again = store.history(now_ms() - AGG_RETENTION_MS, now_ms(), 1000).unwrap();
        store.aggregate().unwrap();
        let after = store.history(now_ms() - AGG_RETENTION_MS, now_ms(), 1000).unwrap();
        assert_eq!(again.len(), after.len());
    }

    #[test]
    fn session_analytics_aggregates_everything() {
        let store = TelemetryStore::in_memory().unwrap();
        let sid = store.begin_session("v", "h").unwrap();
        let base = now_ms() as u64;
        // 100 samples; last few are hot (≥90°C) to exercise throttle_pct.
        for i in 0..100 {
            let cpu_t = if i >= 95 { 92.0 } else { 60.0 };
            store
                .record(sid, &snap(base + i * 1000, cpu_t, 55.0), Some(100.0 + (i % 20) as f32))
                .unwrap();
        }
        let a = store.session_analytics(sid).unwrap().unwrap();
        assert_eq!(a.samples, 100);
        assert!(a.cpu_usage_avg > 0.0);
        assert!(a.power_avg_w > 0.0); // cpu_power 25 + gpu_power 45
        assert_eq!(a.fps_samples, 100);
        assert!(a.fps_avg > 0.0);
        assert!(a.fps_low1pct > 0.0);
        // 5 of 100 samples were ≥90°C.
        assert!((a.throttle_pct - 5.0).abs() < 0.01);
        // Unknown session → None.
        assert!(store.session_analytics(999).unwrap().is_none());
    }

    #[test]
    fn session_series_returns_session_scoped_timeline() {
        let store = TelemetryStore::in_memory().unwrap();
        let a = store.begin_session("v", "h").unwrap();
        let b = store.begin_session("v", "h").unwrap();
        let base = now_ms() as u64;
        for i in 0..20 {
            store.record(a, &snap(base + i * 1000, 50.0, 40.0), None).unwrap();
        }
        for i in 0..5 {
            store.record(b, &snap(base + i * 1000, 50.0, 40.0), None).unwrap();
        }
        assert_eq!(store.session_series(a, 1000).unwrap().len(), 20);
        assert_eq!(store.session_series(b, 1000).unwrap().len(), 5);
    }

    #[test]
    fn stats_reports_totals_and_peaks() {
        let store = TelemetryStore::in_memory().unwrap();
        let sid = store.begin_session("v", "h").unwrap();
        let base = now_ms() as u64;
        store.record(sid, &snap(base, 88.0, 77.0), Some(165.0)).unwrap();
        store.record(sid, &snap(base + 1000, 60.0, 50.0), Some(90.0)).unwrap();
        store.end_session(sid).unwrap();
        let s = store.stats().unwrap();
        assert_eq!(s.sessions, 1);
        assert_eq!(s.samples, 2);
        assert!(s.cpu_temp_peak >= 88.0);
        assert!(s.gpu_temp_peak >= 77.0);
        assert!(s.fps_peak >= 165.0);
        assert!(s.db_bytes > 0);
    }
}
