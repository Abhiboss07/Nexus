# Nexus Control Center

> A next-generation Linux desktop control center — built to surpass HP OMEN Gaming Hub, ASUS Armoury Crate, Lenovo Vantage, Alienware Command Center, MSI Center and Razer Synapse.

**Phase 1 — Foundation, Design System & Application Shell.** This phase delivers a visually stunning, technically scalable foundation: design system, theme engine, app shell, navigation, command palette, dashboard, glassmorphism + animation + background systems. No hardware features yet — every module is scaffolded to receive them without refactoring.

---

## Quick start

```bash
# 1. Frontend (runs today — no Rust required)
npm install
npm run dev          # → http://localhost:1420

# 2. Full desktop app (requires Rust toolchain)
#    Install Rust: https://rustup.rs  + Tauri Linux deps:
#    https://tauri.app/start/prerequisites/
npm run tauri icon   # generate app icons (one-time)
npm run tauri:dev    # launches the native window
npm run tauri:build  # produces .deb / .rpm / .AppImage
```

> Rust/Cargo was **not** installed in the bootstrap environment, so the desktop
> shell is wired and ready but unbuilt. The React frontend runs fully in the
> browser via `npm run dev`.

---

## 1. Folder structure

```
nexus-control-center/
├─ index.html                     # Vite entry, sets default data-theme
├─ vite.config.ts                 # Tauri-aware Vite config (port 1420, chunking)
├─ tailwind.config.ts             # All utilities mapped to CSS-variable tokens
├─ tsconfig.json                  # Strict TS, @/* path alias
│
├─ src/
│  ├─ main.tsx                    # React root + global CSS imports
│  │
│  ├─ app/                        # Application composition root
│  │  ├─ App.tsx                  # Providers + RouterProvider
│  │  ├─ providers.tsx            # TanStack Query (data layer)
│  │  └─ router.tsx               # Code-split route table
│  │
│  ├─ config/                     # Declarative registries (single sources of truth)
│  │  ├─ navigation.tsx           # Pages → sidebar + router + palette
│  │  ├─ themes.ts                # Theme metadata
│  │  ├─ backgrounds.ts           # Ambient background modes
│  │  └─ commands.tsx             # Command palette actions
│  │
│  ├─ store/                      # Zustand state slices
│  │  ├─ theme-store.ts           # Theme engine + persistence
│  │  └─ ui-store.ts              # Sidebar / palette / overlays
│  │
│  ├─ hooks/
│  │  └─ use-hotkeys.ts           # Global keyboard layer (⌘K, leader keys)
│  │
│  ├─ lib/
│  │  ├─ cn.ts                    # clsx + tailwind-merge
│  │  ├─ motion.ts                # Centralized motion language (variants/springs)
│  │  └─ mock-data.ts             # Phase-1 telemetry stand-ins
│  │
│  ├─ components/
│  │  ├─ ui/                      # Design-system primitives
│  │  │  ├─ glass.tsx             # GlassSurface / GlassCard / GlassPanel
│  │  │  ├─ button.tsx  badge.tsx  tooltip.tsx  kbd.tsx  skeleton.tsx
│  │  │  ├─ ring-gauge.tsx  sparkline.tsx
│  │  ├─ cards/                   # Premium dashboard card variants
│  │  │  ├─ metric-card.tsx  status-card.tsx  health-card.tsx
│  │  │  ├─ analytics-card.tsx  action-card.tsx (+ QuickLaunchCard)
│  │  ├─ background/              # Dynamic background engine
│  │  │  ├─ background-canvas.tsx  particle-field.tsx
│  │  ├─ command/
│  │  │  └─ command-palette.tsx   # ⌘K palette (cmdk + Radix Dialog)
│  │  └─ shell/                   # Persistent chrome
│  │     ├─ app-shell.tsx  sidebar.tsx  topbar.tsx  theme-switcher.tsx
│  │     ├─ page-header.tsx  coming-soon.tsx  route-fallback.tsx
│  │
│  ├─ pages/                      # One file per route (lazy-loaded)
│  │  ├─ dashboard.tsx            # Full command-center layout
│  │  └─ performance · rgb · battery · storage · tasks
│  │     · doctor · game · ai · settings
│  │
│  └─ styles/
│     ├─ tokens.css               # ★ Design tokens + all 5 themes
│     └─ base.css                 # Tailwind layers + Glass Engine utilities
│
└─ src-tauri/                     # Tauri v2 backend (Rust)
   ├─ Cargo.toml  build.rs  tauri.conf.json
   ├─ capabilities/default.json   # Permission model
   └─ src/{main.rs, lib.rs}       # IPC entry + example `app_info` command
```

## 2. Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      Tauri v2 (Rust core)                      │
│   window mgmt · IPC · OS plugin · [Phase 2: hardware modules]  │
└───────────────────────────────┬──────────────────────────────┘
                                 │  typed IPC commands
┌───────────────────────────────▼──────────────────────────────┐
│                    Data layer — TanStack Query                 │
│        query keys ↔ Tauri commands (mock data in Phase 1)      │
└───────────────────────────────┬──────────────────────────────┘
                                 │
┌──────────────┬─────────────────▼─────────────┬───────────────┐
│  Zustand     │     React 19 component tree     │  Design tokens │
│  theme · ui  │  Shell → Pages → Cards → UI     │  CSS variables │
│ (persisted)  │  Framer Motion · Radix · cmdk   │  → Tailwind    │
└──────────────┴────────────────────────────────┴───────────────┘
```

**Why it scales to 100k+ users / 100+ features without refactoring**

- **Feature-based, registry-driven.** Adding a page = one entry in `config/navigation.tsx`; sidebar, router and command palette update automatically.
- **Single source of truth for visuals.** Every color/space/shadow is a CSS variable; themes only swap variables. No hardcoded values anywhere.
- **Strict separation of layers.** UI never talks to hardware — it talks to TanStack Query, which talks to typed Tauri commands. Phase 2 swaps mock query functions for real IPC; components don't change.
- **Code-splitting per route** keeps the shell instant regardless of feature count.
- **Plugin-ready.** `config/*` registries + the capability model are the seams a future plugin system extends.

## 3. Design system

All tokens live in `src/styles/tokens.css` and are surfaced through Tailwind in `tailwind.config.ts`.

| System | Tokens | Notes |
|---|---|---|
| **Color** | `--color-*` (canvas, surface{,-raised,-sunken}, border, content, accent ramp, iris, semantic) | Stored as RGB channels → opacity modifiers work (`bg-surface/60`) |
| **Typography** | `--font-*`, `--text-2xs…5xl` | Inter (UI) · Clash Display (display) · JetBrains Mono |
| **Spacing** | `--space-2xs…3xl` | 8-pt grid with sub-steps |
| **Radius** | `--radius-xs…2xl, full` | |
| **Elevation** | `--elevation-1…4` | Layered ambient + key shadows, theme-aware |
| **Shadow / Glow** | `--shadow-glow{,-strong}`, `--shadow-inset` | Accent-driven glow |
| **Glass** | `--glass-blur{,-strong}`, `--glass-*-opacity` | See Glass Engine below |
| **Motion** | `--duration-*`, `--ease-{smooth,spring,snap}` | Mirrored in `lib/motion.ts` |
| **Layout** | `--sidebar-width*`, `--topbar-height`, `--z-*` | z-index ladder included |

**Accessibility:** `:focus-visible` rings on all interactives, `prefers-reduced-motion` honored at the token layer + a user-controlled `reducedMotion` flag, ARIA-correct Radix primitives, semantic color contrast tuned per theme.

## 4. Theme system

Five themes — **Nexus Dark** (default), **Aurora Light**, **OLED Black**, **Cyberpunk**, **Nexus RGB** — each a complete token override under `[data-theme="…"]`. Switching is **instant**: `theme-store` sets `data-theme` on `<html>`, toggles a 240ms `theme-animating` class for a deliberate (not janky) transition, and persists via Zustand. Six **background modes** (Static, Gradient, Aurora, Mesh, Particle Field, Cyber Grid) are GPU-cheap CSS except the opt-in canvas particle field.

## 5. State management

- **`theme-store`** — theme, background, density, reduced-motion. Persisted (`nexus.theme`).
- **`ui-store`** — sidebar expansion (persisted), command palette + overlays (ephemeral).
- **TanStack Query** — all server/hardware state. Phase-2 query functions call Tauri commands.

Local component state stays local; nothing global that doesn't need to be.

## 6–11. Components, navigation, palette, dashboard, animation

- **Glass Engine** — `GlassSurface`/`GlassCard`/`GlassPanel` + `GlassTooltip`/`GlassDropdown`/`GlassDialog` patterns via `.glass`, `.glass-edge`, `.grain` utilities (tint + blur + specular edge + film grain).
- **Navigation** — Arc/Linear/Notion-inspired sidebar: spring expand/collapse, animated active pill (`layoutId`), rail indicator, collapsed tooltips, keyboard nav, grouped sections.
- **Top bar** — global search, command palette trigger, quick actions, theme switcher, notifications, profile menu; draggable window region.
- **Command palette (⌘/Ctrl+K)** — Raycast/VS Code-style; navigate anywhere, run actions, switch theme/background; fuzzy search, full motion.
- **Dashboard** — futuristic command center: CPU/GPU/Memory/Thermals metric cards, system-load analytics, radial health, storage/battery/network/RGB status, recent activity, weather, quick action.
- **Animation** — one motion language in `lib/motion.ts`: page transitions, sidebar springs, hover lifts, card interactions, skeleton loaders, staggered reveals. Subtle, premium, never excessive.

## 12. Production-ready code

Strict TypeScript, `class-variance-authority` for variant APIs, `forwardRef` primitives, Radix for a11y, memoized background, code-split routes, custom scrollbars, deterministic mock data behind real query shapes.

## 13. Implementation plan

| Phase | Scope |
|---|---|
| **1 — Foundation (this)** | Design system, theme engine, shell, nav, palette, dashboard, animation, backgrounds, Tauri scaffold |
| **2A — Telemetry engine** ✅ | Modular Rust telemetry backend (`/proc` + `/sys` + `nvidia-smi`), hardware discovery + `HardwareProfile`, streaming IPC, live frontend |
| **2B — Control abstraction** ✅ | Capability detection, controller traits, driver registry, vendor controllers (interfaces) + capability-gated UI — no writes |
| **3.1 — RGB control** ✅ | Real keyboard RGB writes (omen-rgb-keyboard + OpenRGB), 11 effects, profiles, presets, theme import/export, safe write layer |
| **3.2 — Power & profiles** ✅ | Power profiles (power-profiles-daemon), Nexus profiles, automation rules, Power Center UI |
| **3.3A — Battery intelligence** ✅ | Health/wear/score, lifespan prediction, degradation tracking, recommendations, report export |
| **3.4A — Fan & thermal intelligence** ✅ | Real fan RPM telemetry, capability inspector, thermal scoring/recommendations, fan-profile visualizer — read-only |
| **3.4B — Fan control** ✅ | Real fan writes (Victus-S verified), drag-and-drop curve editor, presets, thermal profile, max-fan, safety limits — see [docs/FAN_INTERFACE.md](docs/FAN_INTERFACE.md) |
| **4.0 — GPU & Gaming** ✅ | GPU discovery + intelligence, capability matrix, game scanner, per-game profiles, MangoHud overlay |
| **4.5 — System Integrations** ✅ | Detects 16 ecosystem tools (MangoHud/Gamescope/GameMode/OpenRGB/CoolerControl/LACT/Steam/Lutris/Heroic/Bottles/Docker/Podman/Flatpak/Snap/NVIDIA-CTK/Wayland-X11) |
| **5.0 — Intelligence Core** ✅ | Reasoning layer: health/recommendations/trends/maintenance/bottlenecks/automation + deterministic NL command layer — evidence + confidence, no LLM |
| **5.5 — Production Desktop** ✅ | Full Tauri build (webkit2gtk-4.1), tray + autostart + single-instance, setup wizard, health check, diagnostics export, logging + crash recovery — see [docs/PRODUCTION.md](docs/PRODUCTION.md) |
| **3.3B+ — More writes** | Battery charge limit (where supported), GPU/TDP tuning |
| **3 — Feature modules** | Performance, Battery, Storage, Task Manager, System Doctor — full UIs on live data |
| **4 — Intelligence** | Game Center (Steam/Lutris), AI Assistant (on-device options) |
| **5 — Extensibility** | Profile system, plugin runtime + marketplace, theme sharing, auto-update |

---

## Telemetry engine (Phase 2A)

A dependency-light Rust backend (`src-tauri/src/telemetry/`) reads Linux
interfaces directly — the most efficient path, no heavy crates:

```
telemetry/
├─ types.rs        Serializable contracts (camelCase) mirrored in src/lib/telemetry-types.ts
├─ hardware.rs     DMI/vendor discovery → HardwareProfile (Omen/Victus/ROG/TUF/Legion/Alienware/Dell/Generic)
├─ sysfs.rs        Resilient /proc + /sys read helpers
├─ hwmon.rs        Unified hwmon scan (temps + fans, label-resolved)
├─ collectors.rs   Per-subsystem: CPU (/proc/stat, cpufreq, RAPL), GPU (nvidia-smi / amdgpu sysfs),
│                  memory (/proc/meminfo), storage (df + diskstats + smartctl), battery (power_supply),
│                  network (/proc/net/dev), fans, thermals
└─ service.rs      Polling engine + 120-point history ring buffer; coarse cadence for slow sources
```

**Streaming:** a background thread emits a `telemetry://snapshot` event each tick
(default 1.5 s, runtime-adjustable). **Commands:** `get_snapshot`, `get_history`,
`get_hardware_profile`, `set_poll_interval`, `get_latency`.

**Frontend bridge:** `TelemetryProvider` subscribes to the stream into a Zustand
store; pages read via `useCpu()/useGpu()/useBattery()/…`. Outside Tauri (browser
`npm run dev`) it transparently falls back to a demo generator — the top-bar badge
shows **Live** vs **Demo**. Wired live: Dashboard, Performance, Battery, Storage,
Task Manager summaries. (Process enumeration & per-folder disk scan are later phases.)

**Efficiency:** cheap `/proc`+`/sys` reads every tick; storage/SMART refresh on a
coarse cadence; GPU via a single `nvidia-smi` query; history capped at 120 points.

**Verified data sources** (on an HP OMEN 16, Intel + RTX 4050, CachyOS): coretemp,
nvme Composite, battery µWh (health ≈ 86%), `nvidia-smi` CSV, `/proc/stat`,
`/proc/net/dev`. Fan RPM requires the `hp-wmi` platform driver (absent here →
reported empty, never faked).

## Hardware control abstraction (Phase 2B)

A layered, **vendor-neutral** control framework (`src-tauri/src/control/`). The UI
reasons only about *capabilities* — no vendor or driver names leak into it.

```
control/
├─ traits.rs        Controller hierarchy: RgbController · FanController · PowerController
│                   · BatteryController · MuxController, + ControlError / ControlOutcome
├─ capabilities.rs  HardwareCapabilities (per-domain CapabilityStatus: available / controllable
│                   / driver / notes) — the serializable contract the UI gates on
├─ detector.rs      CapabilityDetector over a SystemProbe trait (LiveProbe / MockProbe) → testable
├─ controllers/     OmenController (hp-wmi) · OpenRgbController · GenericController (sysfs)
├─ registry.rs      DriverRegistry::resolve(profile, caps) → VendorController bundle
└─ service.rs       ControlService façade: capabilities + ControlAction dry-run preview
```

**Capability detection** probes: `platform_profile` / power-profiles-daemon, RAPL,
charge-threshold sysfs, hp-wmi, hwmon pwm, OpenRGB, supergfxctl/asus-wmi.
**Registry** attaches a controller per domain *only when controllable* — HP fan →
OmenController, else generic pwm; RGB → OpenRGB; power → vendor modes or
platform_profile. **IPC:** `get_capabilities`, `get_active_drivers`,
`preview_control_action` (validates + describes an action; **no writes in 2B**).

**Frontend gating:** `useCapability("fan")` + `<CapabilityGate>` dim/disable
controls with a reason tooltip; `<CapabilityBadge>` names the backing driver.
RGB Studio, Performance (fan), Battery (charge limit) and Settings are all gated
purely on capability flags.

**Testing strategy:** detection is unit-tested by injecting a `MockProbe` (virtual
fs + PATH) into the detector and registry — no hardware required (9 tests cover
power/fan/rgb/battery detection and driver resolution per vendor). Integration is
validated by a thin harness that runs `CapabilityDetector` + `TelemetryService`
against the real machine.

### Verified on real hardware ✅

The pure-logic backend (telemetry collectors + hardware discovery + the whole
control layer) was compiled and run on the target **HP OMEN 16** (i5-13420H +
RTX 4050, CachyOS): **0 warnings, 9/9 unit tests pass**, and a live snapshot reads
correctly — CPU 8C/12T @ 54 °C, RTX 4050 via NVML/`nvidia-smi` (45 °C, 1.76 W),
memory, battery (health 85.8 %, 71.2/83 Wh), 16 thermal sensors, fans 0
(no hp-wmi). Capabilities resolve accurately: power controllable
(power-profiles-daemon), fan/RGB/charge-limit/MUX correctly unavailable.

> Only the thin Tauri glue (`commands.rs`, `lib.rs`) is still uncompiled here —
> it needs `webkit2gtk-4.1` dev libs. Note: CPU package power (RAPL `energy_uj`)
> is root-only on modern kernels, so it reports `null` without elevated
> privileges — handled gracefully. Build the desktop app with Rust + Tauri Linux
> deps, then `npm run tauri:dev`.

## RGB control engine (Phase 3.1) — first real hardware writes

The first feature that writes to hardware, behind the `RgbController` trait
(`src-tauri/src/control/rgb/`):

```
rgb/
├─ color.rs       Rgb + HSV→RGB; driver hex encoding (verified against driver source)
├─ effects.rs     The 11 effects + speed(0–100→1–10) & OpenRGB mode mapping
├─ safe_writer.rs Allowlisted · transactional · rolled-back sysfs writes over an FsOps trait
├─ omen.rs        OmenRgbController → /sys/.../omen-rgb-keyboard/rgb_zones/{zoneNN,all,brightness,animation_mode,animation_speed}
├─ openrgb.rs     OpenRgbController → portable OpenRGB CLI
├─ profiles.rs    RgbProfile, built-in presets, store, theme import/export
└─ engine.rs      RgbEngine façade (apply/off/state/presets/profile CRUD)
```

**Effects** (native, in-kernel animation): `static · breathing · rainbow · wave ·
pulse · chase · sparkle · candle · aurora · disco · gradient`.

**Safe write layer** — confines writes to one allowlisted base dir (no `/` or
`..`), applies multi-attribute changes **transactionally**, and **rolls back** on
any failure; maps EACCES→PermissionDenied, ENOENT→DriverUnavailable. **IPC:**
`rgb_apply`, `rgb_off`, `rgb_state`, `rgb_presets`, and profile
list/save/apply/delete/export/import.

**UI:** RGB Studio drives it live (debounced auto-apply), with capability gating,
the 11 effects sourced from the detected capability, presets, save-scene, theme
import/export, and friendly error surfacing (e.g. "add your user to the `input`
group"). Outside Tauri it stays a pure preview.

### Verified on the real OMEN keyboard ✅

`omen-rgb-keyboard` v1.5 driver detected (4 zones); capability reports controllable
with the correct 11 effects. The controller **reads back live zone colors**, and an
`apply()` against real sysfs hit the actual permission boundary, mapped cleanly to
`PermissionDenied`, and left state **byte-for-byte unchanged** (atomic/rollback
proven on hardware — lighting untouched). **28 backend unit tests pass** (19 new
for RGB: color/effects/safe-writer rollback/controller/profiles). Writes
require membership in the `input` group (the driver's sysfs is `rw-rw-r-- root:input`)
or elevated privilege.

---

## Power & Performance engine (Phase 3.2)

Real power-profile control + composable system profiles + automation
(`src-tauri/src/control/{power,nexus,automation}`):

```
power/      ppd.rs (power-profiles-daemon CLI) · controllers.rs
            (Linux/Omen/Generic PowerController) · engine.rs (validate+verify+rollback, PowerInfo)
nexus.rs    NexusProfile (Gaming/Coding/Streaming/Battery Saver/Custom) — composes power + RGB; persisted
automation.rs  Trigger/Rule/AutomationConfig + pure evaluator + live context gathering
```

**Power:** `LinuxPowerController` (power-profiles-daemon), `OmenPowerController`
(`platform_profile`), `GenericPowerController` (`platform_profile`→cpufreq). The
`PowerEngine` validates the target, applies, **verifies** the switch and **rolls
back** on mismatch. **IPC:** `get_power_info`, `get_current_profile`,
`get_available_profiles`, `set_profile`.

**Nexus profiles:** one tap sets a power profile + RGB look (fan/GPU reserved).
Built-ins always present; edits/custom persisted. **IPC:** `list_nexus_profiles`,
`apply_nexus_profile`, `save/delete_nexus_profile`, `get_active_profile`.

**Automation:** rules map a condition (process launched, battery below %, AC
state) → Nexus profile; a background watcher gathers live context, evaluates
(priority-ordered, opt-in) and applies on change. **IPC:** `get/set_automation`.

**Capability-driven UI:** the Power Center renders exactly the profiles the active
driver reports — no `platform_profile` here, so no vendor Silent/Turbo modes are
shown. One-click switching (optimistic + animated), per-profile battery/perf
impact previews, CPU driver + AC/battery state, the five Nexus profiles, and the
automation panel. Zustand `control-store` + `useControl` hooks; demo fallback
outside Tauri.

### Verified on real hardware ✅

`power-profiles-daemon` detected, profiles parsed (performance/balanced/power-saver,
`intel_pstate`, AC online). `PowerEngine.set("balanced")` (the current profile,
idempotent) **succeeded through the validated/verified/rolled-back path** — proving
real power writes work **unprivileged** here (polkit), unlike RGB. **34 backend
unit tests pass** (6 new: Nexus built-ins + automation evaluator priority/skip/
disable).

---

## Battery & Thermal Intelligence (Phase 3.3A / 3.4A — read-only)

```
control/battery/   analytics.rs (pure: health/wear/score/runtime/lifespan)
                   engine.rs (BAT1 reader, recommendations, persisted history, Markdown export)
control/fan/       engine.rs (FanThermalEngine: RPM telemetry, capability inspector,
                   thermal scoring + recommendations, temp↔fan correlation)
                   control.rs (Phase 3.4B — PREPARED write engine, not wired)
```

**Battery:** state-of-health, wear %, 0–100 score + grade, runtime estimate,
**lifespan prediction** (translates health↔cycles when the EC reports 0),
capacity-**degradation trend** from a persisted history log, smart
recommendations, and **Markdown report export**. **IPC:** `get_battery_report`,
`get_battery_history`, `export_battery_report`.

**Fan & thermal:** the OMEN fan RPMs (not in hwmon) now flow through the telemetry
stream; a **capability inspector** reports every `omen-rgb-keyboard/fan/*` node
(present / writable / value / format), with a **safe write-permission probe**
(opens O_WRONLY without writing). Thermal health score + recommendations + a
temp↔fan-RPM history graph + fan-profile visualizer. **IPC:** `get_fan_info`,
`get_thermal_report`. All **read-only**.

**Phase 3.4B (prepared, not active):** `fan/control.rs` implements fan writes
(thermal_profile / fan_curve / max_fan) with the RGB safety model — validation,
transactional SafeWriter, **verify-after-write + rollback**, EACCES→PermissionDenied
— unit-tested against a mock FS. It is **not exposed via any Tauri command** until
explicitly activated.

### Verified on real hardware ✅

- **Battery:** WK06083XL — score 86/100 (Good), health 85.8%, wear 14.2%,
  lifespan ~144 cycles to EOL, correct "avoid 100%" recommendation.
- **Fan discovery:** cpu 2000 / gpu 2300 RPM live; all 7 attributes inspected;
  capabilities detected (curve 2–8 pts, profiles performance/normal/silent); the
  write-permission probe correctly reported `writable=false` (needs `input` group)
  **without writing**. Thermal score 100/100 (cpu 49 / gpu 41 / ssd 40 °C).
- **48 backend unit tests pass** (battery analytics/engine, fan discovery/scoring,
  and the prepared fan-control write engine incl. rollback + permission).

---

## GPU & Gaming Engine (Phase 4.0 — discovery + intelligence, capability-first)

```
control/gpu/    engine.rs — GpuInfo (nvidia-smi), GpuCapabilities (no assumptions),
                GpuIntelligence (health/thermal/efficiency/gaming-readiness, bottleneck, VRAM pressure)
control/games/  scanner.rs (Steam .acf + libraryfolders, Lutris) · profiles.rs (per-game
                RGB/power/fan/env + launch builder) · mangohud.rs (detect + config presets)
```

**GPU:** live temp/util/clocks/VRAM/power/PCIe/CUDA via `nvidia-smi`; four intelligence
scores + bottleneck + VRAM-pressure + recommendations. **Capability discovery makes no
assumptions** — it reports `powerLimitControl`/`tgpControl`/`muxSwitching`/`advancedOptimus`
only if a real interface exists. **IPC:** `get_gpu_info`, `get_gpu_capabilities`,
`get_gpu_intelligence`.

**Gaming Center:** scans Steam (`appmanifest_*.acf` across all library folders, filters
Proton/runtimes) + Lutris; detects launchers (Steam/Lutris/Heroic/GameMode/Gamescope/
MangoHud/PRIME). Per-game profiles compose **RGB + power + fan + env + PRIME/GameMode/
MangoHud**, with a launch-command + **Steam launch-options** builder, applied on launch.
**MangoHud** overlay detection + config presets. **IPC:** `scan_games`,
`get_game_launchers`, `get/save/delete_game_profile`, `game_launch_info`,
`apply_game_profile`, `get_mangohud_status`, `mangohud_apply`.

### Verified on real hardware ✅

RTX 4050 (driver 610.43.02, CUDA 13.3): all telemetry parsed, PCIe gen4×8, mem ~16 Gbps.
**Capability matrix matches reality exactly** — power-limit/TGP **N/A → unsupported**, MUX
**none** (Optimus/PRIME only), Dynamic Boost + RTD3 + NVML detected. Game scan found the
real Steam entries (Proton 11 + Steam Linux Runtime → correctly filtered as tools, 0 real
games), launchers detected (Steam/Lutris/GameMode/PRIME present, MangoHud absent → gated).
**60 backend unit tests pass.** No fake functionality, no vendor assumptions.

---

## Intelligence Core (Phase 5.0 — on-device reasoning, no LLM)

A deterministic reasoning layer above every engine (`control/intelligence/`).
**No LLM, no cloud, no hardcoded responses** — every output is computed from real
telemetry + the existing engines, and carries a **confidence** and the concrete
**evidence** (metric / value / threshold) it was derived from.

```
intelligence/
├─ health.rs          System Health Engine — weighted subsystem scoring
├─ recommendations.rs evidence-based, capability-aware suggestions
├─ trends.rs          Historical Analytics — least-squares direction over history
├─ maintenance.rs     Predictive Maintenance — battery EOL, storage, thermal drift
├─ bottlenecks.rs     holistic Bottleneck Detection (CPU/GPU/VRAM/memory/disk)
├─ automation.rs      Automation Rule suggestions from observed patterns
├─ nlp.rs             deterministic Natural Language Command Layer (intent → action)
└─ engine.rs          aggregates all of the above into one report
```

The engines are **pure functions**; the IPC layer feeds them a live telemetry
snapshot + history (from the TelemetryService) and the engine outputs (battery /
thermal / GPU intelligence + capabilities, from the ControlService). **IPC:**
`get_intelligence`, `nlp_command`. **UI:** an Intelligence Dashboard — health
score + subsystem bars, evidence-chipped recommendations, trend sparklines with
direction, maintenance predictions with ETA, automation suggestions, and a
**natural-language command bar** that parses intent and executes it via the
existing control IPC.

### Verified on real hardware ✅

On the OMEN: health **97/100** (per-subsystem breakdown), bottleneck **none**,
recommendation "System optimal" with evidence (CPU 48°C vs 82°C threshold), trend
regressions per metric, battery EOL prediction (**~144 cycles, 81% conf**), and the
NL layer answering **"how hot is the CPU?" → "CPU 48°C, GPU 41°C"** from live
telemetry. **79 backend unit tests pass** (recommendations, trends, bottlenecks,
health, maintenance, automation, NLP).

---

Built with Tauri v2 · React 19 · TypeScript · Vite · TailwindCSS · Zustand · TanStack Query · Framer Motion · Radix UI · cmdk · Lucide · Recharts.
