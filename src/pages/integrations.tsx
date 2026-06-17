import { useState } from "react";
import { motion } from "framer-motion";
import {
  Gauge,
  MonitorPlay,
  Rocket,
  Palette,
  Fan,
  Cpu,
  Gamepad2,
  FlaskConical,
  Container,
  Package,
  Boxes,
  Monitor,
  Check,
  X,
  Copy,
  RefreshCw,
  Plug,
  Download,
  ExternalLink,
  Code,
  Sparkles,
  GitBranch,
  Bot,
  Loader2,
  AlertTriangle,
  PackagePlus,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section";
import { useIntegrations } from "@/hooks/use-integrations";
import { onIntegrationProgress } from "@/lib/ipc";
import type {
  Integration,
  IntegrationCategory,
  FlatpakHealth,
  InstallPhase,
} from "@/lib/integrations-types";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

const ICON: Record<string, LucideIcon> = {
  mangohud: Gauge,
  gamescope: MonitorPlay,
  gamemode: Rocket,
  openrgb: Palette,
  coolercontrol: Fan,
  lact: Cpu,
  steam: Gamepad2,
  lutris: Gamepad2,
  heroic: Gamepad2,
  bottles: FlaskConical,
  docker: Container,
  podman: Container,
  flatpak: Package,
  snap: Package,
  "nvidia-container-toolkit": Boxes,
  vscode: Code,
  cursor: Code,
  jetbrains: Code,
  git: GitBranch,
  ollama: Bot,
  lmstudio: Sparkles,
  "open-webui": Bot,
  "display-server": Monitor,
};

const CATEGORIES: { id: IntegrationCategory; label: string; icon: LucideIcon }[] = [
  { id: "gaming", label: "Gaming Tools", icon: Rocket },
  { id: "hardware", label: "Hardware Control", icon: Cpu },
  { id: "launchers", label: "Game Launchers", icon: Gamepad2 },
  { id: "containers", label: "Containers & Packaging", icon: Boxes },
  { id: "development", label: "Development", icon: Code },
  { id: "ai", label: "Local AI", icon: Sparkles },
  { id: "system", label: "System", icon: Monitor },
];

export default function IntegrationsPage() {
  const { items, health, loading, refresh, install, addFlathub } = useIntegrations();
  const detected = items.filter((i) => i.detected).length;

  return (
    <div>
      <PageHeader
        title="System Integrations"
        description="What Nexus has discovered about your Linux ecosystem."
        actions={
          <>
            <Badge variant="accent" size="md">
              <Plug className="h-3.5 w-3.5" /> {detected} / {items.length} detected
            </Badge>
            <Button variant="solid" size="md" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Rescan
            </Button>
          </>
        }
      />

      <FlatpakBanner health={health} addFlathub={addFlathub} />

      <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="space-y-lg">
        {CATEGORIES.map((cat) => {
          const group = items.filter((i) => i.category === cat.id);
          if (!group.length) return null;
          const found = group.filter((i) => i.detected).length;
          return (
            <motion.section key={cat.id} variants={fadeUp}>
              <SectionTitle
                title={cat.label}
                description={`${found} of ${group.length} available`}
                action={<cat.icon className="h-4 w-4 text-content-subtle" />}
              />
              <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
                {group.map((it) => (
                  <IntegrationCard key={it.id} item={it} health={health} install={install} />
                ))}
              </div>
            </motion.section>
          );
        })}
      </motion.div>
    </div>
  );
}

/* ----- Flatpak readiness banner ----- */

function FlatpakBanner({ health, addFlathub }: { health: FlatpakHealth; addFlathub: () => Promise<string> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Everything's ready → no banner.
  if (health.flatpakInstalled && health.flathubRemote) return null;
  const needsFlatpak = !health.flatpakInstalled;

  async function add() {
    setBusy(true);
    setMsg(null);
    try { setMsg(await addFlathub()); }
    catch (e) { setMsg(String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="mb-lg rounded-lg border border-warning/30 bg-warning/10 p-md">
      <div className="flex items-start gap-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          {needsFlatpak ? (
            <>
              <p className="text-sm font-medium text-content">Flatpak isn’t installed</p>
              <p className="mt-2xs text-2xs text-content-muted">One-click installs need Flatpak. Install it, then rescan:</p>
              <button
                onClick={() => navigator.clipboard?.writeText("sudo pacman -S flatpak")}
                className="mt-xs flex w-full max-w-sm items-center gap-xs rounded-md bg-surface-sunken px-sm py-xs text-left"
                title="Copy command"
              >
                <Copy className="h-3 w-3 shrink-0 text-content-subtle" />
                <code className="flex-1 truncate text-2xs text-content-muted">sudo pacman -S flatpak</code>
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-content">Flathub repository not set up</p>
              <p className="mt-2xs text-2xs text-content-muted">Flatpak is installed but the Flathub remote is missing — add it to enable one-click installs.</p>
              <Button variant="primary" size="sm" className="mt-sm" disabled={busy} onClick={add}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackagePlus className="h-3.5 w-3.5" />}
                Add Flathub
              </Button>
            </>
          )}
          {msg && <p className="mt-xs text-2xs text-content-muted">{msg}</p>}
        </div>
      </div>
    </div>
  );
}

/* ----- Per-integration status ----- */

type IntStatus = "installed" | "available" | "missing-repo" | "needs-flatpak" | "manual";

/** Only states we can actually determine — nothing is faked. */
function statusOf(it: Integration, health: FlatpakHealth): IntStatus {
  if (it.detected) return "installed";
  if (it.flatpakId) {
    if (!health.flatpakInstalled) return "needs-flatpak";
    if (!health.flathubRemote) return "missing-repo";
    return "available";
  }
  return "manual";
}

const STATUS_META: Record<IntStatus, { label: string; cls: string; icon: LucideIcon }> = {
  installed: { label: "Installed", cls: "text-success", icon: Check },
  available: { label: "Available", cls: "text-accent-strong", icon: Download },
  "missing-repo": { label: "Needs Flathub", cls: "text-warning", icon: AlertTriangle },
  "needs-flatpak": { label: "Needs Flatpak", cls: "text-warning", icon: AlertTriangle },
  manual: { label: "Manual install", cls: "text-content-subtle", icon: X },
};

const PHASE_LABEL: Record<InstallPhase, string> = {
  queued: "Queued…",
  preparing: "Preparing…",
  installing: "Downloading & installing…",
  verifying: "Verifying…",
  installed: "Installed",
  failed: "Failed",
};
const ACTIVE_PHASES: InstallPhase[] = ["queued", "preparing", "installing", "verifying"];

/** Slim indeterminate bar — flatpak gives no reliable % in non-interactive mode,
 *  so we honestly show motion + the real current step rather than a fake %. */
function IndeterminateBar() {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
      <motion.div
        className="h-full w-1/3 rounded-full bg-accent"
        animate={{ x: ["-110%", "330%"] }}
        transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

function IntegrationCard({ item, health, install }: { item: Integration; health: FlatpakHealth; install: (i: Integration) => Promise<string> }) {
  const Icon = ICON[item.id] ?? Package;
  const [phase, setPhase] = useState<InstallPhase | null>(null);
  const [version, setVersion] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const status = statusOf(item, health);
  const meta = STATUS_META[status];
  // Install is offered whenever there's a flatpak path and flatpak itself is
  // present — a missing Flathub remote is self-healed by the backend.
  const canInstall = status === "available" || status === "missing-repo";
  const installing = phase !== null && ACTIVE_PHASES.includes(phase);

  async function doInstall() {
    setPhase("queued");
    setError(null);
    setVersion(null);
    setElapsed(0);
    const started = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    // Attach the progress listener BEFORE invoking so no phase event is missed.
    const unlisten = await onIntegrationProgress((p) => {
      if (p.flatpakId !== item.flatpakId) return;
      setPhase(p.phase);
      if (p.version) setVersion(p.version);
    });
    try {
      const text = await install(item);
      setPhase("installed");
      const m = text.match(/v([0-9][\w.\-]*)/);
      if (m) setVersion((v) => v ?? m[1]);
    } catch (e) {
      setPhase("failed");
      setError(String(e));
    } finally {
      window.clearInterval(timer);
      unlisten();
    }
  }

  return (
    <GlassCard
      interactive
      padding="md"
      className={cn("flex items-start gap-md", !item.detected && "opacity-95")}
    >
      <div
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-lg",
          item.detected ? "bg-accent/12 text-accent-strong" : "bg-surface-raised text-content-subtle",
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-sm">
          <p className="truncate text-sm font-semibold text-content">{item.name}</p>
          <span className={cn("flex shrink-0 items-center gap-xs text-2xs font-medium", meta.cls)}>
            <meta.icon className="h-3.5 w-3.5" /> {meta.label}
          </span>
        </div>

        {item.detected ? (
          <p className="mt-2xs truncate text-2xs text-content-muted">{item.detail || "Detected"}</p>
        ) : (
          <div className="mt-xs space-y-xs">
            {installing ? (
              /* Live install state machine */
              <div className="space-y-2xs">
                <div className="flex items-center justify-between text-2xs">
                  <span className="font-medium text-content">{PHASE_LABEL[phase!]}</span>
                  <span className="tabular-nums text-content-subtle">{elapsed}s</span>
                </div>
                <IndeterminateBar />
                {phase === "installing" && (
                  <p className="text-2xs text-content-subtle">Fetching runtime + app from Flathub — this can take a few minutes.</p>
                )}
              </div>
            ) : phase === "installed" ? (
              <p className="flex items-center gap-xs text-2xs font-medium text-success">
                <Check className="h-3.5 w-3.5" /> Installed{version ? ` · v${version}` : ""}
              </p>
            ) : (
              <>
                {item.hint && (
                  <button
                    onClick={() => navigator.clipboard?.writeText(item.hint)}
                    className="group flex w-full items-center gap-xs rounded-md bg-surface-sunken/60 px-xs py-2xs text-left"
                    title="Copy install command"
                  >
                    <code className="min-w-0 flex-1 truncate text-2xs text-content-subtle">{item.hint}</code>
                    <Copy className="h-3 w-3 shrink-0 text-content-subtle transition-colors group-hover:text-content" />
                  </button>
                )}
                <div className="flex items-center gap-xs">
                  {item.flatpakId && canInstall && (
                    <Button variant="primary" size="sm" onClick={doInstall}>
                      <Download className="h-3.5 w-3.5" />
                      {phase === "failed" ? "Retry" : "Install"}
                    </Button>
                  )}
                  {item.docUrl && (
                    <a
                      href={item.docUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-xs rounded-md border border-border px-sm py-1 text-2xs font-medium text-content-muted transition-colors hover:text-content"
                    >
                      <ExternalLink className="h-3 w-3" /> Docs
                    </a>
                  )}
                </div>
                {status === "missing-repo" && phase !== "failed" && (
                  <p className="text-2xs text-content-subtle">Installing adds the Flathub repository automatically.</p>
                )}
                {phase === "failed" && error && (
                  <p className="text-2xs text-danger">{error}</p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </GlassCard>
  );
}
