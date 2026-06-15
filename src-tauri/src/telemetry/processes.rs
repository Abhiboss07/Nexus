//! Process enumeration + control from `/proc`. Stateful so CPU% and disk I/O
//! rates can be derived from deltas between consecutive samples (like a task
//! manager). Process *control* (kill/stop/continue) is delivered via the
//! standard `kill(1)` signals — no extra crates, and it respects the kernel's
//! own permission model (you can only signal your own processes unprivileged).

use std::collections::HashMap;
use std::time::Instant;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub pid: u32,
    pub ppid: u32,
    pub name: String,
    pub user: String,
    /// % of total CPU capacity since the previous sample (0–100).
    pub cpu_percent: f32,
    pub mem_mb: f32,
    /// Disk read/write rate in bytes/sec since the previous sample (best-effort;
    /// `/proc/<pid>/io` is only readable for your own processes unprivileged).
    pub disk_read_sec: f32,
    pub disk_write_sec: f32,
    pub state: String,
    /// Resolved executable path (`/proc/<pid>/exe`), empty if unreadable.
    pub exe_path: String,
}

struct IoBytes {
    read: u64,
    write: u64,
}

pub struct ProcessMonitor {
    prev_proc: HashMap<u32, u64>,
    prev_io: HashMap<u32, IoBytes>,
    prev_total: u64,
    prev_time: Option<Instant>,
    uid_names: HashMap<u32, String>,
}

impl ProcessMonitor {
    pub fn new() -> Self {
        Self {
            prev_proc: HashMap::new(),
            prev_io: HashMap::new(),
            prev_total: 0,
            prev_time: None,
            uid_names: load_passwd(),
        }
    }

    fn total_jiffies() -> u64 {
        std::fs::read_to_string("/proc/stat")
            .ok()
            .and_then(|s| {
                s.lines().next().map(|l| {
                    l.split_whitespace()
                        .skip(1)
                        .filter_map(|x| x.parse::<u64>().ok())
                        .sum()
                })
            })
            .unwrap_or(0)
    }

    fn username(&self, uid: u32) -> String {
        self.uid_names
            .get(&uid)
            .cloned()
            .unwrap_or_else(|| uid.to_string())
    }

    /// Sample all processes, returning the top `limit` by CPU then memory.
    pub fn sample(&mut self, limit: usize) -> Vec<ProcInfo> {
        let total = Self::total_jiffies();
        let dtotal = total.saturating_sub(self.prev_total).max(1);
        let now = Instant::now();
        let elapsed = self
            .prev_time
            .map(|t| now.duration_since(t).as_secs_f32())
            .unwrap_or(1.0)
            .max(0.1);
        let mut cur: HashMap<u32, u64> = HashMap::new();
        let mut cur_io: HashMap<u32, IoBytes> = HashMap::new();
        let mut out: Vec<ProcInfo> = Vec::new();

        let Ok(rd) = std::fs::read_dir("/proc") else {
            return out;
        };
        for entry in rd.flatten() {
            let fname = entry.file_name();
            let pid_str = fname.to_string_lossy();
            let Ok(pid) = pid_str.parse::<u32>() else {
                continue;
            };

            let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
                continue;
            };
            // comm is wrapped in parens and may contain spaces — split around it.
            let (Some(lp), Some(rp)) = (stat.find('('), stat.rfind(')')) else {
                continue;
            };
            if rp < lp {
                continue;
            }
            let name = stat[lp + 1..rp].to_string();
            let fields: Vec<&str> = stat[rp + 1..].split_whitespace().collect();
            // After comm: [0]=state, [1]=ppid, …, utime=field14→[11], stime=field15→[12].
            let state = fields.first().copied().unwrap_or("?");
            let ppid: u32 = fields.get(1).and_then(|x| x.parse().ok()).unwrap_or(0);
            let utime: u64 = fields.get(11).and_then(|x| x.parse().ok()).unwrap_or(0);
            let stime: u64 = fields.get(12).and_then(|x| x.parse().ok()).unwrap_or(0);
            let jiffies = utime + stime;
            cur.insert(pid, jiffies);

            let prev = self.prev_proc.get(&pid).copied().unwrap_or(jiffies);
            let cpu = (jiffies.saturating_sub(prev) as f32 / dtotal as f32) * 100.0;

            let mut mem_mb = 0.0;
            let mut uid = 0u32;
            if let Ok(s) = std::fs::read_to_string(format!("/proc/{pid}/status")) {
                for l in s.lines() {
                    if let Some(rest) = l.strip_prefix("VmRSS:") {
                        mem_mb = rest
                            .split_whitespace()
                            .next()
                            .and_then(|x| x.parse::<f32>().ok())
                            .unwrap_or(0.0)
                            / 1024.0;
                    } else if let Some(rest) = l.strip_prefix("Uid:") {
                        uid = rest
                            .split_whitespace()
                            .next()
                            .and_then(|x| x.parse::<u32>().ok())
                            .unwrap_or(0);
                    }
                }
            }

            // Disk I/O (own processes only without privilege).
            let (mut dr, mut dw) = (0.0_f32, 0.0_f32);
            if let Ok(io) = std::fs::read_to_string(format!("/proc/{pid}/io")) {
                let mut read = 0u64;
                let mut write = 0u64;
                for l in io.lines() {
                    if let Some(r) = l.strip_prefix("read_bytes:") {
                        read = r.trim().parse().unwrap_or(0);
                    } else if let Some(w) = l.strip_prefix("write_bytes:") {
                        write = w.trim().parse().unwrap_or(0);
                    }
                }
                if let Some(p) = self.prev_io.get(&pid) {
                    dr = read.saturating_sub(p.read) as f32 / elapsed;
                    dw = write.saturating_sub(p.write) as f32 / elapsed;
                }
                cur_io.insert(pid, IoBytes { read, write });
            }

            let exe_path = std::fs::read_link(format!("/proc/{pid}/exe"))
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            out.push(ProcInfo {
                pid,
                ppid,
                name,
                user: self.username(uid),
                cpu_percent: cpu.clamp(0.0, 100.0),
                mem_mb,
                disk_read_sec: dr.max(0.0),
                disk_write_sec: dw.max(0.0),
                state: state_label(state),
                exe_path,
            });
        }

        self.prev_proc = cur;
        self.prev_io = cur_io;
        self.prev_total = total;
        self.prev_time = Some(now);

        out.sort_by(|a, b| {
            b.cpu_percent
                .total_cmp(&a.cpu_percent)
                .then(b.mem_mb.total_cmp(&a.mem_mb))
        });
        out.truncate(limit);
        out
    }
}

impl Default for ProcessMonitor {
    fn default() -> Self {
        Self::new()
    }
}

/// Map a UI action to a POSIX signal and deliver it via `kill(1)`. Unprivileged
/// callers can only signal their own processes — the kernel enforces this, and
/// we surface the error rather than escalating.
pub fn process_action(pid: u32, action: &str) -> Result<String, String> {
    if pid <= 1 {
        return Err("Refusing to signal PID ≤ 1 (init / kernel).".into());
    }
    let (sig, verb) = match action {
        "terminate" | "kill" => ("TERM", "Termination signal sent"),
        "force-kill" | "force_kill" | "sigkill" => ("KILL", "Force-kill (SIGKILL) sent"),
        "stop" | "suspend" => ("STOP", "Process suspended (SIGSTOP)"),
        "continue" | "resume" => ("CONT", "Process resumed (SIGCONT)"),
        other => return Err(format!("Unknown process action '{other}'")),
    };
    let out = std::process::Command::new("kill")
        .arg(format!("-{sig}"))
        .arg(pid.to_string())
        .output()
        .map_err(|e| format!("Failed to run kill: {e}"))?;
    if out.status.success() {
        Ok(format!("{verb} to PID {pid}."))
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            format!("kill -{sig} {pid} failed (insufficient permission?)")
        } else {
            err
        })
    }
}

/// Resolve the on-disk location of a process's executable.
pub fn process_exe(pid: u32) -> Option<String> {
    std::fs::read_link(format!("/proc/{pid}/exe"))
        .ok()
        .map(|p| p.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
}

/// Build a uid→username map from /etc/passwd (cheap, read once).
fn load_passwd() -> HashMap<u32, String> {
    let mut map = HashMap::new();
    if let Ok(s) = std::fs::read_to_string("/etc/passwd") {
        for line in s.lines() {
            let parts: Vec<&str> = line.split(':').collect();
            if parts.len() >= 3 {
                if let Ok(uid) = parts[2].parse::<u32>() {
                    map.insert(uid, parts[0].to_string());
                }
            }
        }
    }
    map
}

fn state_label(s: &str) -> String {
    match s.chars().next().unwrap_or('?') {
        'R' => "running",
        'S' => "sleeping",
        'D' => "waiting",
        'Z' => "zombie",
        'T' | 't' => "stopped",
        'I' => "idle",
        _ => "unknown",
    }
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_self_on_real_proc() {
        // /proc exists on Linux test hosts; we must at least see our own PID.
        let mut m = ProcessMonitor::new();
        let first = m.sample(50);
        assert!(!first.is_empty(), "should enumerate processes");
        // Second sample yields CPU deltas without panicking.
        let second = m.sample(10);
        assert!(second.len() <= 10);
        assert!(second
            .iter()
            .all(|p| p.cpu_percent >= 0.0 && p.cpu_percent <= 100.0));
        assert!(second.iter().all(|p| !p.name.is_empty()));
    }

    #[test]
    fn state_labels_map() {
        assert_eq!(state_label("R"), "running");
        assert_eq!(state_label("S"), "sleeping");
        assert_eq!(state_label("Z"), "zombie");
    }

    #[test]
    fn rejects_init_and_unknown_actions() {
        assert!(process_action(1, "kill").is_err());
        assert!(process_action(123456, "nonsense").is_err());
    }
}
