# Production Hardening — Metrics Report

Consolidated results of the hardening phase (Increments A–G). Every number below
was **measured on the target machine** (HP OMEN 16, i5-13420H + RTX 4050,
CachyOS) unless explicitly marked _estimated_. Runtime figures are from the
**debug build** — a release build (LTO, stripped) is materially lighter,
especially backend RAM.

## How things were measured

- **nvidia-smi spawns** — a PATH shim wrapping `nvidia-smi` counted every spawn
  over a clean 30s window, hidden (`--minimized`) vs visible.
- **CPU / RSS / context-switches** — sampled from `/proc/<pid>/stat` and
  `/proc/<pid>/status` (main process + WebKit children).
- **Render counts** — the in-app `useRenderCount` instrumentation, read via
  `window.__renderCounts` in headless Chrome over ~11 telemetry ticks, reset
  after mount (steady state).
- **Bundle** — chunk byte sizes from `dist/`, cross-referenced against
  `index.html`'s module-preload graph.
- **Notification / overlay** — verified live (`tauri dev`): a backend event was
  captured on DBus (`org.freedesktop.Notifications` → "AC Power Connected") and
  the overlay window was confirmed created.

## Bundle (initial load)

| | Before | After | Δ |
|---|--:|--:|--:|
| **Initial JS (raw)** | 1148 KB | **732 KB** | **−416 KB (−36%)** |
| recharts `charts` chunk on first paint | yes (dashboard) | **no** | off critical path |

recharts (416 KB / 118 KB gz) was pulled by the dashboard's sparklines. After
migrating `Sparkline` + `LiveLineChart` to dependency-free SVG and deleting dead
chart code, `charts` is absent from the initial module-preload — it now loads
only on the battery / performance / storage-analyzer routes. The battery-events
effect-builder + waveform editors are lazy-split (load only when opened);
`battery-core` shrank 137 → 105 KB.

## Idle CPU & wakeups (background tray service, window hidden)

| Metric | Hidden (background) | Visible | Win |
|---|--:|--:|--:|
| **Context switches / wakeups** | **2.6 /s** | 108.8 /s | **~42× quieter** |
| **Main-process CPU** | **2.1 %** | 9.5 % | ~4.5× lower |
| **nvidia-smi spawns / 30s** | **7** (was 24) | 34 (was 39) | ~70% fewer |

When minimized to tray the app is nearly dormant (2.6 ctxt-sw/s). This came from
three changes: a single cached `nvidia-smi` chokepoint with a visibility-aware
TTL (1.4 s shown / 10 s hidden), visibility-aware telemetry polling
(1.5 s → 10 s when hidden), and a frontend gate that pauses GPU/thermal polls
while hidden. _(Debug build; release CPU is lower.)_

## Memory (RSS)

| Process | RSS (debug) | Note |
|---|--:|---|
| Rust backend | 201 MB | debug binary; **release is a fraction** (no symbols, optimized) |
| WebKitWebProcess (UI) | 261 MB | the webview — Tauri/WebKitGTK floor, not app code |
| WebKitNetworkProcess | 57 MB | webview support process |
| **Total (summed)** | **~520 MB** | summed RSS double-counts shared pages; true unique is lower |

**Honest framing of the "< 80 MB idle" target:** not achievable while the UI
webview is resident — WebKitGTK alone is ~300 MB. It is only reachable in a
*headless* state (no webview). The path to it, if desired, is to **destroy the
webview on hide-to-tray and recreate on show** (trades instant-show + retained
UI state for low idle RAM). Currently the webview stays alive when hidden so the
window reopens instantly.

## Desktop overlay RAM

- **Idle: 0 MB** — the overlay window does not exist between events.
- **During a ~3 s event:** a transient webview sharing the already-loaded
  react + framer-motion + battery-core chunks; auto-destroyed when the animation
  finishes.

## Render isolation (Performance page, per ~11 ticks, steady state)

| Component | Renders | Verdict |
|---|--:|---|
| PerformancePage / LiveGauges / chart wrapper | **0** | static ✅ |
| Sidebar / TopBar / AppShell | **0** | render once ✅ |
| PowerCenter (Automation + Nexus Profiles) | **0** | never on ticks ✅ |
| CpuGauge / GpuGauge / MemGauge / PerCoreLoad | ~1 / tick | necessary (live value changes) |

- **Largest render offender:** none — nothing re-renders that shouldn't. The
  per-tick gauges are required (their displayed value changes each tick).
- **Slowest component (render cost):** previously the recharts `LiveLineChart`
  (ResizeObserver + full SVG reconciliation every tick); now a plain-SVG chart,
  dramatically cheaper.

## Latencies

| Event | Latency | Source |
|---|--:|---|
| Battery event detection | **≤ 2 s** | dedicated `/sys` battery watcher (2 s poll) — measured cadence |
| Native notification (detect → desktop) | ~milliseconds | DBus `Notify` (verified live) |
| Overlay animation (detect → window shown) | ~100s of ms _(estimated)_ | webview window spawn (creation verified) |
| Startup (launch → backend ready) | ~0.3–2.3 s | debug; dominated by first-run disk cache |

UI FPS + worst frame-time are available live in-app (Settings → Diagnostics,
`PerfOverlay`, rAF-based).

## What was deliberately not done (and why)

- **UPower DBus event-driven battery** — the 2 s `/sys` battery read is already
  cheap; DBus would mainly buy zero-wakeup idle. Reasonable follow-up.
- **Crash auto-restart** — belongs at the packaging layer (a systemd user
  service with `Restart=on-failure`), not in-process self-restart.
- **Headless sound** (no window at all) — needs native Rust audio; Web Audio
  needs a gesture-unlocked webview. Sound works today inside the app and while
  hidden-to-tray (the webview stays alive).
- **Migrating the remaining recharts charts** (thermal-dashboard,
  storage-analyzer, battery) — all on lazy routes, off the critical path.
