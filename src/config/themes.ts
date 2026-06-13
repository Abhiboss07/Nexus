export type ThemeId = "dark" | "light" | "oled" | "cyberpunk" | "nexus-rgb";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  /** Preview swatch colors (CSS color strings) for the theme switcher. */
  swatch: [string, string, string];
  scheme: "dark" | "light";
}

export const THEMES: ThemeMeta[] = [
  {
    id: "dark",
    label: "Nexus Dark",
    description: "Deep-space command center",
    swatch: ["#0a0c12", "#7c5cff", "#00d1ff"],
    scheme: "dark",
  },
  {
    id: "light",
    label: "Aurora Light",
    description: "Bright, focused, daylight",
    swatch: ["#f4f6fb", "#6343eb", "#0ea5e9"],
    scheme: "light",
  },
  {
    id: "oled",
    label: "OLED Black",
    description: "True black, max contrast",
    swatch: ["#000000", "#8264ff", "#00e0ff"],
    scheme: "dark",
  },
  {
    id: "cyberpunk",
    label: "Cyberpunk",
    description: "Neon magenta & acid yellow",
    swatch: ["#0d061a", "#ff2d95", "#fae042"],
    scheme: "dark",
  },
  {
    id: "nexus-rgb",
    label: "Nexus RGB",
    description: "Living chroma-cycling accent",
    swatch: ["#06070e", "#8a6eff", "#00e0ff"],
    scheme: "dark",
  },
];

export const DEFAULT_THEME: ThemeId = "dark";
