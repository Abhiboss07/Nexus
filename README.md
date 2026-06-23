<div align="center">

# ⚡ Nexus Control Center

**A next-generation Linux control center for gaming laptops** — RGB, power, fans, battery, GPU, games and on-device intelligence, in one beautiful native app.

_Built to surpass HP OMEN Gaming Hub, ASUS Armoury Crate, Lenovo Vantage, Alienware Command Center, MSI Center and Razer Synapse — on Linux._

<br/>

![Tauri](https://img.shields.io/badge/Tauri-2.x-24C8DB?logo=tauri&logoColor=white)
![Rust](https://img.shields.io/badge/Rust-backend-000000?logo=rust&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-6-646CFF?logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind-tokens-06B6D4?logo=tailwindcss&logoColor=white)
![Platform](https://img.shields.io/badge/Platform-Linux-FCC624?logo=linux&logoColor=black)
![Tests](https://img.shields.io/badge/backend%20tests-159%20passing-3FB950)

</div>

---

## 📑 Table of contents

- [✨ Highlights](#-highlights)
- [🖼️ Screenshots](#️-screenshots)
- [🧭 Feature tour](#-feature-tour)
- [🚀 Quick start](#-quick-start)
- [🏗️ Architecture](#️-architecture)
- [🎨 Design system](#-design-system)
- [🔬 Verified on real hardware](#-verified-on-real-hardware)
- [🗺️ Roadmap](#️-roadmap)
- [📂 Project structure](#-project-structure)
- [📚 Documentation](#-documentation)
- [🧰 Tech stack](#-tech-stack)
- [📄 License](#-license)

---

## ✨ Highlights

| | |
|---|---|
| 🛡️ **No fake features** | Every control is **capability-gated** — Nexus probes the real driver/interface and only exposes what your hardware actually supports. Unavailable controls are dimmed with the reason, never faked. |
| 🔒 **Safe by design** | Hardware writes go through an allowlisted, **transactional SafeWriter** that verifies after writing and **rolls back** on any failure. Lighting/fans are left byte-for-byte unchanged if a write can't complete. |
| 🧠 **On-device intelligence** | Health scoring, bottleneck detection, predictive maintenance and a natural-language command bar — all **deterministic, evidence-based, no LLM, no cloud**. Every insight cites the metric it came from. |
| 🎮 **Gaming-grade** | Live MangoHud FPS capture, per-game profiles auto-applied on launch, "why FPS dropped" analysis (CPU/GPU/VRAM/thermal/memory/frame-pacing), and cross-session trends. |
| ⚡ **Fast & efficient** | Dependency-light Rust backend reads `/proc` + `/sys` + `nvidia-smi` directly. Selector-based React rendering means a CPU tick never re-renders the GPU widgets. |
| 🐧 **Vendor-neutral** | OMEN/Victus/ROG/TUF/Legion/Alienware/Dell/Generic discovery. The UI reasons about *capabilities*, so no vendor name leaks into it. |

---

## 🖼️ Screenshots

> _Drop UI captures into `docs/screenshots/` and reference them here._

<!--
<div align="center">
  <img src="docs/screenshots/dashboard.png" alt="Dashboard" width="800"/>
  <br/><em>Dashboard — live telemetry command center</em>
</div>
-->

| Dashboard | RGB Studio | Intelligence |
|:---:|:---:|:---:|
| _add image_ | _add image_ | _add image_ |

---

## 🧭 Feature tour

Each item below is a real, shipping page in the app.

| | Page | What it does |
|:--:|---|---|
| 📊 | **Dashboard** | System overview & live telemetry at a glance |
| ⚡ | **Performance** | CPU, GPU & power tuning with live charts and fan curves |
| 🌈 | **RGB Studio** | Lighting zones, 11 effects, profiles & theme sync |
| 🔋 | **Battery Center** | Health, wear, lifespan prediction, charge guidance & charging effects |
| 💾 | **Storage Center** | Drives, usage & SMART health |
| 🗂️ | **Storage Analyzer** | Treemap, largest files, duplicates & per-app usage |
| 📋 | **Task Manager** | Processes, services & live resource usage |
| 🩺 | **System Doctor** | Diagnostics, severity-ranked findings, fixes & optimization |
| 🧹 | **Linux Optimizer** | Reclaim memory & disk, prune packages, tame startup |
| 🐧 | **Linux Hub** | Services, containers, Flatpak & a unified update center |
| 🧩 | **Integrations** | Detects 16 ecosystem tools/runtimes with one-click install |
| 🎮 | **Game Center** | Library scan, per-game profiles & game boost |
| 🧠 | **Intelligence** | Reasoning, recommendations, trends & gaming analytics |
| ⚙️ | **Settings** | Preferences, 3 themes, plugins & diagnostics export |

---

## 🚀 Quick start

```bash
# ── Frontend only (runs in the browser, no Rust required) ──
npm install
npm run dev            # → http://localhost:1420  (Demo telemetry)

# ── Full native desktop app ──
# Prereqs: Rust toolchain (https://rustup.rs)
#          Tauri Linux deps  (https://tauri.app/start/prerequisites/)
#          incl. webkit2gtk-4.1
npm run tauri:dev      # launch the native window  (Live telemetry)
npm run tauri:build    # produce .deb / .rpm / .AppImage
```

> 💡 Outside Tauri, the React app transparently falls back to a **demo data
> generator** — the top-bar badge shows **Live** vs **Demo**, so the whole UI is
> explorable in a browser without any hardware.

---

## 🏗️ Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Tauri v2  (Rust core)                     │
│  telemetry · control · intelligence · gaming · notifications   │
│        SafeWriter · capability detection · SQLite store        │
└───────────────────────────────┬──────────────────────────────┘
                                 │  typed IPC commands + event stream
┌───────────────────────────────▼──────────────────────────────┐
│             Data layer — Zustand stores + TanStack Query       │
│       selector-based subscriptions  ·  Live ⇄ Demo fallback    │
└───────────────────────────────┬──────────────────────────────┘
                                 │
┌──────────────┬─────────────────▼─────────────┬────────────────┐
│  Zustand     │     React 19 component tree     │  Design tokens │
│ theme · ui   │  Shell → Pages → Cards → UI     │  CSS variables │
│ (persisted)  │  Framer Motion · Radix · cmdk   │  → Tailwind    │
└──────────────┴────────────────────────────────┴────────────────┘
```

**Principles that keep it scaling to 100+ features without refactoring:**

- 🧩 **Registry-driven** — adding a page is *one* entry in `config/navigation.tsx`; sidebar, router and command palette update automatically.
- 🎨 **Single source of visual truth** — every color/space/shadow is a CSS variable; themes only swap variables. No hardcoded values.
- 🧱 **Strict layer separation** — UI talks to stores/queries, which talk to typed IPC. Hardware names never reach the UI; it gates on *capabilities*.
- 🚀 **Code-split per route** — the shell stays instant regardless of feature count.
- 🔌 **Plugin-ready** — the `config/*` registries + capability model are the seams a plugin system extends.

---

## 🎨 Design system

All tokens live in `src/styles/tokens.css`, surfaced through Tailwind.

| System | Tokens | Notes |
|---|---|---|
| 🎨 **Color** | `--color-*` (canvas, surface, border, content, accent ramp, iris, semantic) | Stored as RGB channels → opacity modifiers work (`bg-surface/60`) |
| 🔤 **Type** | `--font-*`, `--text-2xs…5xl` | Inter (UI) · Clash Display · JetBrains Mono |
| 📐 **Spacing / Radius** | `--space-2xs…3xl`, `--radius-xs…2xl` | 8-pt grid with sub-steps |
| 🌑 **Elevation / Glow** | `--elevation-1…4`, `--shadow-glow` | Layered, theme-aware ambient + key shadows |
| 🧊 **Glass Engine** | `--glass-blur`, `--glass-*-opacity` | `.glass` · `.glass-edge` · `.grain` (tint + blur + specular edge + film grain) |
| 🎞️ **Motion** | `--duration-*`, `--ease-{smooth,spring,snap}` | Mirrored in `lib/motion.ts` |

🎭 **Themes (3):** **Nexus Dark** (default) · **OLED Black** · **Arctic** — each a complete token override. Switching is instant and persisted.
🌌 **Backgrounds:** GPU-cheap CSS ambient modes, plus an opt-in canvas particle field (auto-paused when the window is hidden/unfocused).
♿ **Accessibility:** `:focus-visible` rings everywhere, `prefers-reduced-motion` honored at the token layer + a user flag, ARIA-correct Radix primitives, per-theme contrast tuning.

---

## 🔬 Verified on real hardware

> Target machine: **HP OMEN 16** — Intel i5-13420H + NVIDIA RTX 4050, running **CachyOS**.

| Subsystem | Result on hardware |
|---|---|
| 🌈 **RGB** | `omen-rgb-keyboard` v1.5 (4 zones), 11 effects; live zone read-back; `apply()` hit the real permission boundary and **rolled back byte-for-byte** (atomic write proven). |
| ⚡ **Power** | `power-profiles-daemon` detected; `set("balanced")` succeeded through the **validate → verify → rollback** path, **unprivileged** (polkit). |
| 🔋 **Battery** | Health 85.8%, wear 14.2%, score 86/100, lifespan prediction ~144 cycles to EOL, correct "avoid 100%" guidance. |
| 🌬️ **Fans** | CPU 2000 / GPU 2300 RPM live; all attributes inspected; write-permission probe correctly reports `writable=false` **without writing**. |
| 🎮 **GPU/Games** | RTX 4050 (driver 610.x, CUDA 13.3) fully parsed; capability matrix matches reality (power-limit/TGP **N/A**, MUX **none**); Steam scan filters Proton/runtimes correctly. |
| 🧠 **Intelligence** | Health 97/100 with per-subsystem evidence; NL bar answers _"how hot is the CPU?"_ → _"CPU 48°C, GPU 41°C"_ from live telemetry. |

✅ **159 backend unit tests pass** · clippy clean · strict `tsc` + production build clean.

---

## 🗺️ Roadmap

Legend: ✅ shipped · 🚧 in progress · 🔭 planned

| Status | Milestone | Scope |
|:--:|---|---|
| ✅ | **Foundation** | Design system, theme engine, app shell, navigation, command palette, dashboard |
| ✅ | **Telemetry engine** | Rust backend (`/proc`+`/sys`+`nvidia-smi`), hardware discovery, streaming IPC, live frontend |
| ✅ | **Control abstraction** | Capability detection, controller traits, driver registry, capability-gated UI |
| ✅ | **RGB control** | Real keyboard writes (omen-rgb-keyboard + OpenRGB), 11 effects, profiles, SafeWriter |
| ✅ | **Power & profiles** | power-profiles-daemon, composable Nexus profiles, automation rules |
| ✅ | **Battery & thermal** | Health/wear/score, lifespan prediction, fan telemetry, thermal scoring, fan control |
| ✅ | **GPU & Gaming** | GPU intelligence, game scanner, per-game profiles, MangoHud overlay |
| ✅ | **System integrations** | Detects 16 ecosystem tools/runtimes with one-click install |
| ✅ | **Intelligence Core** | Health/recommendations/trends/maintenance/bottlenecks + NL command layer |
| ✅ | **Persistent telemetry store** | SQLite sessions, retention, hourly aggregation, query APIs |
| ✅ | **Gaming Intelligence v2** | Live MangoHud FPS, VRAM-bound + frame-pacing detection, auto game optimization |
| ✅ | **Production desktop** | Full Tauri build, tray + autostart + single-instance, setup wizard, diagnostics, crash recovery |
| 🔭 | **More writes** | Battery charge limit (where supported), GPU/TDP tuning |
| 🔭 | **Extensibility** | Plugin runtime + marketplace, theme sharing, auto-update |

---

## 📂 Project structure

```
Omen-Hub/
├─ src/                          # React 19 frontend
│  ├─ app/                       # Composition root (providers, router)
│  ├─ config/                    # Declarative registries (nav, themes, backgrounds, commands)
│  ├─ store/                     # Zustand slices (theme, ui, telemetry, install, notifications…)
│  ├─ hooks/                     # Telemetry, control, gaming, chart-history, hotkeys…
│  ├─ lib/                       # cn, motion language, IPC bindings, typed contracts
│  ├─ components/                # ui/ (Glass Engine + primitives), cards, shell, charts, intelligence…
│  ├─ pages/                     # One file per route (lazy-loaded)
│  └─ styles/                    # tokens.css (★ design tokens + themes) + base.css (Glass Engine)
│
├─ src-tauri/                    # Tauri v2 backend (Rust)
│  └─ src/
│     ├─ telemetry/              # hardware discovery, collectors, polling service, SQLite store, fps
│     ├─ control/                # traits, capabilities, controllers, rgb/ power/ battery/ fan/ gpu/ games/
│     ├─ intelligence/           # health, recommendations, trends, maintenance, bottlenecks, nlp
│     ├─ gaming.rs               # limiter detection + cross-session trend analysis
│     ├─ notifications.rs        # SQLite notification store
│     └─ lib.rs / commands.rs    # IPC surface + background watchers
│
├─ docs/                         # Hardware, production & release docs
└─ packaging/                    # Distribution assets
```

---

## 📚 Documentation

- 📘 [Production guide](docs/PRODUCTION.md) — building, packaging & runtime behavior
- 🔐 [Release hardening](docs/RELEASE_HARDENING.md) — signing, write-safety gates, CI
- 🖥️ [Supported hardware](docs/SUPPORTED_HARDWARE.md) — vendor/driver matrix
- 🌬️ [Fan interface](docs/FAN_INTERFACE.md) — the OMEN fan-control sysfs interface
- 🧪 [Product audit](docs/PHASE_5.6_PRODUCT_AUDIT.md) — feature/quality review

---

## 🧰 Tech stack

**Frontend** — React 19 · TypeScript (strict) · Vite 6 · TailwindCSS · Zustand · TanStack Query · Framer Motion · Radix UI · cmdk · Lucide · Recharts
**Backend** — Rust · Tauri v2 · rusqlite (bundled SQLite) · direct `/proc` + `/sys` + `nvidia-smi`/NVML

---

## 📄 License

This project is not yet licensed for redistribution — **© 2026 the Nexus Control Center authors, all rights reserved**. Open an issue if you'd like to discuss usage.

<div align="center">
<br/>
<sub>Built with ⚡ for the Linux gaming desktop.</sub>
</div>
