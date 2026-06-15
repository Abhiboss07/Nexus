import { useCallback, useEffect, useState } from "react";
import {
  isTauri,
  scanGames,
  getGameLaunchers,
  getMangoHudStatus,
  listManualGames,
} from "@/lib/ipc";
import type { Game, LauncherStatus, ManualGame, MangoHudStatus } from "@/lib/games-types";

const DEMO_LAUNCHERS: LauncherStatus = {
  steam: true, lutris: true, heroic: false, gamemode: true, gamescope: false, mangohud: false, primeRun: true,
};

const DEMO_GAMES: Game[] = [
  { id: "steam:1145360", name: "Hades", source: "steam", appId: "1145360", installDir: null, sizeBytes: 18_000_000_000, lastPlayed: Date.now() / 1000 - 3600, isTool: false },
  { id: "steam:1245620", name: "Elden Ring", source: "steam", appId: "1245620", installDir: null, sizeBytes: 60_000_000_000, lastPlayed: Date.now() / 1000 - 86400, isTool: false },
  { id: "steam:632360", name: "Risk of Rain 2", source: "steam", appId: "632360", installDir: null, sizeBytes: 4_000_000_000, lastPlayed: null, isTool: false },
  { id: "lutris:minecraft-1", name: "Minecraft", source: "lutris", appId: null, installDir: null, sizeBytes: 0, lastPlayed: null, isTool: false },
];

const DEMO_MANUAL: ManualGame[] = [
  { id: "manual:darksouls", title: "Dark Souls (native)", source: "native", executable: "/games/darksouls/ds.sh", workingDir: null, launchArgs: "", icon: null, banner: null, appId: null },
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
  const [manualGames, setManualGames] = useState<ManualGame[]>([]);
  const [launchers, setLaunchers] = useState<LauncherStatus | null>(null);
  const [mangohud, setMangohud] = useState<MangoHudStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (isTauri()) {
      try {
        const [g, m, l, mh] = await Promise.all([
          scanGames(false),
          listManualGames(),
          getGameLaunchers(),
          getMangoHudStatus(),
        ]);
        setGames(g);
        setManualGames(m);
        setLaunchers(l);
        setMangohud(mh);
      } catch {
        setGames(DEMO_GAMES);
        setManualGames(DEMO_MANUAL);
        setLaunchers(DEMO_LAUNCHERS);
        setMangohud(DEMO_MANGOHUD);
      }
    } else {
      setGames(DEMO_GAMES);
      setManualGames(DEMO_MANUAL);
      setLaunchers(DEMO_LAUNCHERS);
      setMangohud(DEMO_MANGOHUD);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  /** Reload only the manual library (after add/edit/delete). */
  const refreshManual = useCallback(async () => {
    if (!isTauri()) return;
    try { setManualGames(await listManualGames()); } catch { /* keep current */ }
  }, []);

  return { games, manualGames, launchers, mangohud, loading, refresh: load, refreshManual, setManualGames };
}
