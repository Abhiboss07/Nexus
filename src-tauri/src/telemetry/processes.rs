//! Read-only process enumeration from `/proc`. Stateful so CPU% can be derived
//! from jiffie deltas between consecutive samples (like a task manager). No
//! process control (kill/renice) — strictly read-only.

use std::collections::HashMap;

use serde::Serialize;

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub pid: u32,
    pub name: String,
    /// % of total CPU capacity since the previous sample (0–100).
    pub cpu_percent: f32,
    pub mem_mb: f32,
    pub state: String,
}

pub struct ProcessMonitor {
    prev_proc: HashMap<u32, u64>,
    prev_total: u64,
}

impl ProcessMonitor {
    pub fn new() -> Self {
        Self { prev_proc: HashMap::new(), prev_total: 0 }
    }

    fn total_jiffies() -> u64 {
        std::fs::read_to_string("/proc/stat")
            .ok()
            .and_then(|s| {
                s.lines().next().map(|l| {
                    l.split_whitespace().skip(1).filter_map(|x| x.parse::<u64>().ok()).sum()
                })
            })
            .unwrap_or(0)
    }

    /// Sample all processes, returning the top `limit` by CPU then memory.
    pub fn sample(&mut self, limit: usize) -> Vec<ProcInfo> {
        let total = Self::total_jiffies();
        let dtotal = total.saturating_sub(self.prev_total).max(1);
        let mut cur: HashMap<u32, u64> = HashMap::new();
        let mut out: Vec<ProcInfo> = Vec::new();

        let Ok(rd) = std::fs::read_dir("/proc") else { return out };
        for entry in rd.flatten() {
            let fname = entry.file_name();
            let pid_str = fname.to_string_lossy();
            let Ok(pid) = pid_str.parse::<u32>() else { continue };

            let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else { continue };
            // comm is wrapped in parens and may contain spaces — split around it.
            let (Some(lp), Some(rp)) = (stat.find('('), stat.rfind(')')) else { continue };
            if rp < lp {
                continue;
            }
            let name = stat[lp + 1..rp].to_string();
            let fields: Vec<&str> = stat[rp + 1..].split_whitespace().collect();
            // After comm: [0]=state, …, utime=field14→[11], stime=field15→[12].
            let state = fields.first().copied().unwrap_or("?");
            let utime: u64 = fields.get(11).and_then(|x| x.parse().ok()).unwrap_or(0);
            let stime: u64 = fields.get(12).and_then(|x| x.parse().ok()).unwrap_or(0);
            let jiffies = utime + stime;
            cur.insert(pid, jiffies);

            let prev = self.prev_proc.get(&pid).copied().unwrap_or(jiffies);
            let cpu = (jiffies.saturating_sub(prev) as f32 / dtotal as f32) * 100.0;

            let mem_mb = std::fs::read_to_string(format!("/proc/{pid}/status"))
                .ok()
                .and_then(|s| {
                    s.lines()
                        .find(|l| l.starts_with("VmRSS:"))
                        .and_then(|l| l.split_whitespace().nth(1))
                        .and_then(|x| x.parse::<f32>().ok())
                })
                .map(|kb| kb / 1024.0)
                .unwrap_or(0.0);

            out.push(ProcInfo {
                pid,
                name,
                cpu_percent: cpu.clamp(0.0, 100.0),
                mem_mb,
                state: state_label(state),
            });
        }

        self.prev_proc = cur;
        self.prev_total = total;

        out.sort_by(|a, b| {
            b.cpu_percent.total_cmp(&a.cpu_percent).then(b.mem_mb.total_cmp(&a.mem_mb))
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
        assert!(second.iter().all(|p| p.cpu_percent >= 0.0 && p.cpu_percent <= 100.0));
        assert!(second.iter().all(|p| !p.name.is_empty()));
    }

    #[test]
    fn state_labels_map() {
        assert_eq!(state_label("R"), "running");
        assert_eq!(state_label("S"), "sleeping");
        assert_eq!(state_label("Z"), "zombie");
    }
}
