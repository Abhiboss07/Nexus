import {
  Zap,
  Sparkles,
  Gauge,
  Palette as PaletteIcon,
  type LucideIcon,
} from "lucide-react";
import type { NavigateFunction } from "react-router-dom";
import { THEMES, type ThemeId } from "@/config/themes";
import type { BackgroundMode } from "@/config/backgrounds";

export interface CommandAction {
  id: string;
  label: string;
  hint?: string;
  icon: LucideIcon;
  group: "Navigation" | "Theme" | "Actions" | "Background";
  keywords?: string[];
  run: (ctx: CommandContext) => void;
}

export interface CommandContext {
  navigate: NavigateFunction;
  setTheme: (t: ThemeId) => void;
  setBackground: (b: BackgroundMode) => void;
  close: () => void;
}

/** One palette command per theme, generated from the theme registry so the list
 *  never drifts from THEMES. */
const THEME_COMMANDS: CommandAction[] = THEMES.map((t) => ({
  id: `theme-${t.id}`,
  label: `Theme: ${t.label}`,
  icon: PaletteIcon,
  group: "Theme" as const,
  keywords: [t.label.toLowerCase(), t.id, t.scheme],
  run: ({ setTheme, close }: CommandContext) => {
    setTheme(t.id);
    close();
  },
}));

/** Non-navigation commands. Navigation entries are generated from NAV_ITEMS. */
export const ACTION_COMMANDS: CommandAction[] = [
  ...THEME_COMMANDS,
  {
    id: "bg-aurora",
    label: "Background: Aurora",
    icon: Sparkles,
    group: "Background",
    run: ({ setBackground, close }) => {
      setBackground("aurora");
      close();
    },
  },
  {
    id: "bg-particles",
    label: "Background: Particle Field",
    icon: Sparkles,
    group: "Background",
    run: ({ setBackground, close }) => {
      setBackground("particles");
      close();
    },
  },
  {
    id: "bg-grid",
    label: "Background: Cyber Grid",
    icon: Sparkles,
    group: "Background",
    run: ({ setBackground, close }) => {
      setBackground("grid");
      close();
    },
  },
  {
    id: "action-boost",
    label: "Boost Performance",
    hint: "Max fans + performance governor",
    icon: Zap,
    group: "Actions",
    keywords: ["turbo", "performance", "fan"],
    run: ({ navigate, close }) => {
      navigate("/performance");
      close();
    },
  },
  {
    id: "action-diagnostics",
    label: "Run System Diagnostics",
    icon: Gauge,
    group: "Actions",
    keywords: ["doctor", "scan", "health"],
    run: ({ navigate, close }) => {
      navigate("/doctor");
      close();
    },
  },
];
