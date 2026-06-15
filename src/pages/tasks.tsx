import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Wifi,
  Search,
  X,
  ArrowUpDown,
  Activity,
  Boxes,
  Microchip,
  Skull,
  Ban,
  Pause,
  Play,
  FolderOpen,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Flame,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import { Meter, meterTone } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/states";
import {
  useCpu,
  useGpu,
  useMemory,
  useStorage,
  useNetwork,
  useHistory,
} from "@/hooks/use-telemetry";
import {
  isTauri,
  listProcesses,
  processAction,
  revealFile,
  type ProcessAction,
} from "@/lib/ipc";
import type { ProcInfo } from "@/lib/telemetry-types";
import { stagger, fadeUp } from "@/lib/motion";
import { formatBytes, formatRate } from "@/lib/format";
import { cn } from "@/lib/cn";

type SortKey = "cpu" | "mem" | "disk" | "name" | "pid";

const DEMO_PROCS: ProcInfo[] = [
  { pid: 2041, ppid: 1, name: "firefox", user: "you", cpuPercent: 6.2, memMb: 1840, diskReadSec: 2_400_000, diskWriteSec: 120_000, state: "running", exePath: "/usr/lib/firefox/firefox" },
  { pid: 3380, ppid: 1, name: "code", user: "you", cpuPercent: 3.1, memMb: 1220, diskReadSec: 80_000, diskWriteSec: 410_000, state: "sleeping", exePath: "/usr/share/code/code" },
  { pid: 6610, ppid: 3380, name: "node", user: "you", cpuPercent: 2.4, memMb: 980, diskReadSec: 0, diskWriteSec: 64_000, state: "running", exePath: "/usr/bin/node" },
  { pid: 1180, ppid: 1, name: "gnome-shell", user: "you", cpuPercent: 1.8, memMb: 640, diskReadSec: 0, diskWriteSec: 0, state: "sleeping", exePath: "/usr/bin/gnome-shell" },
  { pid: 7720, ppid: 1, name: "docker", user: "root", cpuPercent: 0.9, memMb: 720, diskReadSec: 12_000, diskWriteSec: 240_000, state: "sleeping", exePath: "/usr/bin/dockerd" },
  { pid: 4455, ppid: 1, name: "spotify", user: "you", cpuPercent: 0.6, memMb: 410, diskReadSec: 0, diskWriteSec: 0, state: "sleeping", exePath: "/usr/bin/spotify" },
  { pid: 880, ppid: 1, name: "systemd", user: "root", cpuPercent: 0.1, memMb: 22, diskReadSec: 0, diskWriteSec: 0, state: "sleeping", exePath: "/usr/lib/systemd/systemd" },
];

function useProcesses() {
  const [procs, setProcs] = useState<ProcInfo[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function poll() {
      if (isTauri()) {
        try {
          const p = await listProcesses(120);
          if (!cancelled) setProcs(p);
        } catch {
          if (!cancelled) setProcs(DEMO_PROCS);
        }
      } else {
        setProcs(DEMO_PROCS.map((p) => ({ ...p, cpuPercent: Math.max(0, p.cpuPercent + (Math.random() - 0.5) * 1.5) })));
      }
    }
    poll();
    timer = window.setInterval(poll, 2000);
    return () => { cancelled = true; if (timer) window.clearInterval(timer); };
  }, [tick]);
  return { procs, refresh: () => setTick((t) => t + 1) };
}

type Menu = { x: number; y: number; proc: ProcInfo } | null;
type Status = { kind: "ok" | "error"; msg: string } | null;

export default function TasksPage() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("cpu");
  const [menu, setMenu] = useState<Menu>(null);
  const [status, setStatus] = useState<Status>(null);

  const cpu = useCpu();
  const gpu = useGpu();
  const mem = useMemory();
  const storage = useStorage();
  const net = useNetwork();
  const history = useHistory();
  const { procs, refresh } = useProcesses();

  const cpuSeries = history.map((p) => p.cpuUsage);
  const memSeries = history.map((p) => p.memUsage);
  const netSeries = history.map((p) => p.netDown);
  const gpuSeries = history.map((p) => p.gpuUsage);
  const diskRate = (storage[0]?.readBytesSec ?? 0) + (storage[0]?.writeBytesSec ?? 0);
  const [diskSeries, setDiskSeries] = useState<number[]>([]);
  useEffect(() => {
    setDiskSeries((s) => [...s, diskRate / 1048576].slice(-60));
  }, [diskRate]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = q
      ? procs.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).includes(q) || p.user.toLowerCase().includes(q))
      : procs;
    return [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name)
        : sort === "pid" ? a.pid - b.pid
        : sort === "mem" ? b.memMb - a.memMb
        : sort === "disk" ? (b.diskReadSec + b.diskWriteSec) - (a.diskReadSec + a.diskWriteSec)
        : b.cpuPercent - a.cpuPercent,
    );
  }, [procs, query, sort]);

  const topCpu = useMemo(() => [...procs].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 5), [procs]);
  const topMem = useMemo(() => [...procs].sort((a, b) => b.memMb - a.memMb).slice(0, 5), [procs]);

  async function act(proc: ProcInfo, action: ProcessAction) {
    setMenu(null);
    if (!isTauri()) {
      setStatus({ kind: "ok", msg: `Demo — would ${action.replace("-", " ")} ${proc.name} (PID ${proc.pid}).` });
      return;
    }
    try {
      const msg = await processAction(proc.pid, action);
      setStatus({ kind: "ok", msg });
      setTimeout(refresh, 400);
    } catch (e) {
      setStatus({ kind: "error", msg: String(e) });
    }
  }

  async function openLocation(proc: ProcInfo) {
    setMenu(null);
    if (!proc.exePath) { setStatus({ kind: "error", msg: "Executable path unavailable for this process." }); return; }
    if (!isTauri()) { setStatus({ kind: "ok", msg: `Demo — would open ${proc.exePath}` }); return; }
    try { setStatus({ kind: "ok", msg: await revealFile(proc.exePath) }); }
    catch (e) { setStatus({ kind: "error", msg: String(e) }); }
  }

  function copyPid(proc: ProcInfo) {
    setMenu(null);
    navigator.clipboard?.writeText(String(proc.pid));
    setStatus({ kind: "ok", msg: `Copied PID ${proc.pid} to clipboard.` });
  }

  // Dismiss the status banner after a moment.
  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <div onClick={() => menu && setMenu(null)}>
      <PageHeader
        title="Task Manager"
        description="Live resources & full process control — kill, suspend, locate."
      />

      <AnimatePresence>
        {status && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={cn("mb-md flex items-center gap-sm rounded-lg border p-sm text-sm", status.kind === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-success/30 bg-success/10 text-success")}>
            {status.kind === "error" ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1">{status.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Summary cards — live (CPU/RAM/Disk/Network/GPU) */}
      <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="mb-lg grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-5">
        <SummaryCard icon={Cpu} label="CPU" value={`${(cpu?.usage ?? 0).toFixed(0)}%`} sub={cpu ? `${cpu.coreCount}C / ${cpu.threadCount}T · ${(cpu.frequencyMhz / 1000).toFixed(1)} GHz` : "Detecting…"} series={cpuSeries} tone="accent" />
        <SummaryCard icon={MemoryStick} label="Memory" value={mem ? formatBytes(mem.usedBytes, 1) : "—"} sub={mem ? `${mem.usage.toFixed(0)}% of ${formatBytes(mem.totalBytes, 0)}` : "Detecting…"} series={memSeries} tone="info" />
        <SummaryCard icon={HardDrive} label="Disk" value={formatRate(diskRate)} sub={storage[0]?.device ?? "No disk"} series={diskSeries} tone="success" />
        <SummaryCard icon={Wifi} label="Network" value={net ? formatRate(net.downloadBytesSec) : "—"} sub={net ? `${net.interface} · ↑ ${formatRate(net.uploadBytesSec)}` : "Offline"} series={netSeries} tone="warning" />
        <SummaryCard icon={Microchip} label="GPU" value={gpu ? `${gpu.usage.toFixed(0)}%` : "N/A"} sub={gpu ? `${formatBytes(gpu.vramUsedMb * 1048576, 1)} / ${formatBytes(gpu.vramTotalMb * 1048576, 0)} VRAM` : "No GPU telemetry"} series={gpuSeries} tone="accent" />
      </motion.div>

      {/* Top consumers */}
      <div className="mb-lg grid grid-cols-1 gap-md lg:grid-cols-2">
        <TopConsumers title="Top CPU" icon={Flame} items={topCpu} metric={(p) => `${p.cpuPercent.toFixed(1)}%`} max={100} value={(p) => p.cpuPercent} />
        <TopConsumers title="Top Memory" icon={MemoryStick} items={topMem} metric={(p) => p.memMb >= 1024 ? `${(p.memMb / 1024).toFixed(1)} GB` : `${p.memMb.toFixed(0)} MB`} max={(mem?.totalBytes ?? 0) / 1048576} value={(p) => p.memMb} />
      </div>

      {/* Process table */}
      <GlassCard padding="none" className="overflow-hidden">
        <div className="flex items-center gap-md border-b border-border-subtle p-md">
          <div className="flex h-9 flex-1 items-center gap-sm rounded-md border border-border bg-surface-sunken/60 px-sm">
            <Search className="h-4 w-4 text-content-subtle" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name, PID or user…" className="flex-1 bg-transparent text-sm text-content outline-none placeholder:text-content-subtle" />
            {query && <button onClick={() => setQuery("")} className="text-content-subtle hover:text-content"><X className="h-4 w-4" /></button>}
          </div>
          <span className="hidden text-xs text-content-muted sm:inline">Right-click a process for actions</span>
          <span className="text-xs text-content-muted">{filtered.length} processes</span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={query ? Search : Boxes} title={query ? "No matching processes" : "No process data"} description={query ? `Nothing matches "${query}".` : "Process enumeration is available in the desktop app."} className="m-md border-0" />
        ) : (
          <div className="max-h-[55vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1] bg-surface">
                <tr className="border-b border-border-subtle text-2xs uppercase tracking-wider text-content-subtle">
                  <Th label="Process" k="name" sort={sort} setSort={setSort} className="pl-md text-left" />
                  <Th label="PID" k="pid" sort={sort} setSort={setSort} className="text-left" />
                  <th className="px-md py-xs text-left font-medium">User</th>
                  <Th label="CPU" k="cpu" sort={sort} setSort={setSort} />
                  <Th label="Memory" k="mem" sort={sort} setSort={setSort} />
                  <Th label="Disk I/O" k="disk" sort={sort} setSort={setSort} />
                  <th className="px-md py-xs text-left font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr
                    key={p.pid}
                    onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, proc: p }); }}
                    className="cursor-context-menu border-b border-border-subtle transition-colors last:border-0 hover:bg-surface-raised"
                  >
                    <td className="py-xs pl-md">
                      <div className="flex items-center gap-sm">
                        <div className="grid h-8 w-8 place-items-center rounded-md bg-surface-raised"><Boxes className="h-4 w-4 text-content-muted" /></div>
                        <span className="font-medium text-content">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-md tabular-nums text-content-subtle">{p.pid}</td>
                    <td className="px-md text-content-subtle">{p.user}</td>
                    <td className="px-md"><CellMeter value={p.cpuPercent} display={`${p.cpuPercent.toFixed(1)}%`} /></td>
                    <td className="px-md"><CellMeter value={(p.memMb / 4096) * 100} display={p.memMb >= 1024 ? `${(p.memMb / 1024).toFixed(1)} GB` : `${p.memMb.toFixed(0)} MB`} /></td>
                    <td className="px-md tabular-nums text-content-subtle">{formatRate(p.diskReadSec + p.diskWriteSec)}</td>
                    <td className="px-md"><Badge size="sm" variant={p.state === "running" ? "success" : p.state === "zombie" ? "danger" : p.state === "stopped" ? "warning" : "neutral"}>{p.state}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      {/* Context menu */}
      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.1 }}
            onClick={(e) => e.stopPropagation()}
            style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 280) }}
            className="fixed z-50 w-52 overflow-hidden rounded-lg border border-border bg-surface-raised/95 p-1 shadow-xl backdrop-blur"
          >
            <p className="truncate px-sm py-xs text-2xs text-content-subtle">{menu.proc.name} · PID {menu.proc.pid}</p>
            <MenuItem icon={Ban} label="End process" onClick={() => act(menu.proc, "terminate")} />
            <MenuItem icon={Skull} label="Force kill (SIGKILL)" danger onClick={() => act(menu.proc, "force-kill")} />
            <MenuItem icon={Pause} label="Suspend (SIGSTOP)" onClick={() => act(menu.proc, "stop")} />
            <MenuItem icon={Play} label="Resume (SIGCONT)" onClick={() => act(menu.proc, "continue")} />
            <div className="my-1 border-t border-border-subtle" />
            <MenuItem icon={FolderOpen} label="Open file location" onClick={() => openLocation(menu.proc)} />
            <MenuItem icon={Copy} label="Copy PID" onClick={() => copyPid(menu.proc)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuItem({ icon: Icon, label, onClick, danger }: { icon: typeof Copy; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={cn("flex w-full items-center gap-sm rounded-md px-sm py-xs text-left text-sm transition-colors hover:bg-surface-sunken", danger ? "text-danger" : "text-content")}>
      <Icon className="h-4 w-4 shrink-0" /> {label}
    </button>
  );
}

function TopConsumers({ title, icon: Icon, items, metric, value, max }: { title: string; icon: typeof Cpu; items: ProcInfo[]; metric: (p: ProcInfo) => string; value: (p: ProcInfo) => number; max: number }) {
  return (
    <GlassCard padding="lg">
      <div className="mb-sm flex items-center gap-xs text-sm font-semibold text-content"><Icon className="h-4 w-4 text-accent" /> {title}</div>
      <div className="space-y-2xs">
        {items.length === 0 && <p className="text-xs text-content-subtle">No data</p>}
        {items.map((p) => (
          <div key={p.pid} className="flex items-center gap-sm">
            <span className="w-32 truncate text-sm text-content">{p.name}</span>
            <Meter value={Math.min(100, (value(p) / Math.max(1, max)) * 100)} tone={meterTone(Math.min(100, (value(p) / Math.max(1, max)) * 100))} className="flex-1" height={6} />
            <span className="w-20 text-right text-xs tabular-nums text-content-muted">{metric(p)}</span>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, series, tone }: { icon: typeof Cpu; label: string; value: string; sub: string; series: number[]; tone: "accent" | "info" | "success" | "warning" }) {
  return (
    <motion.div variants={fadeUp}>
      <GlassCard padding="lg" interactive>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-xs text-sm font-medium text-content-muted"><Icon className="h-4 w-4" /> {label}</span>
          <Activity className="h-3.5 w-3.5 text-content-subtle" />
        </div>
        <p className="mt-xs font-display text-2xl font-semibold text-content">{value}</p>
        <p className="text-2xs text-content-subtle">{sub}</p>
        <div className="mt-sm"><Sparkline data={series.length ? series : [0, 0]} tone={tone} height={36} /></div>
      </GlassCard>
    </motion.div>
  );
}

function Th({ label, k, sort, setSort, className }: { label: string; k: SortKey; sort: SortKey; setSort: (k: SortKey) => void; className?: string }) {
  return (
    <th className={cn("px-md py-xs text-right font-medium", className)}>
      <button onClick={() => setSort(k)} className={cn("inline-flex items-center gap-xs hover:text-content", sort === k && "text-accent-strong")}>
        {label}<ArrowUpDown className="h-3 w-3" />
      </button>
    </th>
  );
}

function CellMeter({ value, display }: { value: number; display: string }) {
  return (
    <div className="flex items-center justify-end gap-sm">
      <Meter value={Math.min(100, value)} tone={meterTone(Math.min(100, value))} className="w-16" height={5} />
      <span className="w-16 text-right tabular-nums text-content">{display}</span>
    </div>
  );
}
