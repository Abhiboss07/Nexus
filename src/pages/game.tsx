import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Play,
  Settings2,
  Gamepad2,
  Rocket,
  Cpu,
  Palette,
  Fan,
  Terminal,
  Copy,
  Save,
  Check,
  X,
  Gauge,
  MonitorPlay,
  Download,
  Plus,
  Pencil,
  Trash2,
  FolderOpen,
  FileCog,
  Image as ImageIcon,
  Loader2,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Segmented } from "@/components/ui/segmented";
import { SectionTitle } from "@/components/ui/section";
import { EmptyState } from "@/components/ui/states";
import { useGames } from "@/hooks/use-games";
import { useTelemetrySource } from "@/hooks/use-telemetry";
import {
  isTauri,
  getGameProfile,
  saveGameProfile,
  applyGameProfile,
  gameLaunchInfo,
  mangohudApply,
  addManualGame,
  updateManualGame,
  deleteManualGame,
  launchManualGame,
  pickPath,
} from "@/lib/ipc";
import type { Game, GameProfile, ManualGame } from "@/lib/games-types";
import { stagger, fadeUp } from "@/lib/motion";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/cn";

const GRADIENTS = ["from-yellow-400 to-fuchsia-600", "from-amber-500 to-orange-700", "from-cyan-400 to-blue-700", "from-rose-500 to-red-800", "from-green-400 to-emerald-700", "from-indigo-400 to-purple-700"];
const grad = (id: string) => GRADIENTS[Math.abs([...id].reduce((a, c) => a + c.charCodeAt(0), 0)) % GRADIENTS.length];

function emptyProfile(id: string): GameProfile {
  return { gameId: id, rgb: null, power: null, fan: null, launchCommand: null, envVars: [], usePrime: false, useGamemode: true, useMangohud: false, priority: null, closeApps: [], clearCache: false, autoApply: false, matchProcess: null };
}

/** Best-guess process name to watch for, from the game's name (user-editable). */
function defaultMatch(game: Game): string {
  return (game.name.split(/\s+/)[0] ?? game.name).toLowerCase().replace(/[^a-z0-9]/g, "");
}

type Status = { kind: "ok" | "error"; msg: string } | null;

export default function GamePage() {
  const { games, manualGames, launchers, mangohud, refreshManual } = useGames();
  const source = useTelemetrySource();
  const live = source === "live";
  const [selected, setSelected] = useState<Game | null>(null);
  const [editing, setEditing] = useState<ManualGame | "new" | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const total = games.length + manualGames.length;

  useEffect(() => {
    if (!status) return;
    const t = setTimeout(() => setStatus(null), 4000);
    return () => clearTimeout(t);
  }, [status]);

  async function launchManual(g: ManualGame) {
    if (!isTauri()) { setStatus({ kind: "ok", msg: `Demo — would launch ${g.title}.` }); return; }
    try { setStatus({ kind: "ok", msg: await launchManualGame(g.id) }); }
    catch (e) { setStatus({ kind: "error", msg: String(e) }); }
  }

  async function removeManual(g: ManualGame) {
    if (!window.confirm(`Remove "${g.title}" from your library? (The game files are not touched.)`)) return;
    if (isTauri()) { try { await deleteManualGame(g.id); } catch (e) { setStatus({ kind: "error", msg: String(e) }); return; } }
    await refreshManual();
    setStatus({ kind: "ok", msg: `Removed ${g.title}.` });
  }

  return (
    <div>
      <PageHeader
        title="Game Center"
        description="Your library, optimized — per-game profiles, overlay & boost."
        actions={
          <>
            <Badge variant="accent" size="md"><Rocket className="h-3.5 w-3.5" /> {total} games</Badge>
            <Button variant="primary" size="md" onClick={() => setEditing("new")}>
              <Plus className="h-4 w-4" /> Add Game
            </Button>
          </>
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

      {/* Launcher status */}
      <motion.div variants={fadeUp} initial="hidden" animate="show" className="mb-lg flex flex-wrap gap-xs">
        {launchers && Object.entries({
          Steam: launchers.steam, Lutris: launchers.lutris, Heroic: launchers.heroic,
          GameMode: launchers.gamemode, Gamescope: launchers.gamescope, MangoHud: launchers.mangohud, "PRIME": launchers.primeRun,
        }).map(([name, on]) => (
          <span key={name} className={cn("inline-flex items-center gap-xs rounded-full border px-sm py-2xs text-xs font-medium", on ? "border-success/30 bg-success/10 text-success" : "border-border bg-surface-raised text-content-subtle")}>
            {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />} {name}
          </span>
        ))}
      </motion.div>

      <div className="grid grid-cols-1 gap-lg xl:grid-cols-[1fr_360px]">
        {/* Library */}
        <div>
          <SectionTitle title="Library" description="Scanned from Steam & Lutris, plus games you add" />
          {total === 0 ? (
            <EmptyState icon={Gamepad2} title="No games yet" description="Steam & Lutris games appear automatically. Use “Add Game” to add a native executable or import from a launcher." />
          ) : (
            <motion.div variants={stagger(0.04)} initial="hidden" animate="show" className="grid grid-cols-2 gap-md sm:grid-cols-3 lg:grid-cols-4">
              {manualGames.map((g) => (
                <motion.div key={g.id} variants={fadeUp}>
                  <ManualCard game={g} onLaunch={() => launchManual(g)} onEdit={() => setEditing(g)} onDelete={() => removeManual(g)} />
                </motion.div>
              ))}
              {games.map((g) => (
                <motion.div key={g.id} variants={fadeUp}>
                  <GlassCard interactive glow padding="none" className="group overflow-hidden">
                    <div className={cn("relative aspect-[3/4] bg-gradient-to-br", grad(g.id))}>
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                      <span className="absolute left-2 top-2"><Badge size="sm" variant="neutral">{g.source}</Badge></span>
                      <span className="absolute bottom-2 left-2 text-3xl font-bold text-white/90 drop-shadow">
                        {g.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                      </span>
                      <div className="absolute inset-0 grid place-items-center gap-sm opacity-0 transition-opacity group-hover:opacity-100">
                        <Button variant="primary" size="icon" onClick={() => live ? applyGameProfile(g.id).then(() => gameLaunchInfo(g.id)) : undefined} aria-label="Play"><Play className="h-4 w-4" /></Button>
                        <Button variant="glass" size="icon-sm" onClick={() => setSelected(g)} aria-label="Configure"><Settings2 className="h-4 w-4" /></Button>
                      </div>
                    </div>
                    <div className="p-sm">
                      <p className="truncate text-sm font-semibold text-content">{g.name}</p>
                      <p className="flex items-center justify-between text-2xs text-content-subtle">
                        <span>{g.sizeBytes ? formatBytes(g.sizeBytes, 0) : "—"}</span>
                        <span>{g.lastPlayed ? new Date(g.lastPlayed * 1000).toLocaleDateString() : "Never"}</span>
                      </p>
                    </div>
                  </GlassCard>
                </motion.div>
              ))}
            </motion.div>
          )}
        </div>

        {/* MangoHud overlay */}
        <div className="space-y-md">
          <GlassCard padding="lg">
            <SectionTitle title="Performance Overlay" description="MangoHud" action={<Badge variant={mangohud?.available ? "success" : "warning"}>{mangohud?.available ? "Installed" : "Missing"}</Badge>} />
            {mangohud?.available ? (
              <div className="space-y-sm">
                {mangohud.presets.map((p) => (
                  <button key={p.name} onClick={() => live && mangohudApply(p.config)} className="flex w-full items-center gap-sm rounded-lg border border-border p-md text-left transition-all hover:border-accent/50">
                    <MonitorPlay className="h-4 w-4 text-accent-strong" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-content">{p.name}</p>
                      <p className="text-2xs text-content-subtle">{p.description}</p>
                    </div>
                  </button>
                ))}
                <p className="text-2xs text-content-subtle">Displays FPS, frametime, CPU, GPU, RAM & VRAM in-game.</p>
              </div>
            ) : (
              <div className="grid place-items-center py-lg text-center">
                <Download className="h-8 w-8 text-content-subtle" />
                <p className="mt-sm text-sm text-content-muted">MangoHud not installed.</p>
                <code className="mt-2xs rounded bg-surface-sunken px-xs py-2xs text-2xs text-content-muted">sudo pacman -S mangohud</code>
              </div>
            )}
          </GlassCard>

          <GlassCard padding="lg">
            <SectionTitle title="Game Boost" />
            <p className="text-sm text-content-muted">Selecting a game and pressing Play applies its profile (power, RGB, fan) and launches with GameMode{launchers?.primeRun ? " + PRIME offload" : ""}.</p>
            <div className="mt-md flex flex-wrap gap-xs text-2xs">
              {launchers?.gamemode && <Badge variant="success"><Gauge className="h-3 w-3" /> GameMode ready</Badge>}
              {launchers?.primeRun && <Badge variant="info"><Cpu className="h-3 w-3" /> PRIME offload</Badge>}
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Profile editor drawer */}
      <AnimatePresence>
        {selected && <ProfileEditor game={selected} live={live} onClose={() => setSelected(null)} />}
      </AnimatePresence>

      {/* Add / edit manual game */}
      <AnimatePresence>
        {editing && (
          <AddGameDialog
            initial={editing === "new" ? null : editing}
            onClose={() => setEditing(null)}
            onSaved={async (msg) => { setEditing(null); await refreshManual(); setStatus({ kind: "ok", msg }); }}
            onError={(msg) => setStatus({ kind: "error", msg })}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/** Resolve a local file path to a webview-loadable asset URL (Tauri only). */
function useAssetSrc(path: string | null): string | undefined {
  const [src, setSrc] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!path || !isTauri()) { setSrc(undefined); return; }
    let alive = true;
    import("@tauri-apps/api/core")
      .then(({ convertFileSrc }) => { if (alive) setSrc(convertFileSrc(path)); })
      .catch(() => { if (alive) setSrc(undefined); });
    return () => { alive = false; };
  }, [path]);
  return src;
}

const MGRADS: Record<string, string> = {
  steam: "from-cyan-500 to-blue-800",
  lutris: "from-orange-500 to-amber-700",
  heroic: "from-violet-500 to-indigo-800",
  bottles: "from-pink-500 to-rose-800",
  native: "from-emerald-500 to-green-800",
};

function ManualCard({ game, onLaunch, onEdit, onDelete }: { game: ManualGame; onLaunch: () => void; onEdit: () => void; onDelete: () => void }) {
  const bannerSrc = useAssetSrc(game.banner);
  const iconSrc = useAssetSrc(game.icon);
  const banner = bannerSrc ?? iconSrc;
  return (
    <GlassCard interactive glow padding="none" className="group overflow-hidden">
      <div className={cn("relative aspect-[3/4] bg-gradient-to-br", MGRADS[game.source] ?? MGRADS.native)}>
        {banner && <img src={banner} alt="" className="absolute inset-0 h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
        <span className="absolute left-2 top-2"><Badge size="sm" variant="neutral">{game.source}</Badge></span>
        {!banner && (
          <span className="absolute bottom-2 left-2 text-3xl font-bold text-white/90 drop-shadow">
            {game.title.split(" ").map((w) => w[0]).slice(0, 2).join("")}
          </span>
        )}
        <div className="absolute right-2 top-2 flex gap-xs opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={onEdit} className="grid h-7 w-7 place-items-center rounded-md bg-black/40 text-white/90 backdrop-blur hover:bg-black/60" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} className="grid h-7 w-7 place-items-center rounded-md bg-black/40 text-white/90 backdrop-blur hover:bg-danger/70" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
        <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover:opacity-100">
          <Button variant="primary" size="icon" onClick={onLaunch} aria-label="Launch"><Play className="h-4 w-4" /></Button>
        </div>
      </div>
      <div className="p-sm">
        <p className="truncate text-sm font-semibold text-content">{game.title}</p>
        <p className="truncate text-2xs text-content-subtle">{game.appId ? `app ${game.appId}` : game.executable || "—"}</p>
      </div>
    </GlassCard>
  );
}

const SOURCES: { value: ManualGame["source"]; label: string }[] = [
  { value: "native", label: "Native" },
  { value: "steam", label: "Steam" },
  { value: "lutris", label: "Lutris" },
  { value: "heroic", label: "Heroic" },
  { value: "bottles", label: "Bottles" },
];

function blankGame(): ManualGame {
  return { id: "", title: "", source: "native", executable: "", workingDir: null, launchArgs: "", icon: null, banner: null, appId: null };
}

function AddGameDialog({ initial, onClose, onSaved, onError }: { initial: ManualGame | null; onClose: () => void; onSaved: (msg: string) => void; onError: (msg: string) => void }) {
  const [g, setG] = useState<ManualGame>(initial ?? blankGame());
  const [busy, setBusy] = useState(false);
  const editing = !!initial;
  const isLauncher = g.source !== "native";

  function patch(p: Partial<ManualGame>) { setG((c) => ({ ...c, ...p })); }

  async function pick(kind: "exe" | "dir" | "icon" | "banner") {
    if (!isTauri()) { onError("File picker is only available in the desktop app."); return; }
    try {
      const path = await pickPath(
        kind === "dir"
          ? { directory: true, title: "Select working directory" }
          : kind === "exe"
            ? { title: "Select executable" }
            : { title: "Select image", filters: [{ name: "Image", extensions: ["png", "jpg", "jpeg", "webp", "ico"] }] },
      );
      if (!path) return;
      if (kind === "exe") patch({ executable: path, title: g.title || fileStem(path) });
      else if (kind === "dir") patch({ workingDir: path });
      else if (kind === "icon") patch({ icon: path });
      else patch({ banner: path });
    } catch (e) { onError(String(e)); }
  }

  async function save() {
    if (!g.title.trim()) { onError("Please enter a title."); return; }
    if (g.source === "native" && !g.executable.trim()) { onError("Select an executable for a native game."); return; }
    if (isLauncher && !g.appId?.trim() && !g.executable.trim()) { onError("Provide an App ID or an executable for this launcher game."); return; }
    setBusy(true);
    try {
      if (!isTauri()) { onSaved(`Demo — would ${editing ? "update" : "add"} ${g.title}.`); return; }
      if (editing) { await updateManualGame(g); onSaved(`Updated ${g.title}.`); }
      else { const added = await addManualGame(g); onSaved(`Added ${added.title}.`); }
    } catch (e) { onError(String(e)); } finally { setBusy(false); }
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[var(--z-modal)] grid place-items-end bg-black/40 backdrop-blur-sm sm:place-items-center" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto glass glass-strong glass-edge rounded-2xl p-lg shadow-e4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-md flex items-center justify-between">
          <h3 className="font-display text-xl font-semibold text-content">{editing ? "Edit Game" : "Add Game"}</h3>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="space-y-md">
          <div>
            <p className="mb-xs text-sm font-medium text-content">Import source</p>
            <Segmented value={g.source} onChange={(v) => patch({ source: v as ManualGame["source"] })} options={SOURCES} size="sm" className="w-full" />
          </div>

          <LabeledInput label="Title" value={g.title} onChange={(v) => patch({ title: v })} placeholder="e.g. Elden Ring" />

          {isLauncher && (
            <LabeledInput
              label={g.source === "steam" ? "Steam App ID" : g.source === "lutris" ? "Lutris slug / id" : "App ID / name"}
              value={g.appId ?? ""}
              onChange={(v) => patch({ appId: v || null })}
              placeholder={g.source === "steam" ? "1245620" : "game-slug"}
            />
          )}

          <PathField icon={FileCog} label={isLauncher ? "Executable (optional)" : "Executable"} value={g.executable} onPick={() => pick("exe")} onClear={() => patch({ executable: "" })} />
          <PathField icon={FolderOpen} label="Working directory (optional)" value={g.workingDir ?? ""} onPick={() => pick("dir")} onClear={() => patch({ workingDir: null })} />

          <LabeledInput label="Launch arguments (optional)" value={g.launchArgs} onChange={(v) => patch({ launchArgs: v })} placeholder="-windowed -novid" />

          <div className="grid grid-cols-2 gap-md">
            <PathField icon={ImageIcon} label="Icon (optional)" value={g.icon ?? ""} onPick={() => pick("icon")} onClear={() => patch({ icon: null })} />
            <PathField icon={ImageIcon} label="Banner (optional)" value={g.banner ?? ""} onPick={() => pick("banner")} onClear={() => patch({ banner: null })} />
          </div>

          <Button variant="primary" size="md" className="w-full" disabled={busy} onClick={save}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {editing ? "Save Changes" : "Add to Library"}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function fileStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.[^.]+$/, "");
}

function LabeledInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-xs block text-sm font-medium text-content">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border bg-surface-sunken/60 px-sm text-sm text-content outline-none placeholder:text-content-subtle focus:border-accent/60"
      />
    </label>
  );
}

function PathField({ icon: Icon, label, value, onPick, onClear }: { icon: typeof FileCog; label: string; value: string; onPick: () => void; onClear: () => void }) {
  return (
    <div>
      <span className="mb-xs block text-sm font-medium text-content">{label}</span>
      <div className="flex items-center gap-sm rounded-md border border-border bg-surface-sunken/60 p-xs">
        <Icon className="ml-xs h-4 w-4 shrink-0 text-content-subtle" />
        <code className="min-w-0 flex-1 truncate text-xs text-content-muted">{value || "—"}</code>
        {value && <button onClick={onClear} className="text-content-subtle hover:text-content" aria-label="Clear"><X className="h-3.5 w-3.5" /></button>}
        <Button variant="ghost" size="sm" onClick={onPick}>Browse</Button>
      </div>
    </div>
  );
}

function ProfileEditor({ game, live, onClose }: { game: Game; live: boolean; onClose: () => void }) {
  const [profile, setProfile] = useState<GameProfile>(emptyProfile(game.id));
  const [launchOpts, setLaunchOpts] = useState<string>("%command%");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (live) {
      getGameProfile(game.id).then(setProfile).catch(() => setProfile(emptyProfile(game.id)));
      gameLaunchInfo(game.id).then((l) => l && setLaunchOpts(l.steamLaunchOptions)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.id]);

  // Recompute the demo launch options string from toggles.
  useEffect(() => {
    if (live) return;
    const parts: string[] = [];
    profile.envVars.forEach((e) => e.key && parts.push(`${e.key}=${e.value}`));
    if (profile.useMangohud) parts.push("mangohud");
    if (profile.useGamemode) parts.push("gamemoderun");
    if (profile.usePrime) parts.push("prime-run");
    setLaunchOpts([...parts, "%command%"].join(" "));
  }, [profile, live]);

  function patch(p: Partial<GameProfile>) {
    setProfile((cur) => ({ ...cur, ...p }));
    setSaved(false);
  }

  async function save() {
    if (live) await saveGameProfile(profile).catch(() => {});
    setSaved(true);
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[var(--z-modal)] grid place-items-end bg-black/40 backdrop-blur-sm sm:place-items-center" onClick={onClose}>
      <motion.div
        initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto glass glass-strong glass-edge rounded-2xl p-lg shadow-e4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-md flex items-center justify-between">
          <div>
            <h3 className="font-display text-xl font-semibold text-content">{game.name}</h3>
            <p className="text-2xs text-content-subtle">{game.source} · {game.id}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="space-y-md">
          {/* Power profile */}
          <Field icon={Cpu} label="Power Profile">
            <Segmented value={profile.power ?? "none"} onChange={(v) => patch({ power: v === "none" ? null : v })}
              options={[{ value: "none", label: "—" }, { value: "power-saver", label: "Saver" }, { value: "balanced", label: "Balanced" }, { value: "performance", label: "Perf" }]} size="sm" />
          </Field>

          {/* RGB */}
          <Field icon={Palette} label="RGB Effect">
            <Segmented value={profile.rgb?.effect ?? "none"} onChange={(v) => patch({ rgb: v === "none" ? null : { effect: v, hue: profile.rgb?.hue ?? 0, brightness: 100, speed: 50 } })}
              options={[{ value: "none", label: "—" }, { value: "static", label: "Static" }, { value: "aurora", label: "Aurora" }, { value: "rainbow", label: "Rainbow" }]} size="sm" />
          </Field>

          {/* Fan profile */}
          <Field icon={Fan} label="Fan Profile">
            <Segmented value={profile.fan ?? "none"} onChange={(v) => patch({ fan: v === "none" ? null : v })}
              options={[{ value: "none", label: "—" }, { value: "Balanced", label: "Balanced" }, { value: "Gaming", label: "Gaming" }, { value: "Turbo", label: "Turbo" }]} size="sm" />
          </Field>

          {/* Launch toggles */}
          <div className="space-y-2xs rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
            <Toggle label="PRIME offload (run on dGPU)" checked={profile.usePrime} onChange={(v) => patch({ usePrime: v })} />
            <Toggle label="GameMode" checked={profile.useGamemode} onChange={(v) => patch({ useGamemode: v })} />
            <Toggle label="MangoHud overlay" checked={profile.useMangohud} onChange={(v) => patch({ useMangohud: v })} />
          </div>

          {/* Launch optimizer & automation */}
          <div className="space-y-md rounded-lg border border-accent/20 bg-accent/5 p-md">
            <p className="flex items-center gap-xs text-sm font-semibold text-content"><Rocket className="h-4 w-4 text-accent" /> Launch Optimizer & Automation</p>

            <Toggle label="Clear caches before launch" checked={profile.clearCache} onChange={(v) => patch({ clearCache: v })} />

            <div>
              <p className="mb-xs text-sm font-medium text-content">Close apps before launch</p>
              <input
                value={profile.closeApps.join(", ")}
                onChange={(e) => patch({ closeApps: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                placeholder="chrome, discord, slack"
                className="h-9 w-full rounded-md border border-border bg-surface-sunken/60 px-sm text-sm text-content outline-none placeholder:text-content-subtle focus:border-accent/60"
              />
              <p className="mt-2xs text-2xs text-content-subtle">Comma-separated process names (your own processes only).</p>
            </div>

            <div>
              <div className="mb-xs flex items-center justify-between">
                <span className="text-sm font-medium text-content">CPU priority (nice)</span>
                <span className="text-xs font-semibold tabular-nums text-accent-strong">{profile.priority ?? "default"}{profile.priority != null && profile.priority < 0 ? " · needs root" : ""}</span>
              </div>
              <input type="range" min={-20} max={19} step={1} value={profile.priority ?? 0} onChange={(e) => patch({ priority: Number(e.target.value) || null })} className="w-full accent-[rgb(var(--color-accent))]" />
              <p className="mt-2xs text-2xs text-content-subtle">Lower = higher priority. Negative values need elevated privilege.</p>
            </div>

            <div className="border-t border-border-subtle pt-md">
              <Toggle label="Auto-apply when game is running" checked={profile.autoApply} onChange={(v) => patch({ autoApply: v, matchProcess: v && !profile.matchProcess ? defaultMatch(game) : profile.matchProcess })} />
              {profile.autoApply && (
                <div className="mt-xs">
                  <p className="mb-xs text-sm font-medium text-content">Watch for process</p>
                  <input
                    value={profile.matchProcess ?? ""}
                    onChange={(e) => patch({ matchProcess: e.target.value || null })}
                    placeholder="cs2"
                    className="h-9 w-full rounded-md border border-border bg-surface-sunken/60 px-sm text-sm text-content outline-none placeholder:text-content-subtle focus:border-accent/60"
                  />
                  <p className="mt-2xs text-2xs text-content-subtle">Nexus applies this profile automatically when this process appears, and resets when it exits.</p>
                </div>
              )}
            </div>
          </div>

          {/* Steam launch options */}
          <div>
            <p className="mb-xs flex items-center gap-xs text-sm font-medium text-content"><Terminal className="h-4 w-4 text-content-muted" /> Steam Launch Options</p>
            <div className="flex items-center gap-sm rounded-lg border border-border bg-surface-sunken/60 p-xs">
              <code className="min-w-0 flex-1 truncate px-xs text-xs text-content-muted">{launchOpts}</code>
              <Button variant="ghost" size="icon-sm" onClick={() => navigator.clipboard?.writeText(launchOpts)}><Copy className="h-3.5 w-3.5" /></Button>
            </div>
            <p className="mt-2xs text-2xs text-content-subtle">Paste into the game's Properties → Launch Options in Steam.</p>
          </div>

          <div className="flex gap-sm">
            <Button variant="primary" size="md" className="flex-1" onClick={save}>
              {saved ? <><Check className="h-4 w-4" /> Saved</> : <><Save className="h-4 w-4" /> Save Profile</>}
            </Button>
            <Button variant="solid" size="md" onClick={() => live && applyGameProfile(game.id)}>
              <Rocket className="h-4 w-4" /> Apply Now
            </Button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ icon: Icon, label, children }: { icon: typeof Cpu; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-md">
      <span className="flex items-center gap-xs text-sm font-medium text-content"><Icon className="h-4 w-4 text-content-muted" /> {label}</span>
      {children}
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-2xs">
      <span className="text-sm text-content-muted">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
