export type ThemeId =
  | "dark"
  | "oled"
  | "cyberpunk"
  | "matrix"
  | "molten"
  | "arctic"
  | "midnight"
  | "emerald"
  | "crimson"
  | "solarized"
  | "titanium"
  | "synthwave";

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
  /** Preview swatch colors (CSS color strings): [canvas, accent, accent-2]. */
  swatch: [string, string, string];
  scheme: "dark" | "light";
}

/**
 * Theme registry. Each id has a matching `[data-theme="<id>"]` token block in
 * styles/tokens.css — overriding only design tokens, so buttons, cards, graphs,
 * badges, toggles, focus rings, glows and progress bars all re-skin together.
 */
export const THEMES: ThemeMeta[] = [
  {
    id: "dark",
    label: "Nexus Dark",
    description: "Deep-space command center",
    swatch: ["#0a0c12", "#7c5cff", "#00d1ff"],
    scheme: "dark",
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
    id: "matrix",
    label: "Matrix",
    description: "Green-on-black terminal",
    swatch: ["#020802", "#00ff66", "#7dff9b"],
    scheme: "dark",
  },
  {
    id: "molten",
    label: "Molten",
    description: "Orange & red energy",
    swatch: ["#140805", "#ff6a2b", "#ff3b3b"],
    scheme: "dark",
  },
  {
    id: "arctic",
    label: "Arctic",
    description: "Ice blue on white",
    swatch: ["#f3f7fb", "#0ea5e9", "#38bdf8"],
    scheme: "light",
  },
  {
    id: "midnight",
    label: "Midnight",
    description: "Deep navy & electric blue",
    swatch: ["#070b1c", "#3b82f6", "#22d3ee"],
    scheme: "dark",
  },
  {
    id: "emerald",
    label: "Emerald",
    description: "Premium emerald green",
    swatch: ["#04140e", "#10b981", "#34d399"],
    scheme: "dark",
  },
  {
    id: "crimson",
    label: "Crimson",
    description: "Dark red command",
    swatch: ["#160608", "#ef4444", "#fb7185"],
    scheme: "dark",
  },
  {
    id: "solarized",
    label: "Solarized",
    description: "Warm, professional",
    swatch: ["#fdf6e3", "#268bd2", "#2aa198"],
    scheme: "light",
  },
  {
    id: "titanium",
    label: "Titanium",
    description: "Silver & graphite",
    swatch: ["#0e0f12", "#9aa6b2", "#cbd5e1"],
    scheme: "dark",
  },
  {
    id: "synthwave",
    label: "Synthwave",
    description: "Purple & neon pink",
    swatch: ["#150a26", "#a855f7", "#ff5ed3"],
    scheme: "dark",
  },
];

export const DEFAULT_THEME: ThemeId = "dark";
