import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  RefreshCw,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Play,
  Square,
  RotateCw,
  Power,
  Lock,
  Unlock,
  FileText,
  Trash2,
  Search,
  Package,
  Boxes,
  Container,
  ServerCog,
  ArrowUpCircle,
  Download,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import {
  isTauri,
  hubListServices,
  hubServiceControl,
  hubDockerOverview,
  hubDockerAction,
  hubFlatpakOverview,
  hubFlatpakAction,
  hubUpdateCounts,
  hubUpdateRun,
} from "@/lib/ipc";
import type {
  ServiceUnit,
  ServiceActionKind,
  DockerOverview,
  FlatpakOverview,
  UpdateCounts,
} from "@/lib/linux-hub-types";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

type Tab = "updates" | "services" | "docker" | "flatpak";
type Status = { kind: "ok" | "error"; msg: string } | null;

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "updates", label: "Update Center", icon: ArrowUpCircle },
  { id: "services", label: "Services", icon: ServerCog },
  { id: "docker", label: "Docker", icon: Container },
  { id: "flatpak", label: "Flatpak", icon: Boxes },
];

export default function LinuxHubPage() {
  const [tab, setTab] = useState<Tab>("updates");
  const [status, setStatus] = useState<Status>(null);
  const [output, setOutput] = useState<{ title: string; text: string } | null>(null);

  useEffect(() => { if (!status) return; const t = setTimeout(() => setStatus(null), 4500); return () => clearTimeout(t); }, [status]);

  const ctx = { setStatus, setOutput };

  return (
    <div>
      <PageHeader title="Linux Hub" description="System control center — services, containers, packages & updates." />

      {status && (
        <div className={cn("mb-md flex items-center gap-sm rounded-lg border p-sm text-sm", status.kind === "error" ? "border-danger/30 bg-danger/10 text-danger" : "border-success/30 bg-success/10 text-success")}>
          {status.kind === "error" ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
          <span className="min-w-0 flex-1">{status.msg}</span>
        </div>
      )}

      <div className="mb-md flex gap-2xs rounded-lg border border-border bg-surface-sunken/40 p-2xs">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} className={cn("flex flex-1 items-center justify-center gap-xs rounded-md px-sm py-xs text-sm font-medium transition-colors", tab === t.id ? "bg-accent/15 text-accent-strong" : "text-content-muted hover:text-content")}>
            <t.icon className="h-4 w-4" /> {t.label}
          </button>
        ))}
      </div>

      {tab === "updates" && <UpdatesTab {...ctx} />}
      {tab === "services" && <ServicesTab {...ctx} />}
      {tab === "docker" && <DockerTab {...ctx} />}
      {tab === "flatpak" && <FlatpakTab {...ctx} />}

      {/* Output modal (logs / status) */}
      <AnimatePresence>
        {output && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-black/50 p-lg backdrop-blur-sm" onClick={() => setOutput(null)}>
            <motion.div initial={{ y: 20, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 20, opacity: 0 }} onClick={(e) => e.stopPropagation()} className="flex max-h-[80vh] w-full max-w-3xl flex-col glass glass-strong rounded-2xl p-lg shadow-e4">
              <div className="mb-sm flex items-center justify-between">
                <h3 className="font-display text-lg font-semibold text-content">{output.title}</h3>
                <Button variant="ghost" size="icon" onClick={() => setOutput(null)}><XCircle className="h-4 w-4" /></Button>
              </div>
              <pre className="flex-1 overflow-auto rounded-lg bg-surface-sunken p-md text-2xs leading-relaxed text-content-muted">{output.text || "(no output)"}</pre>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

type Ctx = { setStatus: (s: Status) => void; setOutput: (o: { title: string; text: string } | null) => void };

/* ------------------------------ Update Center ---------------------------- */

function UpdatesTab({ setStatus }: Ctx) {
  const [counts, setCounts] = useState<UpdateCounts | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isTauri()) { setCounts({ pacman: 151, aur: 1, flatpak: 2, aurHelper: "paru", pacmanSupported: true, flatpakSupported: true }); return; }
    try { setCounts(await hubUpdateCounts()); } catch { setCounts(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function run(target: string, label: string) {
    setBusy(target);
    try { const msg = isTauri() ? await hubUpdateRun(target) : `Demo — would update ${label}.`; setStatus({ kind: "ok", msg }); await load(); }
    catch (e) { setStatus({ kind: "error", msg: String(e) }); }
    finally { setBusy(null); }
  }

  const total = (counts?.pacman ?? 0) + (counts?.aur ?? 0) + (counts?.flatpak ?? 0);
  const cards = [
    { id: "pacman", label: "Official (pacman)", count: counts?.pacman ?? 0, supported: counts?.pacmanSupported, runnable: true },
    { id: "aur", label: `AUR${counts?.aurHelper ? ` (${counts.aurHelper})` : ""}`, count: counts?.aur ?? 0, supported: !!counts?.aurHelper, runnable: false },
    { id: "flatpak", label: "Flatpak", count: counts?.flatpak ?? 0, supported: counts?.flatpakSupported, runnable: true },
  ];

  return (
    <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="space-y-md">
      <motion.div variants={fadeUp}>
        <GlassCard padding="lg" className="flex items-center justify-between">
          <div>
            <p className="text-sm text-content-muted">Available updates</p>
            <p className="font-display text-4xl font-semibold text-content">{counts === null ? "…" : total}</p>
          </div>
          <Button variant="primary" size="md" disabled={!counts?.pacmanSupported || busy != null} onClick={() => run("pacman", "system packages")}>
            {busy === "pacman" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Update System
          </Button>
        </GlassCard>
      </motion.div>

      <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
        {cards.map((c) => (
          <motion.div key={c.id} variants={fadeUp}>
            <GlassCard padding="lg" className="h-full">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-xs text-sm font-medium text-content"><Package className="h-4 w-4 text-content-muted" /> {c.label}</span>
                <Badge variant={c.count > 0 ? "warning" : "success"}>{c.count}</Badge>
              </div>
              {!c.supported ? (
                <p className="mt-md text-2xs text-content-subtle">Not available on this system.</p>
              ) : c.runnable ? (
                <Button variant="solid" size="sm" className="mt-md" disabled={c.count === 0 || busy != null} onClick={() => run(c.id, c.label)}>
                  {busy === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUpCircle className="h-3.5 w-3.5" />} Update
                </Button>
              ) : (
                <p className="mt-md text-2xs text-content-subtle">Run <code>{counts?.aurHelper} -Sua</code> in a terminal (interactive build).</p>
              )}
            </GlassCard>
          </motion.div>
        ))}
      </div>
      <p className="text-2xs text-content-subtle">pacman updates require authorization (polkit). AUR builds are interactive and run in your terminal.</p>
    </motion.div>
  );
}

/* ------------------------------- Services -------------------------------- */

const ACTIVE_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = {
  active: "success", failed: "danger", activating: "warning", deactivating: "warning",
};

function ServicesTab({ setStatus, setOutput }: Ctx) {
  const [user, setUser] = useState(false);
  const [units, setUnits] = useState<ServiceUnit[] | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "failed" | "disabled">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const runId = useRef(0);

  const load = useCallback(async () => {
    const id = ++runId.current;
    setUnits(null);
    if (!isTauri()) { setUnits([{ name: "docker.service", description: "Docker Application Container Engine", load: "loaded", active: "active", sub: "running", enabled: "enabled", user: false }, { name: "bluetooth.service", description: "Bluetooth", load: "loaded", active: "failed", sub: "failed", enabled: "enabled", user: false }]); return; }
    try { const u = await hubListServices(user); if (id === runId.current) setUnits(u); }
    catch (e) { if (id === runId.current) { setStatus({ kind: "error", msg: String(e) }); setUnits([]); } }
  }, [user, setStatus]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return (units ?? []).filter((u) =>
      (filter === "all" || (filter === "active" && u.active === "active") || (filter === "failed" && u.active === "failed") || (filter === "disabled" && u.enabled === "disabled"))
      && (!q || u.name.toLowerCase().includes(q) || u.description.toLowerCase().includes(q)));
  }, [units, query, filter]);

  async function act(u: ServiceUnit, action: ServiceActionKind) {
    if (action === "logs" || action === "status") {
      setOutput({ title: `${action} · ${u.name}`, text: "Loading…" });
      try { setOutput({ title: `${action} · ${u.name}`, text: isTauri() ? await hubServiceControl(u.name, action, u.user) : "(desktop only)" }); }
      catch (e) { setOutput({ title: `${action} · ${u.name}`, text: String(e) }); }
      return;
    }
    setBusy(u.name + action);
    try { const msg = isTauri() ? await hubServiceControl(u.name, action, u.user) : `Demo — would ${action} ${u.name}.`; setStatus({ kind: "ok", msg }); await load(); }
    catch (e) { setStatus({ kind: "error", msg: String(e) }); }
    finally { setBusy(null); }
  }

  const counts = useMemo(() => ({
    active: (units ?? []).filter((u) => u.active === "active").length,
    failed: (units ?? []).filter((u) => u.active === "failed").length,
  }), [units]);

  return (
    <GlassCard padding="lg">
      <div className="mb-md flex flex-wrap items-center gap-sm">
        <div className="flex rounded-md border border-border p-2xs">
          {(["system", "user"] as const).map((s) => (
            <button key={s} onClick={() => setUser(s === "user")} className={cn("rounded px-sm py-xs text-xs font-medium capitalize transition-colors", (user ? "user" : "system") === s ? "bg-accent/15 text-accent-strong" : "text-content-muted hover:text-content")}>{s}</button>
          ))}
        </div>
        <div className="flex h-9 flex-1 items-center gap-sm rounded-md border border-border bg-surface-sunken/60 px-sm">
          <Search className="h-4 w-4 text-content-subtle" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter services…" className="flex-1 bg-transparent text-sm text-content outline-none placeholder:text-content-subtle" />
        </div>
        <div className="flex rounded-md border border-border p-2xs">
          {(["all", "active", "failed", "disabled"] as const).map((fl) => (
            <button key={fl} onClick={() => setFilter(fl)} className={cn("rounded px-sm py-xs text-xs font-medium capitalize transition-colors", filter === fl ? "bg-accent/15 text-accent-strong" : "text-content-muted hover:text-content")}>{fl}</button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>

      <div className="mb-sm flex gap-md text-2xs text-content-subtle">
        <span><span className="text-success">●</span> {counts.active} active</span>
        <span><span className="text-danger">●</span> {counts.failed} failed</span>
        <span>{filtered.length} shown</span>
      </div>

      {units === null ? (
        <div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={ServerCog} title="No services" description="No units match the current filter." className="border-0" />
      ) : (
        <div className="max-h-[55vh] space-y-2xs overflow-auto">
          {filtered.map((u) => (
            <div key={u.name} className="flex items-center gap-sm rounded-lg border border-border-subtle bg-surface-sunken/40 p-sm">
              <span className={cn("h-2 w-2 shrink-0 rounded-full", u.active === "active" ? "bg-success" : u.active === "failed" ? "bg-danger" : "bg-content-subtle")} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-content">{u.name.replace(".service", "")}</p>
                <p className="truncate text-2xs text-content-subtle">{u.description || u.sub}</p>
              </div>
              <Badge size="sm" variant={ACTIVE_TONE[u.active] ?? "neutral"}>{u.active}</Badge>
              {u.enabled && <Badge size="sm" variant={u.enabled === "enabled" ? "success" : "neutral"}>{u.enabled}</Badge>}
              <div className="flex shrink-0 items-center gap-2xs">
                {u.active === "active"
                  ? <SAct icon={Square} title="Stop" busy={busy === u.name + "stop"} onClick={() => act(u, "stop")} />
                  : <SAct icon={Play} title="Start" busy={busy === u.name + "start"} onClick={() => act(u, "start")} />}
                <SAct icon={RotateCw} title="Restart" busy={busy === u.name + "restart"} onClick={() => act(u, "restart")} />
                {u.enabled === "enabled"
                  ? <SAct icon={Power} title="Disable" busy={busy === u.name + "disable"} onClick={() => act(u, "disable")} />
                  : <SAct icon={Power} title="Enable" busy={busy === u.name + "enable"} onClick={() => act(u, "enable")} />}
                {u.enabled === "masked"
                  ? <SAct icon={Unlock} title="Unmask" busy={busy === u.name + "unmask"} onClick={() => act(u, "unmask")} />
                  : <SAct icon={Lock} title="Mask" busy={busy === u.name + "mask"} onClick={() => act(u, "mask")} />}
                <SAct icon={FileText} title="Logs" onClick={() => act(u, "logs")} />
              </div>
            </div>
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function SAct({ icon: Icon, title, onClick, busy }: { icon: LucideIcon; title: string; onClick: () => void; busy?: boolean }) {
  return <button title={title} disabled={busy} onClick={onClick} className="rounded p-1 text-content-subtle hover:text-content disabled:opacity-50">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}</button>;
}

/* -------------------------------- Docker --------------------------------- */

function DockerTab({ setStatus, setOutput }: Ctx) {
  const [data, setData] = useState<DockerOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isTauri()) { setData({ available: true, running: true, containers: [{ id: "abc123", name: "nginx", image: "nginx:latest", state: "running", status: "Up 2 hours" }], images: [{ id: "i1", repo: "nginx", tag: "latest", size: "187MB" }], volumes: [{ name: "data", driver: "local" }] }); return; }
    try { setData(await hubDockerOverview()); } catch { setData(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(kind: string, id: string, action: string, label: string) {
    if (action === "logs") { setOutput({ title: `Logs · ${label}`, text: "Loading…" }); try { setOutput({ title: `Logs · ${label}`, text: isTauri() ? await hubDockerAction(kind, id, "logs") : "(desktop only)" }); } catch (e) { setOutput({ title: `Logs · ${label}`, text: String(e) }); } return; }
    setBusy(id + action);
    try { const msg = isTauri() ? await hubDockerAction(kind, id, action) : `Demo — would ${action} ${label}.`; setStatus({ kind: "ok", msg }); await load(); }
    catch (e) { setStatus({ kind: "error", msg: String(e) }); }
    finally { setBusy(null); }
  }

  if (data && !data.available) return <GlassCard padding="lg"><EmptyState icon={Container} title="Docker not installed" description="Install Docker to manage containers from Nexus." className="border-0" /></GlassCard>;
  if (data && !data.running) return <GlassCard padding="lg"><EmptyState icon={Container} title="Docker daemon not running" description="Start it: sudo systemctl start docker" className="border-0" /></GlassCard>;

  return (
    <div className="space-y-md">
      <div className="flex justify-end"><Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button></div>
      {data === null ? (
        <GlassCard padding="lg"><div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div></GlassCard>
      ) : (
        <>
          <GlassCard padding="lg">
            <p className="mb-md flex items-center gap-xs text-sm font-semibold text-content"><Container className="h-4 w-4 text-info" /> Containers <Badge size="sm" variant="neutral">{data.containers.length}</Badge></p>
            {data.containers.length === 0 ? <p className="text-sm text-content-subtle">No containers.</p> : (
              <div className="space-y-2xs">
                {data.containers.map((c) => (
                  <div key={c.id} className="flex items-center gap-sm rounded-lg border border-border-subtle bg-surface-sunken/40 p-sm">
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", c.state === "running" ? "bg-success" : "bg-content-subtle")} />
                    <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-content">{c.name}</p><p className="truncate text-2xs text-content-subtle">{c.image} · {c.status}</p></div>
                    <div className="flex shrink-0 gap-2xs">
                      {c.state === "running" ? <SAct icon={Square} title="Stop" busy={busy === c.id + "stop"} onClick={() => act("container", c.id, "stop", c.name)} /> : <SAct icon={Play} title="Start" busy={busy === c.id + "start"} onClick={() => act("container", c.id, "start", c.name)} />}
                      <SAct icon={RotateCw} title="Restart" busy={busy === c.id + "restart"} onClick={() => act("container", c.id, "restart", c.name)} />
                      <SAct icon={FileText} title="Logs" onClick={() => act("container", c.id, "logs", c.name)} />
                      <SAct icon={Trash2} title="Remove" busy={busy === c.id + "remove"} onClick={() => act("container", c.id, "remove", c.name)} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>

          <div className="grid grid-cols-1 gap-md lg:grid-cols-2">
            <GlassCard padding="lg">
              <p className="mb-md flex items-center gap-xs text-sm font-semibold text-content"><Boxes className="h-4 w-4 text-accent" /> Images <Badge size="sm" variant="neutral">{data.images.length}</Badge></p>
              <div className="max-h-64 space-y-2xs overflow-auto">
                {data.images.map((im) => (
                  <div key={im.id} className="flex items-center gap-sm rounded-md border border-border-subtle bg-surface-sunken/40 p-sm">
                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-content">{im.repo}:{im.tag}</p><p className="text-2xs text-content-subtle">{im.size}</p></div>
                    <SAct icon={Trash2} title="Remove" busy={busy === im.id + "remove"} onClick={() => act("image", im.id, "remove", `${im.repo}:${im.tag}`)} />
                  </div>
                ))}
                {data.images.length === 0 && <p className="text-sm text-content-subtle">No images.</p>}
              </div>
            </GlassCard>
            <GlassCard padding="lg">
              <p className="mb-md flex items-center gap-xs text-sm font-semibold text-content"><Package className="h-4 w-4 text-success" /> Volumes <Badge size="sm" variant="neutral">{data.volumes.length}</Badge></p>
              <div className="max-h-64 space-y-2xs overflow-auto">
                {data.volumes.map((v) => (
                  <div key={v.name} className="flex items-center gap-sm rounded-md border border-border-subtle bg-surface-sunken/40 p-sm">
                    <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-content">{v.name}</p><p className="text-2xs text-content-subtle">{v.driver}</p></div>
                    <SAct icon={Trash2} title="Remove" busy={busy === v.name + "remove"} onClick={() => act("volume", v.name, "remove", v.name)} />
                  </div>
                ))}
                {data.volumes.length === 0 && <p className="text-sm text-content-subtle">No volumes.</p>}
              </div>
            </GlassCard>
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------- Flatpak -------------------------------- */

function FlatpakTab({ setStatus }: Ctx) {
  const [data, setData] = useState<FlatpakOverview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isTauri()) { setData({ available: true, apps: [{ id: "com.usebottles.bottles", name: "Bottles", version: "51.0", size: "412 MB", hasUpdate: true }], runtimes: 4, unusedRuntimes: [], updates: 1 }); return; }
    try { setData(await hubFlatpakOverview()); } catch { setData(null); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function act(id: string, action: string, label: string) {
    setBusy(id + action);
    try { const msg = isTauri() ? await hubFlatpakAction(id, action) : `Demo — would ${action} ${label}.`; setStatus({ kind: "ok", msg }); await load(); }
    catch (e) { setStatus({ kind: "error", msg: String(e) }); }
    finally { setBusy(null); }
  }

  if (data && !data.available) return <GlassCard padding="lg"><EmptyState icon={Boxes} title="Flatpak not installed" description="Install flatpak to manage apps from Nexus." className="border-0" /></GlassCard>;

  return (
    <GlassCard padding="lg">
      <div className="mb-md flex items-center justify-between">
        <p className="flex items-center gap-xs text-sm font-semibold text-content"><Boxes className="h-4 w-4 text-accent" /> Flatpak Apps {data && <Badge size="sm" variant="neutral">{data.apps.length}</Badge>} {data && data.updates > 0 && <Badge size="sm" variant="warning">{data.updates} updates</Badge>}</p>
        <div className="flex gap-xs">
          <Button variant="ghost" size="sm" disabled={busy != null} onClick={() => act("", "clean", "unused runtimes")}><Trash2 className="h-3.5 w-3.5" /> Clean unused</Button>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
        </div>
      </div>
      {data === null ? (
        <div className="grid h-40 place-items-center"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>
      ) : data.apps.length === 0 ? (
        <EmptyState icon={Boxes} title="No Flatpak apps" description="No user Flatpak applications are installed." className="border-0" />
      ) : (
        <div className="space-y-2xs">
          {data.apps.map((a) => (
            <div key={a.id} className="flex items-center gap-sm rounded-lg border border-border-subtle bg-surface-sunken/40 p-sm">
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-content">{a.name || a.id}</p><p className="truncate text-2xs text-content-subtle">{a.id} · {a.version} · {a.size}</p></div>
              {a.hasUpdate && <Badge size="sm" variant="warning">update</Badge>}
              {a.hasUpdate && <SAct icon={ArrowUpCircle} title="Update" busy={busy === a.id + "update"} onClick={() => act(a.id, "update", a.name)} />}
              <SAct icon={Trash2} title="Remove" busy={busy === a.id + "remove"} onClick={() => act(a.id, "remove", a.name)} />
            </div>
          ))}
        </div>
      )}
      <p className="mt-md text-2xs text-content-subtle">{data?.runtimes ?? 0} runtime(s) installed. Flatpak operations run at the user level (no elevation).</p>
    </GlassCard>
  );
}
