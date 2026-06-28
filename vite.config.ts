import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// @tauri-apps/cli sets TAURI_DEV_HOST when running `tauri dev`.
const host = process.env.TAURI_DEV_HOST;

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Prevent Vite from obscuring Rust errors.
  clearScreen: false,

  // Tauri expects a fixed port; fail if it is taken.
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Don't watch the Rust backend from the frontend dev server.
      ignored: ["**/src-tauri/**"],
    },
  },

  // Produce a build the Tauri bundler can consume.
  build: {
    target: "esnext",
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      // Two HTML entries: the full app (index.html) and a lightweight, on-demand
      // desktop overlay (overlay.html) that only bundles the animation renderer.
      input: {
        main: path.resolve(__dirname, "index.html"),
        overlay: path.resolve(__dirname, "overlay.html"),
      },
      output: {
        manualChunks(id) {
          // App code the on-demand overlay shares — kept in its own lean chunk so
          // the overlay never pulls the big shared `base` chunk (which carries
          // recharts-importing components it doesn't need).
          if (
            id.includes("/src/store/battery-events-store") ||
            id.includes("/src/store/prefs-store") ||
            id.includes("/src/lib/sound") ||
            id.includes("/src/lib/cn") ||
            id.includes("/src/components/battery/")
          ) {
            return "battery-core";
          }
          // Vendor splits (unchanged intent from the previous object form).
          if (id.includes("node_modules/recharts") || id.includes("node_modules/d3-") || id.includes("node_modules/victory")) {
            return "charts";
          }
          // Router is main-only; keep it out of the shared `react` chunk so the
          // overlay (react + react-dom only) doesn't drag it in.
          if (id.includes("node_modules/react-router") || id.includes("node_modules/@remix-run")) {
            return "router";
          }
          if (id.includes("node_modules/react-dom") || /node_modules\/react\//.test(id) || id.includes("node_modules/scheduler")) {
            return "react";
          }
          if (id.includes("node_modules/framer-motion")) return "motion";
          return undefined;
        },
      },
    },
  },
});
