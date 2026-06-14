# Nexus Control Center — Production Guide

Build, packaging, and release for the desktop application (Phase 5.5).

## 1. Prerequisites

**Toolchains**
- Node 20+ and npm
- Rust (stable) via rustup — `cargo`, `rustc`
- Tauri CLI v2 — `cargo install tauri-cli --version "^2.0" --locked`

**System libraries (Arch / CachyOS)** — Tauri's Linux WebView + tray:
```bash
sudo pacman -S --needed \
  webkit2gtk-4.1 gtk3 libsoup3 librsvg \
  libayatana-appindicator base-devel
```
(Debian/Ubuntu equivalents: `libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev librsvg2-dev libayatana-appindicator3-dev build-essential`.)

> Verify: `pkg-config --modversion webkit2gtk-4.1` should print a version (≥ 2.40).

## 2. Build

```bash
npm install                 # frontend deps (once)

# Development (hot-reload window):
cargo tauri dev

# Frontend only, in a browser (degrades to a live demo when no Tauri):
npm run dev                 # → http://localhost:1420

# Type-check + production frontend bundle:
npm run build

# Compile the Rust backend only (fast smoke of the IPC layer):
cd src-tauri && cargo build

# Full release bundle (.deb / .rpm / .AppImage):
cargo tauri build
```

Release artifacts land in:
```
src-tauri/target/release/nexus-control-center                      # self-contained binary
src-tauri/target/release/bundle/deb/*.deb                          # ✅ built
src-tauri/target/release/bundle/rpm/*.rpm                          # ✅ built
```

Install: `sudo pacman -U *.deb` won't work on Arch — use the binary directly, or
`sudo dpkg -i *.deb` on Debian/Ubuntu, `sudo rpm -i *.rpm` on Fedora. On
Arch/CachyOS the simplest install is the self-contained release binary (copy to
`/usr/local/bin` + the provided `.desktop` file).

> **AppImage** is omitted from the default `targets` because the `linuxdeploy`
> bundler step fails on bleeding-edge glibc/FUSE setups (CachyOS). To produce one,
> add `"appimage"` back to `bundle.targets` and run the build in a clean container
> (or `export APPIMAGE_EXTRACT_AND_RUN=1` so the downloaded tools run without FUSE).

## 3. App icons

Generated from `src-tauri/icons/icon.svg`:
```bash
cd src-tauri/icons
rsvg-convert -w 1024 -h 1024 icon.svg -o icon-1024.png
# regenerate the set, or simply: cargo tauri icon icon-1024.png
```
`cargo tauri icon <png>` produces every required size + `.ico`.

## 4. Packaging & desktop integration

- **Targets** are set in `tauri.conf.json` → `bundle.targets`: `deb`, `rpm`, `appimage`.
- Installing the `.deb`/`.rpm` registers a `.desktop` entry, the app icon, and the
  MIME/category (`Utility`) — it appears in your application menu.
- **System tray:** built in. Closing the window **hides to tray** (the control
  center keeps running for the automation watcher); quit from the tray menu.
- **Autostart:** toggled in Settings → Application or the first-run wizard
  (`tauri-plugin-autostart` writes a `~/.config/autostart/*.desktop` entry).
- **Single instance:** launching a second copy focuses the running window.
- **Permissions:** RGB/fan writes need the `input` group —
  `sudo usermod -aG input $USER` then re-login. Surfaced in the setup wizard and
  System Doctor; telemetry and power profiles work without it.

## 5. Logging, diagnostics & crash recovery

- Logs: `~/.local/share/com.nexus.controlcenter/logs/nexus.log` (rotated at 1 MB).
- A panic hook records crashes; a `running.lock` marker detects unclean shutdowns
  and logs a recovery note on next start.
- **System Doctor** runs the live health check + permission validation and
  **exports a diagnostics report** (`nexus-diagnostics.md`: hardware, capabilities,
  permissions, health checks, recent log) — share it for support.
- The UI has a top-level error boundary that recovers from render errors.

## 6. Updates

`app_update_info` reports the current version + channel. The architecture is ready
for a signed in-app feed (`tauri-plugin-updater`); until an endpoint + public key
are configured, **no "update available" is ever shown** — updates ship via the
distro package or GitHub releases.

## 7. Release checklist

- [ ] `npm run build` — frontend type-checks and bundles cleanly.
- [ ] `cd src-tauri && cargo build` — backend compiles (no errors).
- [ ] `cargo test` (isolated logic) — all unit tests pass.
- [ ] Bump `version` in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (keep in sync).
- [ ] `cargo tauri build` — produces `.deb` / `.rpm` / `.AppImage`.
- [ ] Launch the release binary: window renders, telemetry badge shows **Live**,
      hardware profile correct in the top bar.
- [ ] System Doctor: health checks reflect the machine; export works.
- [ ] First-run wizard appears on a clean profile and completes.
- [ ] Tray: show/hide/quit work; close-to-tray works; single-instance focuses.
- [ ] Autostart toggle writes/removes `~/.config/autostart/`.
- [ ] Smoke each page against the live backend (no demo badge).
- [ ] Tag the release, attach the bundles, write release notes.
