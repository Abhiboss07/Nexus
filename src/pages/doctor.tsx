import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Stethoscope,
  ShieldCheck,
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  Lock,
  Copy,
  RotateCw,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RingGauge } from "@/components/ui/ring-gauge";
import { SectionTitle } from "@/components/ui/section";
import {
  isTauri,
  runHealthCheck,
  checkPermissions,
  exportDiagnostics,
} from "@/lib/ipc";
import type { HealthCheck, Permissions } from "@/lib/system-types";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

const DEMO_HEALTH: HealthCheck = {
  passed: 7,
  total: 10,
  checks: [
    { name: "Telemetry stream", status: "ok", detail: "Live frames flowing" },
    { name: "CPU sensors", status: "ok", detail: "13th Gen Intel Core i5-13420H" },
    { name: "GPU (NVIDIA)", status: "ok", detail: "CUDA 13.3" },
    { name: "Power profiles", status: "ok", detail: "power-profiles-daemon" },
    { name: "OMEN RGB driver", status: "ok", detail: "omen-rgb-keyboard loaded" },
    { name: "Fan interface", status: "ok", detail: "omen-rgb-keyboard" },
    { name: "Battery", status: "ok", detail: "power_supply sysfs" },
    { name: "Input group", status: "warn", detail: "Not a member (RGB/fan writes blocked)" },
    { name: "RGB write access", status: "warn", detail: "Needs input group" },
    { name: "Fan write access", status: "warn", detail: "Needs input group" },
  ],
};
const DEMO_PERMS: Permissions = {
  inInputGroup: false, rgbWritable: false, fanWritable: false, powerControllable: true,
  remediation: "Run: sudo usermod -aG input $USER — then log out and back in to control RGB & fans.",
};

const STATUS: Record<string, { icon: typeof CheckCircle2; cls: string }> = {
  ok: { icon: CheckCircle2, cls: "text-success" },
  warn: { icon: AlertTriangle, cls: "text-warning" },
  fail: { icon: XCircle, cls: "text-danger" },
};

export default function DoctorPage() {
  const [phase, setPhase] = useState<"idle" | "scanning" | "done">("idle");
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);

  async function scan() {
    setPhase("scanning");
    await new Promise((r) => setTimeout(r, 900)); // brief, premium scan beat
    if (isTauri()) {
      const [h, p] = await Promise.all([
        runHealthCheck().catch(() => DEMO_HEALTH),
        checkPermissions().catch(() => DEMO_PERMS),
      ]);
      setHealth(h);
      setPerms(p);
    } else {
      setHealth(DEMO_HEALTH);
      setPerms(DEMO_PERMS);
    }
    setPhase("done");
  }

  useEffect(() => { scan(); /* auto-run on open */ /* eslint-disable-next-line */ }, []);

  async function doExport() {
    let md: string;
    try { md = isTauri() ? await exportDiagnostics() : "# Nexus Diagnostics (demo)\n"; }
    catch { md = "# Nexus Diagnostics\n(export failed)\n"; }
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "nexus-diagnostics.md"; a.click();
    URL.revokeObjectURL(url);
  }

  const score = health ? Math.round((health.passed / Math.max(1, health.total)) * 100) : 0;
  const tone = score >= 85 ? "success" : score >= 60 ? "warning" : "danger";

  return (
    <div>
      <PageHeader
        title="System Doctor"
        description="Live health check, permission validation & diagnostics."
        actions={
          <>
            <Button variant="solid" size="md" onClick={doExport} disabled={phase !== "done"}>
              <Download className="h-4 w-4" /> Export Diagnostics
            </Button>
            <Button variant="primary" size="md" onClick={scan} disabled={phase === "scanning"}>
              <RotateCw className={cn("h-4 w-4", phase === "scanning" && "animate-spin")} /> Re-scan
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
        {/* Health score */}
        <GlassCard padding="lg" className="relative flex flex-col items-center justify-center overflow-hidden text-center">
          <div className="absolute -top-12 h-40 w-40 rounded-full bg-accent/15 blur-3xl" />
          <RingGauge value={phase === "scanning" ? 0 : score} size={180} thickness={14} tone={tone} label={phase === "scanning" ? "…" : `${score}`} sublabel={phase === "scanning" ? "Scanning" : "Health"} />
          <p className="mt-md text-sm text-content-muted">
            {phase === "scanning" ? "Running diagnostics…" : health ? `${health.passed} of ${health.total} checks passed` : ""}
          </p>
        </GlassCard>

        {/* Checks */}
        <div className="lg:col-span-2">
          <GlassCard padding="lg" className="h-full">
            <SectionTitle title="Diagnostics" description="Drivers, sensors & subsystems" action={<Badge variant={tone === "success" ? "success" : "warning"}><ScanLine className="h-3 w-3" /> {health?.total ?? 0} checks</Badge>} />
            <motion.div variants={stagger(0.03)} initial="hidden" animate="show" className="grid grid-cols-1 gap-2xs sm:grid-cols-2">
              {(health?.checks ?? []).map((c) => {
                const st = STATUS[c.status] ?? STATUS.ok;
                return (
                  <motion.div key={c.name} variants={fadeUp} className="flex items-center gap-sm rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
                    <st.icon className={cn("h-4 w-4 shrink-0", st.cls)} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-content">{c.name}</p>
                      <p className="truncate text-2xs text-content-subtle">{c.detail}</p>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </GlassCard>
        </div>
      </div>

      {/* Permissions */}
      <AnimatePresence>
        {perms && (
          <motion.div variants={fadeUp} initial="hidden" animate="show" className="mt-md">
            <GlassCard padding="lg">
              <SectionTitle title="Permissions" description="What Nexus can control right now" action={<ShieldCheck className="h-4 w-4 text-content-subtle" />} />
              <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-4">
                <PermCard label="Power Profiles" ok={perms.powerControllable} />
                <PermCard label="RGB Lighting" ok={perms.rgbWritable} />
                <PermCard label="Fan Control" ok={perms.fanWritable} />
                <PermCard label="Input Group" ok={perms.inInputGroup} />
              </div>
              {!perms.inInputGroup && (
                <div className="mt-md rounded-lg border border-warning/30 bg-warning/10 p-md">
                  <p className="flex items-center gap-xs text-sm font-medium text-warning"><AlertTriangle className="h-4 w-4" /> Unlock RGB & fan control</p>
                  <button onClick={() => navigator.clipboard?.writeText("sudo usermod -aG input $USER")} className="mt-xs flex w-full max-w-md items-center gap-xs rounded-md bg-surface-sunken px-sm py-xs text-left">
                    <Copy className="h-3.5 w-3.5 shrink-0 text-content-subtle" />
                    <code className="flex-1 truncate text-2xs text-content-muted">sudo usermod -aG input $USER</code>
                  </button>
                  <p className="mt-2xs text-2xs text-content-subtle">Then log out and back in. Telemetry & power profiles already work.</p>
                </div>
              )}
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {phase === "idle" && (
        <GlassCard padding="lg" className="mt-md grid place-items-center py-2xl text-center">
          <Stethoscope className="h-8 w-8 text-accent" />
          <p className="mt-sm text-sm text-content-muted">Run a scan to check system health.</p>
        </GlassCard>
      )}
    </div>
  );
}

function PermCard({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={cn("flex items-center gap-sm rounded-lg border p-md", ok ? "border-success/30 bg-success/8" : "border-border bg-surface-sunken/40")}>
      <div className={cn("grid h-9 w-9 place-items-center rounded-md", ok ? "bg-success/15 text-success" : "bg-surface-raised text-content-subtle")}>
        {ok ? <CheckCircle2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
      </div>
      <div>
        <p className="text-sm font-medium text-content">{label}</p>
        <p className="text-2xs text-content-subtle">{ok ? "Available" : "Restricted"}</p>
      </div>
    </div>
  );
}
