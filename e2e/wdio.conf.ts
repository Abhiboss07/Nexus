/**
 * WebdriverIO config for Nexus desktop end-to-end smoke tests (finding H2).
 *
 * Drives the *packaged* Tauri binary through `tauri-driver` (WebKitWebDriver),
 * so these tests exercise the real window, the real IPC bridge, and the real
 * backend — not the browser dev fallback.
 *
 * Run locally:   npm run build && cargo tauri build && npm run e2e
 * Run headless:  xvfb-run -a npm run e2e         (CI)
 *
 * Requires: tauri-driver (`cargo install tauri-driver`) and WebKitWebDriver
 * (package `webkit2gtk-driver` / `webkit2gtk4.1-driver`).
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";

const APP_BINARY =
  process.env.NEXUS_BINARY ??
  path.resolve(__dirname, "../src-tauri/target/release/nexus-control-center");

let tauriDriver: ChildProcess;

export const config: WebdriverIO.Config = {
  runner: "local",
  specs: ["./specs/**/*.spec.ts"],
  maxInstances: 1,
  capabilities: [
    {
      // @ts-expect-error tauri:options is a custom capability
      "tauri:options": { application: APP_BINARY },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: { ui: "bdd", timeout: 60_000 },

  // Boot tauri-driver before the session, tear it down after.
  onPrepare: () => {
    spawnSync("cargo", ["tauri", "--version"], { stdio: "ignore" });
  },
  beforeSession: () => {
    tauriDriver = spawn("tauri-driver", [], {
      stdio: [null, process.stdout, process.stderr],
    });
  },
  afterSession: () => {
    tauriDriver?.kill();
  },
};
