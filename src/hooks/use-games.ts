import { useEffect, useState } from "react";
import { isTauri, scanGames, getGameLaunchers, getMangoHudStatus } from "@/lib/ipc";
import type { Game, LauncherStatus, MangoHudStatus } from "@/lib/games-types";

const DEMO_LAUNCHERS: LauncherStatus = {
  steam: true, lutris: true, heroic: false, gamemode: true, gamescope: false, mangohud: false, primeRun: true,
};

const DEMO_GAMES: Game[] = [
  { id: "steam:1145360", name: "Hades", source: "steam", appId: "1145360", installDir: null, sizeBytes: 18_000_000_000, lastPlayed: Date.now() / 1000 - 3600, isTool: false },
  { id: "steam:1245620", name: "Elden Ring", source: "steam", appId: "1245620", installDir: null, sizeBytes: 60_000_000_000, lastPlayed: Date.now() / 1000 - 86400, isTool: false },
  { id: "steam:632360", name: "Risk of Rain 2", source: "steam", appId: "632360", installDir: null, sizeBytes: 4_000_000_000, lastPlayed: null, isTool: false },
  { id: "lutris:minecraft-1", name: "Minecraft", source: "lutris", appId: null, installDir: null, sizeBytes: 0, lastPlayed: null, isTool: false },
];

const DEMO_MANGOHUD: MangoHudStatus = {
  available: false,
  configPath: "~/.config/MangoHud/MangoHud.conf",
  configExists: false,
  currentConfig: null,
  presets: [
    { name: "Minimal", description: "Just FPS", config: "fps\n" },
    { name: "Standard", description: "FPS, frametime, CPU/GPU", config: "fps\nframetime\ncpu_stats\ngpu_stats\nram\nvram\n" },
    { name: "Full", description: "Everything", config: "fps\nframetime\ncpu_stats\ncpu_temp\ngpu_stats\ngpu_temp\ngpu_power\nram\nvram\nio_stats\n" },
  ],
};

export function useGames() {
  const [games, setGames] = useState<Game[]>([]);
  const [launchers, setLaunchers] = useState<LauncherStatus | null>(null);
  const [mangohud, setMangohud] = useState<MangoHudStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (isTauri()) {
        try {
          const [g, l, m] = await Promise.all([scanGames(false), getGameLaunchers(), getMangoHudStatus()]);
          if (cancelled) return;
          setGames(g);
          setLaunchers(l);
          setMangohud(m);
        } catch {
          if (cancelled) return;
          setGames(DEMO_GAMES);
          setLaunchers(DEMO_LAUNCHERS);
          setMangohud(DEMO_MANGOHUD);
        }
      } else {
        setGames(DEMO_GAMES);
        setLaunchers(DEMO_LAUNCHERS);
        setMangohud(DEMO_MANGOHUD);
      }
      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { games, launchers, mangohud, loading };
}
