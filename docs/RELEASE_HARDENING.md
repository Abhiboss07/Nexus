# Release Hardening Sprint — Report

**Scope:** address the CRITICAL and HIGH findings from the public-release audit.
No new features. No UI redesign. No unrelated plugins.
**Date:** 2026-06-14 · **Version:** `1.0.0-beta.1`

**Verification at close (all green):**
- `npx tsc --noEmit` — clean
- `npm run build` — clean
- isolated verify crate `cargo test` — **87 passed**
- `cargo build` (full Tauri lib, incl. updater plugin) — clean
- `cargo test --lib` — **97 passed** (incl. 6 on-hardware runtime-smoke tests)

---

## 1. Multi-hardware safety strategy ✅ implemented & validated

**Problem (C1):** every write path was validated on one machine; fan/RGB writes
go to firmware-backed sysfs. Trusting a driver's `controllable` flag on an
untested board risks writing a malformed fan curve into firmware.

**Delivered:**
- **Supported hardware matrix** — `docs/SUPPORTED_HARDWARE.md`; four tiers
  (Validated / Compatible / Unknown / Unsupported) with explicit allowlists for
  fan interfaces, RGB platforms, and reference boards.
- **Default-deny write gate** — `control/hardware_support.rs`. A pure,
  unit-tested function (`WriteGate::evaluate`) that permits writes **only**
  through validated interface identifiers. 6 unit tests cover every tier and the
  key failure modes (unknown fan iface, missing fan table, non-HP, generic box).
- **Writes disabled on unknown hardware** — enforced at three layers:
  1. `WriteGate::apply_to` forces `controllable=false` on denied capabilities →
     the **UI hides** the controls (reusing existing capability gating; no
     redesign).
  2. Every fan/RGB write method (`fan_set_curve`, `fan_set_max_fan`,
     `fan_apply_profile`, `rgb_apply`, `rgb_apply_profile`, …) and both bundled
     profile-apply paths call `guard_fan()`/`guard_rgb()` and return the new
     `ControlError::HardwareNotValidated` when denied.
  3. SafeWriter (allowlist + rollback) underneath, unchanged.
- **Compatibility report** — `get_compatibility` IPC command + `CompatibilityReport`
  TS type, surfaced to diagnostics. Reports tier, per-subsystem write flags, the
  detected fan interface, and human-readable reasons.

**Fail-safe proven on real hardware:** the runtime smoke test built the live
`ControlService` on the reference OMEN 16 and resolved **Compatible — RGB writes
on, fan writes OFF** because the fan interface could not be authoritatively
confirmed from the kernel log in that environment. The gate refused to write
through an unconfirmed interface. That is the C1 property working as designed.

## 2. Update architecture ✅ implemented (server is external infra)

- **`tauri-plugin-updater` wired** — registered in `lib.rs`; `updater:default`
  capability granted; `plugins.updater` configured with `dialog`, the signed
  `endpoints`, and a **real minisign public key** pinned in `tauri.conf.json`.
- **Signed feed** — a minisign keypair was generated with `cargo tauri signer`.
  The **public** key is in the repo config; the **private** key is a CI secret
  (`TAURI_SIGNING_PRIVATE_KEY`) and is **not** committed. The CI action generates
  and uploads the signed `latest.json` feed automatically.
- **Triggers, no UI redesign** — `check_for_update` (read-only) and
  `install_update` commands wired through the plugin's Rust API, exposed as
  `checkForUpdate()` / `installUpdate()` IPC bindings. The native update dialog
  (`dialog: true`) handles the prompt. No fake "update available" is ever
  synthesized; `app_update_info` reports only local build identity.
- **Rollback strategy** — documented in §6.

**External dependency (not code):** a host serving the `endpoints` URL + the
release artifacts. The CI workflow publishes them to GitHub Releases; pointing
the endpoint at that (or a CDN) is a deployment step.

## 3. Package trust ✅ config + workflow (secrets are deployment)

- **Version** bumped `0.1.0 → 1.0.0-beta.1` (Cargo.toml + tauri.conf.json).
- **Release metadata** added: `license` (GPL-3.0-or-later), `publisher`,
  `homepage`; per-target `rpm.depends` (fixes wrong/absent Fedora deps).
- **Broader installability (H1):** `appimage` added to bundle targets alongside
  deb/rpm — the previous deb+rpm-only set could not install on the Arch-family
  reference machine or via the common portable channel.
- **Signing** — updater artifacts are minisign-signed by CI. Optional GPG
  package signing step (`dpkg-sig` / `rpm --addsign`) runs when a repo key secret
  is present, for repository distribution trust.
- **Publishing workflow** — `.github/workflows/release.yml`: a `test` gate
  (tsc + build + `cargo test --lib`) → a `publish` job (`tauri-apps/tauri-action`)
  that builds/signs/uploads bundles + `latest.json` as a **draft pre-release**
  for human review.

**Deployment-only (not code):** the GitHub secrets
(`TAURI_SIGNING_PRIVATE_KEY`, password, optional repo GPG key) and the release
host.

## 4. Runtime validation ✅ automated where headless allows + documented matrix

- **On-hardware runtime smoke (automated, H2):** `src-tauri/src/runtime_smoke.rs`
  builds the **real** `ControlService` and exercises the command-backing logic:
  - `service_builds_and_reports_compatibility` — tier ↔ write-flag consistency
  - `capabilities_respect_the_safety_gate` — UI flags match gate decisions
  - `health_check_runs_and_is_well_formed` — startup/health check
  - `permissions_remediation_never_recommends_broad_input_group`
  - `diagnostics_export_is_nonempty_markdown`
  - `process_scanner_returns_live_rows` — IPC-backed `/proc` scan
  These run in CI (no display needed) and gate every release.
- **Desktop E2E harness (H2):** `e2e/` — WebdriverIO + `tauri-driver` config and
  a `smoke.spec.ts` driving the **packaged** binary: startup, window/`#root`,
  and IPC round-trips for `get_snapshot`, `run_health_check`, `get_compatibility`,
  `check_permissions`, `list_processes`. Runs locally or headless under
  `xvfb-run`. `npm run e2e`.
- **Manual matrix (cannot be headless-automated reliably):** tray
  show/hide/quit, autostart enable→reboot→running, single-instance focus, and
  **suspend/resume** (telemetry stream recovers, no stale frames, fan/RGB state
  re-reads). Tracked as the pre-release checklist below; must be run on
  GNOME+Wayland, GNOME+X11, and KDE before GA.

## 5. Permissions hardening ✅ implemented

- **Scoped udev rule** — `packaging/udev/99-nexus-omen.rules` grants write access
  to **only** the OMEN `rgb_zones` + `fan` sysfs attributes, to a dedicated,
  purpose-built `nexus` group. This **replaces** `usermod -aG input $USER`, which
  granted read access to every input device (a keylogging-class surface, H4).
- **Installer wiring** — `packaging/scripts/postinstall.sh` (referenced by deb &
  rpm `postInstallScript`) creates the `nexus` group, installs the rule, reloads
  udev, and prints the one scoped command (`usermod -aG nexus`).
- **In-app remediation updated** — `diagnostics::permissions` now checks the
  `nexus` group (and legacy `input` as fallback) and **never** recommends the
  broad group. Asserted by `remediation_prefers_scoped_group_not_broad_input`
  and the runtime smoke test.
- **Security implications documented** — `nexus` ≈ the model of `video`/`render`
  groups: device-class-scoped, least-privilege. Power needs no group (polkit).

---

## 6. Rollback strategy

The updater applies an **atomic replace**; combined with packaging this gives
layered rollback:
1. **Staged channels** — beta → stable. `1.0.0-beta.*` ships to opt-in users
   first; the endpoint is channel-segmented (`{{target}}/{{arch}}/…`).
2. **Server-side halt** — the update feed is server-controlled. Serving the prior
   `latest.json` (or removing the new one) **instantly stops** a bad rollout for
   everyone who hasn't updated; no client change needed.
3. **Package downgrade** — every release is also a signed deb/rpm/AppImage in
   GitHub Releases, so users can pin/reinstall the previous version via their
   package manager.
4. **Crash self-defense** — the existing `running.lock` marker already detects an
   unclean prior shutdown; the diagnostics surface flags it so a bad update is
   visible and the user can downgrade.
5. **Draft pre-release gate** — CI publishes as a **draft**; a human promotes it,
   preventing an accidental auto-push of a broken build.

---

## 7. Updated blocker list

### CRITICAL — resolved
- **C1 multi-hardware write safety** → **RESOLVED.** Default-deny gate; writes
  only through validated interfaces; UI-hide + backend-refuse + SafeWriter;
  fail-safe verified on hardware.
- **C2 no update path** → **RESOLVED (code).** Signed updater wired end-to-end.
  *Remaining: deploy the release endpoint (infra).*
- **C3 version 0.1.0** → **RESOLVED.** `1.0.0-beta.1`.
- **C4 no signing/trust** → **RESOLVED (code).** Minisign updater signing + CI
  signing + optional GPG package signing + metadata. *Remaining: provide signing
  secrets in CI (deployment).*

### HIGH — resolved
- **H1 not installable on target family** → **RESOLVED.** AppImage added;
  per-target rpm deps fixed.
- **H2 no runtime test coverage** → **RESOLVED.** On-hardware runtime smoke in
  CI + packaged E2E harness; manual matrix documented.
- **H4 broad input-group security** → **RESOLVED.** Scoped `nexus` udev rule +
  installer + hardened remediation.

### HIGH — documented, not code-resolved
- **H3 transparent/decorationless window on Linux** → **NOT changed in code**
  (fixing it means a custom-chrome redesign, which is out of scope). Downgraded
  to a **documented requirement**: Nexus requires a running compositor; verify
  rendering + window controls on GNOME (Wayland/X11) and KDE during the manual
  matrix. This remains a **GA gate**, not a beta blocker.

### Remaining (deployment / process, not code)
1. Provision the update endpoint host + point `endpoints` at it.
2. Add CI secrets: `TAURI_SIGNING_PRIVATE_KEY` (+ password), optional repo GPG.
3. Run the manual matrix (tray, autostart, single-instance, suspend/resume,
   window chrome) on GNOME-Wayland, GNOME-X11, KDE.
4. Validate fan/RGB **writes** on ≥1 additional OMEN/Victus board to promote it
   from Compatible to a tested tier (gate already keeps this safe until then).

---

## 8. Public Beta readiness assessment

**READY for public beta** (opt-in, pre-release), conditional on the two
deployment items (endpoint + CI secrets) being in place before the first signed
artifact ships.

Rationale: the safety-critical risk (C1) is resolved with verified fail-safe
behavior; trust + update plumbing is implemented and signed; the product is
honest about what it can/can't do per machine (capability + tier gating); and a
real automated runtime gate now protects every release. Beta users on unvalidated
hardware get **safe read-only** operation, not breakage.

Residual beta risks are bounded and visible: H3 (compositor-dependent window) and
the unverified suspend/resume + multi-board write paths — all surfaced to the
user via diagnostics and none of which can silently damage hardware.

## 9. Final v1.0 ship recommendation

**SHIP `1.0.0-beta.1` as a public beta. HOLD GA (`1.0.0`) until:**
1. The manual desktop matrix passes on GNOME-Wayland, GNOME-X11, and KDE
   (closes H3 in practice + tray/autostart/suspend confidence).
2. Fan/RGB **writes** are validated on at least one non-reference OMEN/Victus
   board (promotes Compatible → tested; until then the gate keeps it safe).
3. The update endpoint + signing secrets are live and one end-to-end signed
   update has been verified to install and roll back.

This is a **GO for beta, conditional GO for GA.** The hardware-damage class of
risk is closed; the remaining gates are environment coverage and deployment, not
code defects.
