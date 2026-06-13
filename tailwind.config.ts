import type { Config } from "tailwindcss";

/**
 * Tailwind is wired entirely to CSS custom properties (design tokens) defined
 * in `src/styles/tokens.css`. This keeps a single source of truth: themes only
 * ever swap the variables, and every utility re-derives from them instantly.
 *
 * Colors use the `rgb(var(--token) / <alpha-value>)` pattern so Tailwind's
 * opacity modifiers (e.g. `bg-surface/60`) keep working against tokens.
 */
const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Core surfaces
        canvas: "rgb(var(--color-canvas) / <alpha-value>)",
        surface: {
          DEFAULT: "rgb(var(--color-surface) / <alpha-value>)",
          raised: "rgb(var(--color-surface-raised) / <alpha-value>)",
          sunken: "rgb(var(--color-surface-sunken) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--color-border) / <alpha-value>)",
          strong: "rgb(var(--color-border-strong) / <alpha-value>)",
          subtle: "rgb(var(--color-border-subtle) / <alpha-value>)",
        },
        // Foreground / text
        content: {
          DEFAULT: "rgb(var(--color-text) / <alpha-value>)",
          muted: "rgb(var(--color-text-muted) / <alpha-value>)",
          subtle: "rgb(var(--color-text-subtle) / <alpha-value>)",
          inverted: "rgb(var(--color-text-inverted) / <alpha-value>)",
        },
        // Brand accent ramp
        accent: {
          DEFAULT: "rgb(var(--color-accent) / <alpha-value>)",
          soft: "rgb(var(--color-accent-soft) / <alpha-value>)",
          strong: "rgb(var(--color-accent-strong) / <alpha-value>)",
          contrast: "rgb(var(--color-accent-contrast) / <alpha-value>)",
        },
        // Secondary brand (for gradient pairing)
        iris: "rgb(var(--color-iris) / <alpha-value>)",
        // Semantic status
        success: "rgb(var(--color-success) / <alpha-value>)",
        warning: "rgb(var(--color-warning) / <alpha-value>)",
        danger: "rgb(var(--color-danger) / <alpha-value>)",
        info: "rgb(var(--color-info) / <alpha-value>)",
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)",
        display: "var(--font-display)",
      },
      fontSize: {
        "2xs": ["var(--text-2xs)", { lineHeight: "1.4" }],
        xs: ["var(--text-xs)", { lineHeight: "1.5" }],
        sm: ["var(--text-sm)", { lineHeight: "1.5" }],
        base: ["var(--text-base)", { lineHeight: "1.6" }],
        lg: ["var(--text-lg)", { lineHeight: "1.5" }],
        xl: ["var(--text-xl)", { lineHeight: "1.4" }],
        "2xl": ["var(--text-2xl)", { lineHeight: "1.3" }],
        "3xl": ["var(--text-3xl)", { lineHeight: "1.2" }],
        "4xl": ["var(--text-4xl)", { lineHeight: "1.1" }],
        "5xl": ["var(--text-5xl)", { lineHeight: "1.05" }],
      },
      spacing: {
        "2xs": "var(--space-2xs)",
        xs: "var(--space-xs)",
        sm: "var(--space-sm)",
        md: "var(--space-md)",
        lg: "var(--space-lg)",
        xl: "var(--space-xl)",
        "2xl": "var(--space-2xl)",
        "3xl": "var(--space-3xl)",
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        "2xl": "var(--radius-2xl)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        e1: "var(--elevation-1)",
        e2: "var(--elevation-2)",
        e3: "var(--elevation-3)",
        e4: "var(--elevation-4)",
        glow: "var(--shadow-glow)",
        "glow-strong": "var(--shadow-glow-strong)",
        inset: "var(--shadow-inset)",
      },
      backdropBlur: {
        glass: "var(--glass-blur)",
        "glass-strong": "var(--glass-blur-strong)",
      },
      transitionTimingFunction: {
        smooth: "var(--ease-smooth)",
        spring: "var(--ease-spring)",
        snap: "var(--ease-snap)",
      },
      transitionDuration: {
        fast: "var(--duration-fast)",
        base: "var(--duration-base)",
        slow: "var(--duration-slow)",
      },
      keyframes: {
        "aurora-shift": {
          "0%, 100%": { transform: "translate3d(0,0,0) rotate(0deg)" },
          "50%": { transform: "translate3d(-4%, 3%, 0) rotate(8deg)" },
        },
        "pulse-glow": {
          "0%, 100%": { opacity: "0.6" },
          "50%": { opacity: "1" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "grid-pan": {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "var(--grid-size) var(--grid-size)" },
        },
      },
      animation: {
        "aurora-shift": "aurora-shift 18s var(--ease-smooth) infinite",
        "pulse-glow": "pulse-glow 3s var(--ease-smooth) infinite",
        shimmer: "shimmer 1.8s infinite",
        "fade-up": "fade-up var(--duration-base) var(--ease-smooth) both",
        "grid-pan": "grid-pan 12s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
