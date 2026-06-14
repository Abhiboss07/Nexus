# Supported Hardware Matrix

Nexus enforces a **default-deny write-safety gate** (`src-tauri/src/control/hardware_support.rs`).
Telemetry is read-only and safe everywhere; **hardware writes** (fan curves, RGB)
are enabled **only** through interfaces on a validated allowlist. Everything else
runs read-only. The running machine's resolved tier is reported by the
`get_compatibility` IPC command and included in the diagnostics export.

## Support tiers

| Tier | Meaning | Telemetry | Fan write | RGB write | Power profile |
|---|---|---|---|---|---|
| **Validated** | A reference board we directly test (DMI `board_name` ∈ allowlist) **and** a validated fan interface with a valid table | ✅ | ✅ | ✅ | ✅ (polkit) |
| **Compatible** | HP OMEN/Victus reaching a validated control interface (e.g. Victus-S fan iface, or `omen-rgb-keyboard`) | ✅ | ✅ *(only if fan iface validated)* | ✅ *(only if RGB platform validated)* | ✅ (polkit) |
| **Unknown** | Recognized HP OMEN/Victus, but **no** validated control interface present/confirmed | ✅ | ❌ | ❌ | ✅ if PPD present |
| **Unsupported** | Not an HP OMEN/Victus, or no controllable interface at all | ✅ | ❌ | ❌ | ✅ if PPD present |

Power profiles are intentionally **not** gated by this layer: they go through
`power-profiles-daemon`/polkit — a distro-standard, non-firmware, permission-
mediated path that is safe on any machine that exposes it.

## Validated allowlists (source of truth)

- **Fan interfaces:** `victus-s` (requires a driver-loaded valid fan table)
- **RGB platforms:** `omen-rgb-keyboard`
- **Reference boards:** `8BA9` (HP OMEN 16-wd0xxx)

Adding hardware to a tier is a deliberate, reviewed change to those constants
**after** validation on the device — never an automatic inference from a driver
flag.

## Fail-safe behavior (verified)

The gate keys off *authoritative* interface detection, not optimistic driver
flags. On the reference machine, when the fan interface **cannot be confirmed**
from the kernel log (e.g. a restricted environment where `dmesg`/`journalctl -k`
is unavailable), the gate resolves the fan interface to `unknown` and
**disables fan writes** while still allowing the confirmed RGB platform — i.e.
it degrades to read-only fan control rather than writing through an unconfirmed
interface. This is the intended C1 safety property and is asserted by the
runtime smoke tests (`src-tauri/src/runtime_smoke.rs`).

## Defense in depth

1. **Capability gating** — the gate forces `controllable=false` on capabilities
   it denies, so the **UI hides** the controls (no dead buttons).
2. **Backend refusal** — every fan/RGB write method calls `guard_fan()` /
   `guard_rgb()` and returns `ControlError::HardwareNotValidated` if denied,
   even if a caller bypasses the UI.
3. **SafeWriter** — allowlisted paths, transactional writes, verify-after-write,
   rollback on failure (unchanged from earlier phases).
