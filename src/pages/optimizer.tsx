import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  MemoryStick,
  Trash2,
  Package,
  ScrollText,
  Rocket,
  RotateCw,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Lock,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Meter } from "@/components/ui/progress";
import { SectionTitle } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/states";
import {
  isTauri,
  optimizerScan,
  optimizerDropCaches,
  optimizerRemoveOrphans,
  optimizerVacuumJournal,
  optimizerCleanTemp,
  optimizerSetStartup,
} from "@/lib/ipc";
import type { OptimizerReport, StartupItem } from "@/lib/optimizer-types";
import { formatBytes } from "@/lib/format";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

const DEMO: OptimizerReport = {
  memory: { totalBytes: 16_000_000_000, freeBytes: 2_000_000_000, availableBytes: 6_400_000_000, cachedBytes: 5_200_000_000, buffersBytes: 300_000_000, sreclaimableBytes: 600_000_000, swapTotalBytes: 8_000_000_000, swapUsedBytes: 1_200_000_000, reclaimableBytes: 6_100_000_000 },
  temp: [
    { id: "thumbnails", label: "Thumbnail cache", path: "~/.cache/thumbnails", sizeBytes: 240_000_000, userLevel: true, note: "Safe — regenerated on demand." },
    { id: "trash", label: "Trash", path: "~/.local/share/Trash", sizeBytes: 1_400_000_000, userLevel: true, note: "Empties your Trash." },
    { id: "user-cache", label: "User cache (~/.cache)", path: "~/.cache", sizeBytes: 3_100_000_000, userLevel: true, note: "Apps may rebuild caches." },
    { id: "tmp", label: "Temp files (/tmp)", path: "/tmp", sizeBytes: 120_000_000, userLevel: true, note: "Only files you own." },
  ],
  orphans: { supported: true, manager: "pacman", count: 7, names: ["lib32-foo", "old-bar", "stale-baz"] },
  journal: { supported: true, sizeBytes: 512_000_000, human: "488.3 MB" },
  startup: [
    { id: "syncthing.service", name: "syncthing", kind: "service", enabled: true, detail: "user service · enabled" },
    { id: "~/.config/autostart/discord.desktop", name: "Discord", kind: "autostart", enabled: true, detail: "login autostart" },
  ],
  reclaimableBytes: 4_860_000_000,
  pkexecAvailable: true,
};

type Status = { kind: "ok" | "error"; msg: string } | null;

export default function OptimizerPage() {
  const [report, setReport] = useState<OptimizerReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    if (isTauri()) {
      try { setReport(await optimizerScan()); }
      catch { setReport(DEMO); }
    } else {
      setReport(DEMO);
    }
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 5000);
    return () => clearTimeout(t);
  }, [status]);

  async function act(key: string, fn: () => Promise<string>, demoMsg: string) {
    setBusy(key);
    try {
      const msg = isTauri() ? await fn() : demoMsg;
      setStatus({ kind: "ok", msg });
      if (isTauri()) await load();
    } catch (e) {
      setStatus({ kind: "error", msg: String(e) });
    } finally {
      setBusy(null);
    }
  }

  if (loading || !report) {
    return (
      <div>
        <PageHeader title="Linux Optimizer" description="Reclaim memory & disk, prune packages, tame startup." />
        <GlassCard padding="lg" className="grid place-items-center py-2xl"><Loader2 className="h-6 w-6 animate-spin text-accent" /></GlassCard>
      </div>
    );
  }

  const mem = report.memory;
  const memUsedPct = mem.totalBytes ? ((mem.totalBytes - mem.availableBytes) / mem.totalBytes) * 100 : 0;

  return (
    <div>
      <PageHeader
        title="Linux Optimizer"
        description="Reclaim memory & disk, prune packages, tame startup — preview-first & reversible."
        actions={
          <Button variant="primary" size="md" onClick={load} disabled={loading}>
            <RotateCw className={cn("h-4 w-4", loading && "animate-spin")} /> Rescan
          </Button>
        }
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

      {!report.pkexecAvailable && (
        <div className="mb-md flex items-center gap-sm rounded-lg border border-warning/30 bg-warning/10 p-sm text-sm text-warning">
          <ShieldAlert className="h-4 w-4 shrink-0" /> polkit (pkexec) not found — privileged actions (drop caches, orphan & journal cleanup) are unavailable.
        </div>
      )}

      <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="space-y-md">
        {/* Memory optimization */}
        <motion.div variants={fadeUp}>
          <GlassCard padding="lg">
            <SectionTitle title="Memory Optimization" description="Drop kernel caches to reclaim RAM (needs authorization)" action={<MemoryStick className="h-4 w-4 text-content-subtle" />} />
            <div className="mb-md">
              <div className="mb-xs flex items-center justify-between text-sm">
                <span className="text-content-muted">{formatBytes(mem.totalBytes - mem.availableBytes, 1)} used of {formatBytes(mem.totalBytes, 0)}</span>
                <span className="text-content-subtle">Reclaimable cache ≈ {formatBytes(mem.reclaimableBytes, 1)}</span>
              </div>
              <Meter value={memUsedPct} tone={memUsedPct > 85 ? "warning" : "accent"} />
              {mem.swapTotalBytes > 0 && (
                <p className="mt-xs text-2xs text-content-subtle">Swap: {formatBytes(mem.swapUsedBytes, 1)} / {formatBytes(mem.swapTotalBytes, 0)} · Cached {formatBytes(mem.cachedBytes, 1)} · Slab {formatBytes(mem.sreclaimableBytes, 1)}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-sm">
              <PrivButton label="Page cache" busy={busy === "dc1"} disabled={!report.pkexecAvailable} onClick={() => act("dc1", () => optimizerDropCaches(1), "Demo — would drop page cache.")} />
              <PrivButton label="Dentries & inodes" busy={busy === "dc2"} disabled={!report.pkexecAvailable} onClick={() => act("dc2", () => optimizerDropCaches(2), "Demo — would drop dentries+inodes.")} />
              <PrivButton label="All caches" busy={busy === "dc3"} disabled={!report.pkexecAvailable} onClick={() => act("dc3", () => optimizerDropCaches(3), "Demo — would drop all caches.")} />
            </div>
          </GlassCard>
        </motion.div>

        {/* Temp / cache cleanup */}
        <motion.div variants={fadeUp}>
          <GlassCard padding="lg">
            <SectionTitle title="Temporary Files & Caches" description={`≈ ${formatBytes(report.reclaimableBytes, 1)} reclaimable`} action={<Trash2 className="h-4 w-4 text-content-subtle" />} />
            <div className="space-y-2xs">
              {report.temp.length === 0 && <EmptyState icon={Trash2} title="Nothing to clean" description="No caches over the threshold." className="border-0" />}
              {report.temp.map((t) => (
                <div key={t.id} className="flex items-center gap-sm rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-content">{t.label}</p>
                    <p className="truncate text-2xs text-content-subtle">{t.path} · {t.note}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-content">{formatBytes(t.sizeBytes, 1)}</span>
                  <Button variant="solid" size="sm" disabled={busy === `tmp-${t.id}`} onClick={() => {
                    if (t.id === "user-cache" && !window.confirm("Clear ~/.cache? Apps may rebuild their caches (nothing is uninstalled).")) return;
                    act(`tmp-${t.id}`, () => optimizerCleanTemp(t.id), `Demo — would clean ${t.label}.`);
                  }}>
                    {busy === `tmp-${t.id}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />} Clean
                  </Button>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        <div className="grid grid-cols-1 gap-md lg:grid-cols-2">
          {/* Package cleanup */}
          <motion.div variants={fadeUp}>
            <GlassCard padding="lg" className="h-full">
              <SectionTitle title="Orphan Packages" description={report.orphans.supported ? `${report.orphans.manager} · ${report.orphans.count} orphan(s)` : "Unsupported package manager"} action={<Package className="h-4 w-4 text-content-subtle" />} />
              {!report.orphans.supported ? (
                <p className="text-sm text-content-muted">Orphan cleanup currently supports pacman-based distros.</p>
              ) : report.orphans.count === 0 ? (
                <p className="flex items-center gap-xs text-sm text-success"><CheckCircle2 className="h-4 w-4" /> No orphan packages.</p>
              ) : (
                <>
                  <div className="mb-md max-h-32 overflow-auto rounded-md bg-surface-sunken/40 p-sm">
                    {report.orphans.names.map((n) => <code key={n} className="block text-2xs text-content-muted">{n}</code>)}
                  </div>
                  <PrivButton label={`Remove ${report.orphans.count} orphan(s)`} icon={Trash2} busy={busy === "orphans"} disabled={!report.pkexecAvailable} onClick={() => act("orphans", optimizerRemoveOrphans, "Demo — would remove orphans.")} />
                </>
              )}
            </GlassCard>
          </motion.div>

          {/* Journal cleanup */}
          <motion.div variants={fadeUp}>
            <GlassCard padding="lg" className="h-full">
              <SectionTitle title="Systemd Journal" description={report.journal.supported ? `Using ${report.journal.human}` : "journalctl unavailable"} action={<ScrollText className="h-4 w-4 text-content-subtle" />} />
              {report.journal.supported ? (
                <>
                  <p className="mb-md text-sm text-content-muted">Vacuum old logs, keeping the most recent:</p>
                  <div className="flex flex-wrap gap-sm">
                    {[7, 30, 90].map((d) => (
                      <PrivButton key={d} label={`Last ${d} days`} busy={busy === `vac${d}`} disabled={!report.pkexecAvailable} onClick={() => act(`vac${d}`, () => optimizerVacuumJournal(d), `Demo — would vacuum to ${d} days.`)} />
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-content-muted">systemd journal not detected.</p>
              )}
            </GlassCard>
          </motion.div>
        </div>

        {/* Startup optimization */}
        <motion.div variants={fadeUp}>
          <GlassCard padding="lg">
            <SectionTitle title="Startup Optimization" description={`${report.startup.length} startup item(s) — user services & login autostart`} action={<Rocket className="h-4 w-4 text-content-subtle" />} />
            {report.startup.length === 0 ? (
              <EmptyState icon={Rocket} title="No toggleable startup items" description="No user services or autostart entries found." className="border-0" />
            ) : (
              <div className="grid grid-cols-1 gap-2xs sm:grid-cols-2">
                {report.startup.map((s) => (
                  <StartupRow key={s.id} item={s} busy={busy === `su-${s.id}`} onToggle={(en) => act(`su-${s.id}`, () => optimizerSetStartup(s.id, s.kind, en), `Demo — would ${en ? "enable" : "disable"} ${s.name}.`)} />
                ))}
              </div>
            )}
          </GlassCard>
        </motion.div>
      </motion.div>
    </div>
  );
}

function PrivButton({ label, icon: Icon, busy, disabled, onClick }: { label: string; icon?: typeof Trash2; busy: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <Button variant="solid" size="md" disabled={busy || disabled} onClick={onClick} title={disabled ? "Requires polkit (pkexec)" : "Will prompt for authorization"}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : <Lock className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

function StartupRow({ item, busy, onToggle }: { item: StartupItem; busy: boolean; onToggle: (enabled: boolean) => void }) {
  return (
    <div className="flex items-center gap-sm rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
      <div className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-md", item.kind === "service" ? "bg-info/12 text-info" : "bg-accent/12 text-accent-strong")}>
        {item.kind === "service" ? <ScrollText className="h-4 w-4" /> : <Rocket className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-content">{item.name}</p>
        <p className="truncate text-2xs text-content-subtle">{item.detail}</p>
      </div>
      {busy ? <Loader2 className="h-4 w-4 animate-spin text-content-subtle" /> : <Switch checked={item.enabled} onCheckedChange={onToggle} />}
    </div>
  );
}
