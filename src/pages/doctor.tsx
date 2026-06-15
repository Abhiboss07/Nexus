import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Stethoscope,
  ShieldCheck,
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Info,
  Download,
  Lock,
  Copy,
  RotateCw,
  ChevronDown,
  HardDrive,
  FolderOpen,
  Trash2,
  Sparkles,
  FileText,
  EyeOff,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RingGauge } from "@/components/ui/ring-gauge";
import { SectionTitle } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/states";
import {
  isTauri,
  runHealthCheck,
  checkPermissions,
  exportDiagnostics,
  runSystemScan,
  deleteFile,
  revealFile,
  serviceAction,
} from "@/lib/ipc";
import type { HealthCheck, Permissions } from "@/lib/system-types";
import type { ScanCategory, Severity, SystemScan, FileEntry } from "@/lib/sysdoctor-types";
import { formatBytes } from "@/lib/format";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

const DEMO_HEALTH: HealthCheck = {
  passed: 8,
  total: 10,
  checks: [
    { name: "Telemetry stream", status: "ok", detail: "Live frames flowing" },
    { name: "CPU sensors", status: "ok", detail: "13th Gen Intel Core i5-13420H" },
    { name: "GPU (NVIDIA)", status: "ok", detail: "CUDA 13.3" },
    { name: "Power profiles", status: "ok", detail: "power-profiles-daemon" },
    { name: "OMEN RGB driver", status: "ok", detail: "omen-rgb-keyboard loaded" },
    { name: "Fan interface", status: "ok", detail: "omen-rgb-keyboard" },
    { name: "Battery", status: "ok", detail: "power_supply sysfs" },
    { name: "Input group", status: "ok", detail: "Member" },
    { name: "RGB write access", status: "ok", detail: "Writable" },
    { name: "Fan write access", status: "ok", detail: "Writable" },
  ],
};
const DEMO_PERMS: Permissions = {
  inInputGroup: true, rgbWritable: true, fanWritable: true, powerControllable: true,
  remediation: "",
};

const STATUS: Record<string, { icon: LucideIcon; cls: string }> = {
  ok: { icon: CheckCircle2, cls: "text-success" },
  info: { icon: Info, cls: "text-info" },
  warn: { icon: AlertTriangle, cls: "text-warning" },
  warning: { icon: AlertTriangle, cls: "text-warning" },
  fail: { icon: XCircle, cls: "text-danger" },
  critical: { icon: XCircle, cls: "text-danger" },
};

const SEV_BADGE: Record<Severity, "success" | "neutral" | "warning" | "danger"> = {
  ok: "success",
  info: "neutral",
  warning: "warning",
  critical: "danger",
};

export default function DoctorPage() {
  const [phase, setPhase] = useState<"idle" | "scanning" | "done">("idle");
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [scan, setScan] = useState<SystemScan | null>(null);
  // Request-versioning: each scan gets an id; results from a superseded or
  // cancelled run are ignored (the backend command is async & off the UI thread,
  // so the page never freezes — Cancel just stops awaiting the in-flight run).
  const runId = useRef(0);

  async function runScan() {
    const id = ++runId.current;
    setPhase("scanning");
    if (isTauri()) {
      const [h, p, s] = await Promise.all([
        runHealthCheck().catch(() => DEMO_HEALTH),
        checkPermissions().catch(() => DEMO_PERMS),
        runSystemScan().catch(() => null),
      ]);
      if (id !== runId.current) return; // cancelled / superseded
      setHealth(h);
      setPerms(p);
      setScan(s);
    } else {
      await new Promise((r) => setTimeout(r, 700));
      if (id !== runId.current) return;
      setHealth(DEMO_HEALTH);
      setPerms(DEMO_PERMS);
      setScan(null);
    }
    setPhase("done");
  }

  function cancelScan() {
    runId.current++; // invalidate the in-flight run
    setPhase(health ? "done" : "idle");
  }

  useEffect(() => { runScan(); /* eslint-disable-next-line */ }, []);

  async function doExport() {
    let md: string;
    try { md = isTauri() ? await exportDiagnostics() : "# Nexus Diagnostics (demo)\n"; }
    catch { md = "# Nexus Diagnostics\n(export failed)\n"; }
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "nexus-diagnostics.md"; a.click();
    URL.revokeObjectURL(url);
  }

  // Prefer the deep-scan score when available; else the health pass ratio.
  const score = scan?.score ?? (health ? Math.round((health.passed / Math.max(1, health.total)) * 100) : 0);
  const tone = score >= 85 ? "success" : score >= 60 ? "warning" : "danger";

  return (
    <div>
      <PageHeader
        title="System Doctor"
        description="Deep diagnostics across hardware, storage, drivers, services, security & power."
        actions={
          <>
            <Button variant="solid" size="md" onClick={doExport} disabled={phase !== "done"}>
              <Download className="h-4 w-4" /> Export
            </Button>
            {phase === "scanning" ? (
              <Button variant="ghost" size="md" onClick={cancelScan}>
                <XCircle className="h-4 w-4" /> Cancel
              </Button>
            ) : (
              <Button variant="primary" size="md" onClick={runScan}>
                <RotateCw className="h-4 w-4" /> Re-scan
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
        {/* Health score */}
        <GlassCard padding="lg" className="relative flex flex-col items-center justify-center overflow-hidden text-center">
          <div className="absolute -top-12 h-40 w-40 rounded-full bg-accent/15 blur-3xl" />
          <RingGauge value={phase === "scanning" ? 0 : score} size={180} thickness={14} tone={tone} label={phase === "scanning" ? "…" : `${score}`} sublabel={phase === "scanning" ? "Scanning" : "Health"} />
          <p className="mt-md text-sm text-content-muted">
            {phase === "scanning" ? "Running deep diagnostics…" : scan ? `${scan.categories.length} categories scanned` : health ? `${health.passed} of ${health.total} checks passed` : ""}
          </p>
        </GlassCard>

        {/* Core checks */}
        <div className="lg:col-span-2">
          <GlassCard padding="lg" className="h-full">
            <SectionTitle title="Core Diagnostics" description="Drivers, sensors & subsystems" action={<Badge variant={tone === "success" ? "success" : "warning"}><ScanLine className="h-3 w-3" /> {health?.total ?? 0} checks</Badge>} />
            <motion.div variants={stagger(0.03)} initial="hidden" animate="show" className="grid grid-cols-1 gap-2xs sm:grid-cols-2">
              {(health?.checks ?? []).map((c) => {
                const st = STATUS[c.status] ?? STATUS.ok;
                return (
                  <motion.div key={c.name} variants={fadeUp} className="flex items-center gap-sm rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
                    <st.icon className={cn("h-4 w-4 shrink-0", st.cls)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-content">{c.name}</p>
                      <p className="truncate text-2xs text-content-subtle">{c.detail}</p>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </GlassCard>
        </div>
      </div>

      {/* Deep scan categories */}
      {scan && (
        <div className="mt-md">
          <SectionTitle title="System Health Categories" description="Expand a category to see every finding" />
          <div className="grid grid-cols-1 gap-md md:grid-cols-2 xl:grid-cols-3">
            {scan.categories.map((c) => <CategoryCard key={c.id} cat={c} />)}
          </div>
        </div>
      )}

      {/* Storage analyzer */}
      {scan && <StorageAnalyzer analysis={scan.storage} onChanged={runScan} />}

      {/* Permissions */}
      <AnimatePresence>
        {perms && (
          <motion.div variants={fadeUp} initial="hidden" animate="show" className="mt-md">
            <GlassCard padding="lg">
              <SectionTitle title="Permissions" description="What Nexus can control right now" action={<ShieldCheck className="h-4 w-4 text-content-subtle" />} />
              <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
                <PermCard label="Power Profiles" ok={perms.powerControllable} />
                <PermCard label="RGB Lighting" ok={perms.rgbWritable} />
                <PermCard label="Fan Control" ok={perms.fanWritable} />
                <PermCard label="Control Group" ok={perms.inInputGroup} />
              </div>
              {!perms.inInputGroup && perms.remediation && (
                <div className="mt-md rounded-lg border border-warning/30 bg-warning/10 p-md">
                  <p className="flex items-center gap-xs text-sm font-medium text-warning"><AlertTriangle className="h-4 w-4" /> Unlock RGB & fan control</p>
                  <button onClick={() => navigator.clipboard?.writeText("sudo usermod -aG input $USER")} className="mt-xs flex w-full max-w-md items-center gap-xs rounded-md bg-surface-sunken px-sm py-xs text-left">
                    <Copy className="h-3.5 w-3.5 shrink-0 text-content-subtle" />
                    <code className="flex-1 truncate text-2xs text-content-muted">sudo usermod -aG input $USER</code>
                  </button>
                  <p className="mt-2xs text-2xs text-content-subtle">Then log out and back in. Telemetry & power profiles already work.</p>
                </div>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {phase === "idle" && (
        <GlassCard padding="lg" className="mt-md grid place-items-center py-2xl text-center">
          <Stethoscope className="h-8 w-8 text-accent" />
          <p className="mt-sm text-sm text-content-muted">Run a scan to check system health.</p>
        </GlassCard>
      )}
    </div>
  );
}

function CategoryCard({ cat }: { cat: ScanCategory }) {
  const [open, setOpen] = useState(cat.status === "critical" || cat.status === "warning");
  const [ignored, setIgnored] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{ title: string; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const st = STATUS[cat.status] ?? STATUS.ok;

  async function svc(unit: string, action: "logs" | "status", user: boolean, title: string) {
    setModal({ title, text: "Loading…" });
    if (!isTauri()) { setModal({ title, text: "(desktop app only)" }); return; }
    try { setModal({ title, text: await serviceAction(unit, action, user) }); }
    catch (e) { setModal({ title, text: String(e) }); }
  }
  async function restart(unit: string, user: boolean) {
    setBusy(unit);
    try {
      const msg = isTauri() ? await serviceAction(unit, "restart", user) : `Demo — would restart ${unit}.`;
      setModal({ title: `Restart · ${unit}`, text: msg });
    } catch (e) { setModal({ title: `Restart · ${unit}`, text: String(e) }); }
    finally { setBusy(null); }
  }

  return (
    <GlassCard padding="none" className="overflow-hidden">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-sm p-md text-left hover:bg-surface-raised/50">
        <st.icon className={cn("h-4 w-4 shrink-0", st.cls)} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-content">{cat.label}</p>
          <p className="truncate text-2xs text-content-subtle">{cat.summary}</p>
        </div>
        <Badge size="sm" variant={SEV_BADGE[cat.status]}>{cat.status}</Badge>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-content-subtle transition-transform", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-2xs border-t border-border-subtle p-sm">
              {cat.findings.filter((f) => !ignored.has(f.title)).map((f, i) => {
                const fst = STATUS[f.severity] ?? STATUS.ok;
                return (
                  <div key={i} className="flex items-start gap-sm rounded-md p-xs">
                    <fst.icon className={cn("mt-0.5 h-3.5 w-3.5 shrink-0", fst.cls)} />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-content">{f.title}</p>
                      <p className="text-2xs text-content-muted">{f.detail}</p>
                      {f.fix && (
                        <button onClick={() => navigator.clipboard?.writeText(f.fix)} className="mt-2xs flex items-center gap-xs text-2xs text-accent-strong hover:underline" title="Copy fix">
                          <Copy className="h-2.5 w-2.5" /> {f.fix}
                        </button>
                      )}
                      {/* Per-finding actions */}
                      {(f.kind === "service" && f.unit) || f.severity === "warning" || f.severity === "info" ? (
                        <div className="mt-xs flex flex-wrap gap-xs">
                          {f.kind === "service" && f.unit && (
                            <>
                              <FAction icon={FileText} label="Logs" onClick={() => svc(f.unit!, "logs", f.userScope, `Logs · ${f.unit}`)} />
                              <FAction icon={Info} label="Status" onClick={() => svc(f.unit!, "status", f.userScope, `Status · ${f.unit}`)} />
                              <FAction icon={RotateCw} label="Restart" onClick={() => restart(f.unit!, f.userScope)} busy={busy === f.unit} />
                            </>
                          )}
                          {(f.severity === "warning" || f.severity === "info") && (
                            <FAction icon={EyeOff} label="Ignore" onClick={() => setIgnored((s) => new Set(s).add(f.title))} />
                          )}
                        </div>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Logs / status output modal */}
      <AnimatePresence>
        {modal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-black/50 p-lg backdrop-blur-sm" onClick={() => setModal(null)}>
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-full max-w-3xl flex-col glass glass-strong rounded-2xl p-lg shadow-e4">
              <div className="mb-sm flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-content">{modal.title}</h3>
                <Button variant="ghost" size="icon" onClick={() => setModal(null)}><XCircle className="h-4 w-4" /></Button>
              </div>
              <pre className="flex-1 overflow-auto rounded-lg bg-surface-sunken p-md text-2xs leading-relaxed text-content-muted">{modal.text || "(no output)"}</pre>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}

function FAction({ icon: Icon, label, onClick, busy }: { icon: LucideIcon; label: string; onClick: () => void; busy?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} className="inline-flex items-center gap-xs rounded-md border border-border px-sm py-2xs text-2xs font-medium text-content-muted transition-colors hover:text-content disabled:opacity-50">
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Icon className="h-3 w-3" />} {label}
    </button>
  );
}

function StorageAnalyzer({ analysis, onChanged }: { analysis: SystemScan["storage"]; onChanged: () => void }) {
  const [tab, setTab] = useState<"files" | "folders">("files");
  const [status, setStatus] = useState<string | null>(null);
  const list = tab === "files" ? analysis.largestFiles : analysis.largestFolders;

  async function del(path: string) {
    if (!window.confirm(`Delete this file permanently?\n\n${path}`)) return;
    try { setStatus(await deleteFile(path)); onChanged(); }
    catch (e) { setStatus(String(e)); }
  }
  async function open(path: string) {
    try { setStatus(await revealFile(path)); }
    catch (e) { setStatus(String(e)); }
  }

  return (
    <div className="mt-md">
      <GlassCard padding="lg">
        <SectionTitle
          title="Storage Analyzer"
          description={`Largest items under ${analysis.home}`}
          action={
            <div className="flex rounded-md border border-border p-2xs">
              {(["files", "folders"] as const).map((t) => (
                <button key={t} onClick={() => setTab(t)} className={cn("rounded px-sm py-1 text-2xs font-medium capitalize transition-colors", tab === t ? "bg-accent/15 text-accent-strong" : "text-content-muted hover:text-content")}>{t}</button>
              ))}
            </div>
          }
        />
        {status && <p className="mb-sm rounded-md bg-surface-sunken/50 px-sm py-xs text-2xs text-content-muted">{status}</p>}
        {list.length === 0 ? (
          <EmptyState icon={HardDrive} title="Nothing large found" description="No oversized files or folders detected in your home directory." className="border-0" />
        ) : (
          <div className="space-y-2xs">
            {list.map((e: FileEntry) => (
              <div key={e.path} className="flex items-center gap-sm rounded-lg border border-border-subtle bg-surface-sunken/40 px-sm py-xs">
                <HardDrive className="h-4 w-4 shrink-0 text-content-subtle" />
                <code className="min-w-0 flex-1 truncate text-2xs text-content-muted" title={e.path}>{e.path.replace(analysis.home, "~")}</code>
                <span className="shrink-0 text-xs font-semibold tabular-nums text-content">{formatBytes(e.sizeBytes, 1)}</span>
                <button onClick={() => open(e.path)} className="shrink-0 rounded p-1 text-content-subtle hover:text-content" title="Open location"><FolderOpen className="h-3.5 w-3.5" /></button>
                {tab === "files" && (
                  <button onClick={() => del(e.path)} className="shrink-0 rounded p-1 text-content-subtle hover:text-danger" title="Delete file"><Trash2 className="h-3.5 w-3.5" /></button>
                )}
              </div>
            ))}
          </div>
        )}

        {analysis.recommendations.length > 0 && (
          <div className="mt-md">
            <p className="mb-xs flex items-center gap-xs text-xs font-semibold text-content"><Sparkles className="h-3.5 w-3.5 text-accent" /> Cleanup recommendations</p>
            <div className="space-y-2xs">
              {analysis.recommendations.map((r, i) => (
                <div key={i} className="flex items-start gap-sm rounded-md bg-surface-sunken/40 p-sm">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-content">{r.title}</p>
                    <p className="text-2xs text-content-muted">{r.detail}</p>
                    {r.fix && (
                      <button onClick={() => navigator.clipboard?.writeText(r.fix)} className="mt-2xs flex items-center gap-xs text-2xs text-accent-strong hover:underline">
                        <Copy className="h-2.5 w-2.5" /> {r.fix}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}

function PermCard({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={cn("flex items-center gap-sm rounded-lg border p-md", ok ? "border-success/30 bg-success/8" : "border-border bg-surface-sunken/40")}>
      <div className={cn("grid h-9 w-9 place-items-center rounded-md", ok ? "bg-success/15 text-success" : "bg-surface-raised text-content-subtle")}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
      </div>
      <div>
        <p className="text-sm font-medium text-content">{label}</p>
        <p className="text-2xs text-content-subtle">{ok ? "Available" : "Restricted"}</p>
      </div>
    </div>
  );
}
