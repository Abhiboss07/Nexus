export type ThemeId = "dark" | "oled" | "arctic";

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
    id: "arctic",
    label: "Arctic",
    description: "Ice blue on white",
    swatch: ["#f3f7fb", "#0ea5e9", "#38bdf8"],
    scheme: "light",
  },
];

export const DEFAULT_THEME: ThemeId = "dark";
