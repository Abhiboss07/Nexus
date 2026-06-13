import { useEffect, useState } from "react";
import { isTauri, getIntegrations } from "@/lib/ipc";
import type { Integration } from "@/lib/integrations-types";

const DEMO: Integration[] = [
  { id: "mangohud", name: "MangoHud", category: "gaming", detected: false, detail: "", hint: "sudo pacman -S mangohud" },
  { id: "gamescope", name: "Gamescope", category: "gaming", detected: false, detail: "", hint: "sudo pacman -S gamescope" },
  { id: "gamemode", name: "GameMode", category: "gaming", detected: true, detail: "gamemode version: v1.8.2", hint: "" },
  { id: "openrgb", name: "OpenRGB", category: "hardware", detected: false, detail: "", hint: "sudo pacman -S openrgb" },
  { id: "coolercontrol", name: "CoolerControl", category: "hardware", detected: false, detail: "", hint: "yay -S coolercontrol" },
  { id: "lact", name: "LACT", category: "hardware", detected: false, detail: "", hint: "yay -S lact" },
  { id: "steam", name: "Steam", category: "launchers", detected: true, detail: "steam · /usr/bin/steam", hint: "" },
  { id: "lutris", name: "Lutris", category: "launchers", detected: true, detail: "lutris-0.5.22", hint: "" },
  { id: "heroic", name: "Heroic", category: "launchers", detected: false, detail: "", hint: "flatpak install flathub com.heroicgameslauncher.hgl" },
  { id: "bottles", name: "Bottles", category: "launchers", detected: false, detail: "", hint: "flatpak install flathub com.usebottles.bottles" },
  { id: "docker", name: "Docker", category: "containers", detected: true, detail: "Docker version 29.5.2 · running", hint: "" },
  { id: "podman", name: "Podman", category: "containers", detected: false, detail: "", hint: "sudo pacman -S podman" },
  { id: "flatpak", name: "Flatpak", category: "containers", detected: true, detail: "Flatpak 1.18.0 · 0 apps", hint: "" },
  { id: "snap", name: "Snap", category: "containers", detected: false, detail: "", hint: "yay -S snapd" },
  { id: "nvidia-container-toolkit", name: "NVIDIA Container Toolkit", category: "containers", detected: false, detail: "", hint: "sudo pacman -S nvidia-container-toolkit" },
  { id: "display-server", name: "Display Server", category: "system", detected: true, detail: "Wayland (XWayland available)", hint: "" },
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

  return { items, loading, refresh: load };
}
