import {
  Moon,
  Sun,
  Monitor,
  Zap,
  Sparkles,
  Gauge,
  Palette as PaletteIcon,
  type LucideIcon,
} from "lucide-react";
import type { NavigateFunction } from "react-router-dom";
import type { ThemeId } from "@/config/themes";
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

/** Non-navigation commands. Navigation entries are generated from NAV_ITEMS. */
export const ACTION_COMMANDS: CommandAction[] = [
  {
    id: "theme-dark",
    label: "Switch to Dark theme",
    icon: Moon,
    group: "Theme",
    keywords: ["dark", "night"],
    run: ({ setTheme, close }) => {
      setTheme("dark");
      close();
    },
  },
  {
    id: "theme-light",
    label: "Switch to Light theme",
    icon: Sun,
    group: "Theme",
    keywords: ["light", "day", "bright"],
    run: ({ setTheme, close }) => {
      setTheme("light");
      close();
    },
  },
  {
    id: "theme-oled",
    label: "Switch to OLED Black",
    icon: Monitor,
    group: "Theme",
    keywords: ["oled", "black", "amoled"],
    run: ({ setTheme, close }) => {
      setTheme("oled");
      close();
    },
  },
  {
    id: "theme-cyberpunk",
    label: "Switch to Cyberpunk",
    icon: PaletteIcon,
    group: "Theme",
    keywords: ["neon", "cyber", "magenta"],
    run: ({ setTheme, close }) => {
      setTheme("cyberpunk");
      close();
    },
  },
  {
    id: "theme-rgb",
    label: "Switch to Nexus RGB",
    icon: Sparkles,
    group: "Theme",
    keywords: ["rgb", "rainbow", "chroma"],
    run: ({ setTheme, close }) => {
      setTheme("nexus-rgb");
      close();
    },
  },
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
