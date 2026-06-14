/**
 * Desktop smoke spec (finding H2). Covers the runtime surfaces that cannot be
 * unit-tested: app startup, window, IPC round-trips, and the safety gate as the
 * UI actually sees it. Tray-menu and suspend/resume remain in the documented
 * manual matrix (no reliable headless WebDriver hook for either).
 */
import { browser, expect, $ } from "@wdio/globals";

/** Invoke a backend command through the page's Tauri bridge. */
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return browser.execute(
    (c, a) => (window as any).__TAURI_INTERNALS__.invoke(c, a),
    cmd,
    args ?? {},
  ) as Promise<T>;
}

describe("Nexus desktop — startup", () => {
  it("launches and renders the shell", async () => {
    await browser.waitUntil(async () => (await browser.getTitle()).length > 0, {
      timeout: 20_000,
      timeoutMsg: "window never produced a title",
    });
    await expect($("#root")).toBeExisting();
  });

  it("streams a telemetry snapshot over IPC", async () => {
    const snap = await invoke<any>("get_snapshot");
    expect(snap).toBeDefined();
    expect(snap.cpu).toBeDefined();
    expect(typeof snap.memory.totalBytes).toBe("number");
  });

  it("runs the health check over IPC", async () => {
    const hc = await invoke<any>("run_health_check");
    expect(hc.total).toBeGreaterThan(0);
    expect(hc.passed).toBeLessThanOrEqual(hc.total);
  });

  it("reports a compatibility tier and never claims writes on unknown HW", async () => {
    const c = await invoke<any>("get_compatibility");
    expect(["validated", "compatible", "unknown", "unsupported"]).toContain(c.tier);
    if (c.tier === "unknown" || c.tier === "unsupported") {
      expect(c.fanWrites).toBe(false);
      expect(c.rgbWrites).toBe(false);
    }
  });

  it("permissions remediation never recommends the broad input group", async () => {
    const p = await invoke<any>("check_permissions");
    expect(p.remediation).not.toContain("-aG input");
  });

  it("enumerates live processes over IPC", async () => {
    const procs = await invoke<any[]>("list_processes", { limit: 20 });
    expect(Array.isArray(procs)).toBe(true);
    expect(procs.length).toBeGreaterThan(0);
  });
});
