import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_THEME, type ThemeId } from "@/config/themes";
import {
  DEFAULT_BACKGROUND,
  type BackgroundMode,
} from "@/config/backgrounds";

interface ThemeState {
  theme: ThemeId;
  background: BackgroundMode;
  /** Global UI density. */
  density: "comfortable" | "compact";

  setTheme: (theme: ThemeId) => void;
  setBackground: (bg: BackgroundMode) => void;
  setDensity: (d: ThemeState["density"]) => void;
}

/**
 * Applies the theme to the document root with a brief transition flag so the
 * swap reads as deliberate, not janky. Kept out of the store so it can also run
 * once on hydration.
 */
export function applyThemeToDOM(theme: ThemeId) {
  const root = document.documentElement;
  root.classList.add("theme-animating");
  root.setAttribute("data-theme", theme);
  // dark/light class drives Tailwind's `dark:` variant + native form controls.
  const isLight = theme === "light";
  root.classList.toggle("dark", !isLight);
  root.classList.toggle("light", isLight);
  window.setTimeout(() => root.classList.remove("theme-animating"), 240);
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      theme: DEFAULT_THEME,
      background: DEFAULT_BACKGROUND,
      density: "comfortable",

      setTheme: (theme) => {
        applyThemeToDOM(theme);
        set({ theme });
      },
      setBackground: (background) => set({ background }),
      setDensity: (density) => set({ density }),
    }),
    {
      name: "nexus.theme",
      onRehydrateStorage: () => (state) => {
        if (state) applyThemeToDOM(state.theme);
      },
    },
  ),
);
