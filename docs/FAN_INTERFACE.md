# OMEN Fan Interface — Driver Contract & Capability Report

Reverse-engineered from the **actual driver source** (`omen-rgb-keyboard` v1.5,
DKMS, by *alessandromrc*) at
`/usr/src/omen-rgb-keyboard-1.4.r58.g03f3927/src/fan/omen_fan.c`, and validated
against the live hardware on this **HP OMEN 16-wd0xxx (CachyOS, kernel 7.0.11)**.
No formats are guessed — every rule below is taken from the driver implementation.

## TL;DR — Final recommendation

✅ **Full fan control is possible on this machine.** The driver detected the
**Victus-S WMI interface** with a **valid fan table**, which is exactly the
combination required for custom curves. Thermal profiles and max-fan also work.
The only prerequisite for *writing* is membership in the `input` group (the sysfs
nodes are `rw-rw-r-- root:input`).

The original `echo 1 > fan_curve_enable` → **`Invalid argument`** was **not** a
format problem — the enable handler rejects enabling when **no curve is set yet**
(`curve_num_points < 2`). The correct sequence is **write `fan_curve` first, then
`fan_curve_enable`** — which is what the Nexus engine does.

## Detected hardware (from the driver's own probe log)

```
omen_rgb_keyboard: Victus fan table loaded (cpu u8 range 0..62, gpu delta +0)
omen_rgb_keyboard: fan interface: Victus-S WMI (RPM read, max fan, curve)
```

| Property | Value |
|---|---|
| Fan interface (`fan_iface`) | `OMEN_FAN_IF_VICTUS_S` |
| Fan table (`fan_tbl_valid`) | **valid** (cpu u8 range 0..62, gpu delta +0) |
| `CONFIG_THERMAL` | `y` (required to enable a curve) |
| RPM nodes | cpu 2000 / gpu 2300 (live) |

> Interface detection at runtime: `fan_detect_iface()` issues
> `HPWMI_GM_VICTUS_FAN_SPEED_GET` → if it succeeds, **Victus-S**; else tries the
> classic query → **classic**; else **none**. Nexus reads the driver's logged
> result (`journalctl -k`) as the authoritative source, because **the sysfs
> attributes are created unconditionally** and their presence does *not* imply
> the feature works.

## Driver contract (per sysfs node)

| Node | Mode | Accepted input | Rules (from source) |
|---|---|---|---|
| `cpu_fan_rpm` / `gpu_fan_rpm` | R | — | `u32` RPM via WMI. |
| `thermal_profile` | RW | `performance` \| `normal` \| `silent` | Write via WMI `performance_set` (v1 byte, falls back to v0). **Read is EC-backed** and may return `unknown` if the EC byte doesn't map — *writes still work*. Not interface-gated. |
| `max_fan` | RW | `0` \| `1` | `kstrtoul`, `v?1:0`. Sets WMI `FAN_SPEED_MAX_SET`. **Disables any active curve** first. On Victus-S also fires `userdefine_trigger`. Returns `-EIO` on WMI failure. |
| `fan_curve` | RW | `"t:p t:p …"` | `sscanf("%d:%d")` per pair. **2–8 points** (`MAX_CURVE_POINTS=8`); `0 ≤ t ≤ 120`, `0 ≤ p ≤ 100`; `< 2` points ⇒ `-EINVAL`. Driver **sorts** points. Reads `(unset)` when empty. |
| `fan_curve_enable` | RW | `0` \| `1` | Enabling (`1`) requires **ALL**: `curve_num_points ≥ 2` **AND** `fan_tbl_valid` **AND** `fan_iface == VICTUS_S` **AND** `CONFIG_THERMAL`. Else `-EINVAL` (or `-ENODEV` without THERMAL). `-EBUSY` if `max_fan` is on. Writing `0` always disables and marks manual-off. |
| `fan_temp_zone` | RW | zone name \| `auto` | Binds the thermal zone the curve tracks; `auto` (`fan_temp_zone_bind_default`) by default. Relevant only while a curve is enabled. |

### Enable semantics (the crux)

```c
// fan_curve_enable_store, v == 1:
if (curve_num_points < 2 || !fan_tbl_valid || fan_iface != OMEN_FAN_IF_VICTUS_S)
    return -EINVAL;          // ← the "Invalid argument" you saw (no curve set)
if (v && max_fan_state) return -EBUSY;
```

**Correct ordering to apply a custom curve:**
1. `max_fan` → `0` (so enabling isn't `-EBUSY`)
2. `fan_curve` → `"45:30 60:55 75:80 88:100"` (sets `curve_num_points`)
3. `fan_curve_enable` → `1`

## Real hardware support matrix

| Capability | Supported here | Backed by | Notes |
|---|---|---|---|
| Read CPU/GPU RPM | ✅ | WMI | 2000 / 2300 rpm |
| Thermal profile (perf/normal/silent) | ✅ | WMI | read-back unreliable (`unknown`), writes OK |
| Max-fan boost | ✅ | WMI | overrides curve |
| **Custom fan curve** | ✅ | Victus-S + valid table | 2–8 pts, t 0–120, p 0–100 |
| Per-key write permission (this user) | ❌ | `root:input` | needs `sudo usermod -aG input $USER` + re-login |

## Nexus safety model (matches RGB)

- **Capability detection** — `can_set_curve` is the *authoritative* `victus-s &&
  fan_tbl_valid` (not mere node presence); the UI hides the curve editor on
  non-curve interfaces.
- **Validation** — 2–8 points, ranges, **plus safety limits**: monotonic
  non-decreasing %, top point ≥50%, ≥85°C ⇒ ≥50%, ≥90°C ⇒ ≥70%.
- **Transactional writes** — `fan_curve` + `fan_curve_enable` applied as a batch
  via the allowlisted `SafeWriter`; the curve write rolls back if enable fails.
- **Verify-after-write + rollback** — read-back confirmation; the prior state is
  snapshotted and restored on any failure (whole-profile rollback for presets).
- **Permission handling** — `EACCES → PermissionDenied` with the exact `input`-
  group remediation surfaced in the UI.

## Validation performed (no fan writes to your machine)

Ran the engine against real sysfs: interface = `victus-s`, `curve_supported =
true`, full capability matrix correct; a real curve write (`45:30 60:55 75:80
88:100` → enable) hit the permission boundary → `PermissionDenied`, and
`fan_curve`/`fan_curve_enable` were left **byte-for-byte unchanged** (`(unset)` /
`0`). 53 backend unit tests cover validation, safety limits, transactional
rollback and permission mapping.
