import { useEffect, useState } from "react";
import { isTauri, getIntegrations, installIntegration } from "@/lib/ipc";
import type { Integration } from "@/lib/integrations-types";

const d = (
  id: string,
  name: string,
  category: Integration["category"],
  detected: boolean,
  detail: string,
  hint: string,
  docUrl: string,
  flatpakId = "",
): Integration => ({ id, name, category, detected, detail, hint, docUrl, flatpakId });

const DEMO: Integration[] = [
  d("mangohud", "MangoHud", "gaming", false, "", "sudo pacman -S mangohud", "https://github.com/flightlessmango/MangoHud"),
  d("gamescope", "Gamescope", "gaming", false, "", "sudo pacman -S gamescope", "https://github.com/ValveSoftware/gamescope"),
  d("gamemode", "GameMode", "gaming", true, "gamemode version: v1.8.2", "", "https://github.com/FeralInteractive/gamemode"),
  d("openrgb", "OpenRGB", "hardware", false, "", "sudo pacman -S openrgb", "https://openrgb.org", "org.openrgb.OpenRGB"),
  d("coolercontrol", "CoolerControl", "hardware", false, "", "yay -S coolercontrol", "https://gitlab.com/coolercontrol/coolercontrol"),
  d("lact", "LACT", "hardware", false, "", "yay -S lact", "https://github.com/ilya-zlobintsev/LACT"),
  d("steam", "Steam", "launchers", true, "steam · /usr/bin/steam", "", "https://store.steampowered.com", "com.valvesoftware.Steam"),
  d("lutris", "Lutris", "launchers", true, "lutris-0.5.22", "", "https://lutris.net", "net.lutris.Lutris"),
  d("heroic", "Heroic", "launchers", false, "", "flatpak install flathub com.heroicgameslauncher.hgl", "https://heroicgameslauncher.com", "com.heroicgameslauncher.hgl"),
  d("bottles", "Bottles", "launchers", false, "", "flatpak install flathub com.usebottles.bottles", "https://usebottles.com", "com.usebottles.bottles"),
  d("docker", "Docker", "containers", true, "Docker version 29.5.2 · running", "", "https://docs.docker.com"),
  d("podman", "Podman", "containers", false, "", "sudo pacman -S podman", "https://podman.io"),
  d("flatpak", "Flatpak", "containers", true, "Flatpak 1.18.0 · 12 apps", "", "https://flatpak.org"),
  d("snap", "Snap", "containers", false, "", "yay -S snapd", "https://snapcraft.io"),
  d("nvidia-container-toolkit", "NVIDIA Container Toolkit", "containers", false, "", "sudo pacman -S nvidia-container-toolkit", "https://github.com/NVIDIA/nvidia-container-toolkit"),
  d("vscode", "VS Code", "development", true, "1.96.0", "", "https://code.visualstudio.com", "com.visualstudio.code"),
  d("cursor", "Cursor", "development", false, "", "yay -S cursor-bin", "https://cursor.com"),
  d("jetbrains", "JetBrains IDEs", "development", false, "", "yay -S jetbrains-toolbox", "https://jetbrains.com"),
  d("git", "Git", "development", true, "git version 2.47.1", "", "https://git-scm.com"),
  d("ollama", "Ollama", "ai", false, "", "curl -fsSL https://ollama.com/install.sh | sh", "https://ollama.com"),
  d("lmstudio", "LM Studio", "ai", false, "", "Download the AppImage from lmstudio.ai", "https://lmstudio.ai"),
  d("open-webui", "Open WebUI", "ai", false, "", "pip install open-webui", "https://openwebui.com"),
  d("display-server", "Display Server", "system", true, "Wayland (XWayland available)", "", ""),
];

export function useIntegrations() {
  const [items, setItems] = useState<Integration[]>([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    if (isTauri()) {
      getIntegrations()
        .then(setItems)
        .catch(() => setItems(DEMO))
        .finally(() => setLoading(false));
    } else {
      setItems(DEMO);
      setLoading(false);
    }
  }

  useEffect(load, []);

  /** One-click flatpak install (Tauri only); returns a status message. */
  async function install(item: Integration): Promise<string> {
    if (!item.flatpakId) throw new Error("No one-click installer for this tool.");
    if (!isTauri()) return `Demo — would install ${item.name} via Flatpak.`;
    const msg = await installIntegration(item.flatpakId);
    load();
    return msg;
  }

  return { items, loading, refresh: load, install };
}
