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
  getGameProfile,
  saveGameProfile,
  applyGameProfile,
  gameLaunchInfo,
  mangohudApply,
} from "@/lib/ipc";
import type { Game, GameProfile } from "@/lib/games-types";
import { stagger, fadeUp } from "@/lib/motion";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/cn";

const GRADIENTS = ["from-yellow-400 to-fuchsia-600", "from-amber-500 to-orange-700", "from-cyan-400 to-blue-700", "from-rose-500 to-red-800", "from-green-400 to-emerald-700", "from-indigo-400 to-purple-700"];
const grad = (id: string) => GRADIENTS[Math.abs([...id].reduce((a, c) => a + c.charCodeAt(0), 0)) % GRADIENTS.length];

function emptyProfile(id: string): GameProfile {
  return { gameId: id, rgb: null, power: null, fan: null, launchCommand: null, envVars: [], usePrime: false, useGamemode: true, useMangohud: false };
}

export default function GamePage() {
  const { games, launchers, mangohud } = useGames();
  const source = useTelemetrySource();
  const live = source === "live";
  const [selected, setSelected] = useState<Game | null>(null);

  return (
    <div>
      <PageHeader
        title="Game Center"
        description="Your library, optimized — per-game profiles, overlay & boost."
        actions={<Badge variant="accent" size="md"><Rocket className="h-3.5 w-3.5" /> {games.length} games</Badge>}
      />

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
          <SectionTitle title="Library" description="Scanned from Steam & Lutris" />
          {games.length === 0 ? (
            <EmptyState icon={Gamepad2} title="No games found" description="Install games via Steam or Lutris and they'll appear here automatically." />
          ) : (
            <motion.div variants={stagger(0.04)} initial="hidden" animate="show" className="grid grid-cols-2 gap-md sm:grid-cols-3 lg:grid-cols-4">
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
