import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
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
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import { Meter, meterTone } from "@/components/ui/progress";
import { EmptyState } from "@/components/ui/states";
import {
  useCpu,
  useMemory,
  useStorage,
  useNetwork,
  useHistory,
} from "@/hooks/use-telemetry";
import { isTauri, listProcesses } from "@/lib/ipc";
import type { ProcInfo } from "@/lib/telemetry-types";
import { stagger, fadeUp } from "@/lib/motion";
import { formatBytes, formatRate } from "@/lib/format";
import { cn } from "@/lib/cn";

type SortKey = "cpu" | "mem" | "name" | "pid";

const DEMO_PROCS: ProcInfo[] = [
  { pid: 2041, name: "firefox", cpuPercent: 6.2, memMb: 1840, state: "running" },
  { pid: 3380, name: "code", cpuPercent: 3.1, memMb: 1220, state: "sleeping" },
  { pid: 6610, name: "node", cpuPercent: 2.4, memMb: 980, state: "running" },
  { pid: 1180, name: "gnome-shell", cpuPercent: 1.8, memMb: 640, state: "sleeping" },
  { pid: 7720, name: "docker", cpuPercent: 0.9, memMb: 720, state: "sleeping" },
  { pid: 4455, name: "spotify", cpuPercent: 0.6, memMb: 410, state: "sleeping" },
  { pid: 880, name: "systemd", cpuPercent: 0.1, memMb: 22, state: "sleeping" },
];

function useProcesses() {
  const [procs, setProcs] = useState<ProcInfo[]>([]);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function tick() {
      if (isTauri()) {
        try {
          const p = await listProcesses(60);
          if (!cancelled) setProcs(p);
        } catch {
          if (!cancelled) setProcs(DEMO_PROCS);
        }
      } else {
        // Jitter the demo list so it feels alive.
        setProcs(DEMO_PROCS.map((p) => ({ ...p, cpuPercent: Math.max(0, p.cpuPercent + (Math.random() - 0.5) * 1.5) })));
      }
    }
    tick();
    timer = window.setInterval(tick, 2000);
    return () => { cancelled = true; if (timer) window.clearInterval(timer); };
  }, []);
  return procs;
}

export default function TasksPage() {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("cpu");

  const cpu = useCpu();
  const mem = useMemory();
  const storage = useStorage();
  const net = useNetwork();
  const history = useHistory();
  const procs = useProcesses();

  const cpuSeries = history.map((p) => p.cpuUsage);
  const memSeries = history.map((p) => p.memUsage);
  const netSeries = history.map((p) => p.netDown);
  const diskRate = (storage[0]?.readBytesSec ?? 0) + (storage[0]?.writeBytesSec ?? 0);
  const [diskSeries, setDiskSeries] = useState<number[]>([]);
  useEffect(() => {
    setDiskSeries((s) => [...s, diskRate / 1048576].slice(-60));
  }, [diskRate]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    const list = q
      ? procs.filter((p) => p.name.toLowerCase().includes(q) || String(p.pid).includes(q))
      : procs;
    return [...list].sort((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name)
        : sort === "pid" ? a.pid - b.pid
        : sort === "mem" ? b.memMb - a.memMb
        : b.cpuPercent - a.cpuPercent,
    );
  }, [procs, query, sort]);

  return (
    <div>
      <PageHeader
        title="Task Manager"
        description="Live system resources & top processes (read-only)."
      />

      {/* Summary cards — live */}
      <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="mb-lg grid grid-cols-1 gap-md sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={Cpu} label="CPU" value={`${(cpu?.usage ?? 0).toFixed(0)}%`} sub={cpu ? `${cpu.coreCount}C / ${cpu.threadCount}T · ${(cpu.frequencyMhz / 1000).toFixed(1)} GHz` : "Detecting…"} series={cpuSeries} tone="accent" />
        <SummaryCard icon={MemoryStick} label="Memory" value={mem ? formatBytes(mem.usedBytes, 1) : "—"} sub={mem ? `${mem.usage.toFixed(0)}% of ${formatBytes(mem.totalBytes, 0)}` : "Detecting…"} series={memSeries} tone="info" />
        <SummaryCard icon={HardDrive} label="Disk" value={formatRate(diskRate)} sub={storage[0]?.device ?? "No disk"} series={diskSeries} tone="success" />
        <SummaryCard icon={Wifi} label="Network" value={net ? formatRate(net.downloadBytesSec) : "—"} sub={net ? `${net.interface} · ↑ ${formatRate(net.uploadBytesSec)}` : "Offline"} series={netSeries} tone="warning" />
      </motion.div>

      {/* Process table */}
      <GlassCard padding="none" className="overflow-hidden">
        <div className="flex items-center gap-md border-b border-border-subtle p-md">
          <div className="flex h-9 flex-1 items-center gap-sm rounded-md border border-border bg-surface-sunken/60 px-sm">
            <Search className="h-4 w-4 text-content-subtle" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by name or PID…" className="flex-1 bg-transparent text-sm text-content outline-none placeholder:text-content-subtle" />
            {query && <button onClick={() => setQuery("")} className="text-content-subtle hover:text-content"><X className="h-4 w-4" /></button>}
          </div>
          <span className="text-xs text-content-muted">{filtered.length} processes</span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={query ? Search : Boxes} title={query ? "No matching processes" : "No process data"} description={query ? `Nothing matches "${query}".` : "Process enumeration is available in the desktop app."} className="m-md border-0" />
        ) : (
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-border-subtle text-2xs uppercase tracking-wider text-content-subtle">
                  <Th label="Process" k="name" sort={sort} setSort={setSort} className="pl-md text-left" />
                  <Th label="PID" k="pid" sort={sort} setSort={setSort} className="text-left" />
                  <Th label="CPU" k="cpu" sort={sort} setSort={setSort} />
                  <Th label="Memory" k="mem" sort={sort} setSort={setSort} />
                  <th className="px-md py-xs text-left font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.pid} className="border-b border-border-subtle transition-colors last:border-0 hover:bg-surface-raised">
                    <td className="py-xs pl-md">
                      <div className="flex items-center gap-sm">
                        <div className="grid h-8 w-8 place-items-center rounded-md bg-surface-raised"><Boxes className="h-4 w-4 text-content-muted" /></div>
                        <span className="font-medium text-content">{p.name}</span>
                      </div>
                    </td>
                    <td className="px-md tabular-nums text-content-subtle">{p.pid}</td>
                    <td className="px-md"><CellMeter value={p.cpuPercent} display={`${p.cpuPercent.toFixed(1)}%`} /></td>
                    <td className="px-md"><CellMeter value={(p.memMb / 4096) * 100} display={p.memMb >= 1024 ? `${(p.memMb / 1024).toFixed(1)} GB` : `${p.memMb.toFixed(0)} MB`} /></td>
                    <td className="px-md"><Badge size="sm" variant={p.state === "running" ? "success" : p.state === "zombie" ? "danger" : "neutral"}>{p.state}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
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
