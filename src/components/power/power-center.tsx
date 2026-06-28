import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Cpu,
  Plug,
  BatteryCharging,
  Zap,
  Gauge,
  Leaf,
  Gamepad2,
  Code2,
  Video,
  Sliders,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { Badge, StatusDot } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Meter } from "@/components/ui/progress";
import { SectionTitle } from "@/components/ui/section";
import { CapabilityGate, CapabilityBadge } from "@/components/ui/capability-gate";
import { useCapability } from "@/hooks/use-telemetry";
import {
  usePowerInfo,
  useNexusProfiles,
  useActiveProfile,
  useAutomation,
  useControlActions,
} from "@/hooks/use-control";
import { profileImpact, impactLevel } from "@/lib/power-impact";
import type { Rule, Trigger } from "@/lib/power-types";
import { cn } from "@/lib/cn";
import { useRenderCount } from "@/components/dev/render-count";

const PROFILE_ICONS: Record<string, LucideIcon> = {
  gamepad: Gamepad2,
  code: Code2,
  video: Video,
  leaf: Leaf,
  sliders: Sliders,
};

type Status = { kind: "idle" | "ok" | "error"; msg: string };

function triggerLabel(t: Trigger): string {
  switch (t.type) {
    case "processRunning":
      return `When ${t.process} launches`;
    case "batteryBelow":
      return `When battery drops below ${t.percent}%`;
    case "acConnected":
      return t.connected ? "When AC is connected" : "When on battery";
  }
}

export function PowerCenter() {
  useRenderCount("PowerCenter");
  const powerCap = useCapability("power");
  const powerInfo = usePowerInfo();
  const nexusProfiles = useNexusProfiles();
  const activeProfile = useActiveProfile();
  const automation = useAutomation();
  const actions = useControlActions();
  const [status, setStatus] = useState<Status>({ kind: "idle", msg: "" });
  const [busy, setBusy] = useState<string | null>(null);

  async function run(label: string, fn: () => Promise<{ ok: boolean; msg: string }>) {
    setBusy(label);
    const res = await fn();
    setStatus({ kind: res.ok ? "ok" : "error", msg: res.msg });
    setBusy(null);
  }

  function toggleRule(rule: Rule) {
    if (!automation) return;
    const next = {
      ...automation,
      rules: automation.rules.map((r) => (r.id === rule.id ? { ...r, enabled: !r.enabled } : r)),
    };
    run("automation", () => actions.saveAutomation(next));
  }

  function toggleAutomation(enabled: boolean) {
    if (!automation) return;
    run("automation", () => actions.saveAutomation({ ...automation, enabled }));
  }

  return (
    <div className="space-y-md">
      {/* Status banner */}
      <AnimatePresence>
        {status.kind !== "idle" && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn(
              "flex items-center gap-sm rounded-lg border p-sm text-sm",
              status.kind === "error"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-success/30 bg-success/10 text-success",
            )}
          >
            {status.kind === "error" ? <AlertTriangle className="h-4 w-4 shrink-0" /> : <CheckCircle2 className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 flex-1">{status.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Power profiles */}
      <GlassCard padding="lg">
        <SectionTitle
          title="Power Profile"
          description={
            powerInfo
              ? `Driver: ${powerInfo.driver} · CPU: ${powerInfo.cpuDriver ?? "—"}`
              : "Detecting power capabilities…"
          }
          action={
            <div className="flex items-center gap-sm">
              <Badge variant={powerInfo?.acOnline ? "success" : "warning"} size="md">
                {powerInfo?.acOnline ? <Plug className="h-3.5 w-3.5" /> : <BatteryCharging className="h-3.5 w-3.5" />}
                {powerInfo?.acOnline ? "AC Power" : "On Battery"}
              </Badge>
              <CapabilityBadge status={powerCap?.status} />
            </div>
          }
        />

        <CapabilityGate status={powerCap?.status}>
          <div className="grid grid-cols-1 gap-md sm:grid-cols-3">
            {(powerInfo?.profiles ?? []).map((p) => {
              const impact = profileImpact(p.name);
              const isActive = p.active;
              return (
                <button
                  key={p.name}
                  disabled={busy === p.name}
                  onClick={() => run(p.name, () => actions.setPower(p.name))}
                  className={cn(
                    "relative overflow-hidden rounded-xl border p-md text-left transition-all",
                    isActive ? "border-accent/60 bg-accent/8 shadow-glow" : "border-border hover:border-border-strong",
                  )}
                >
                  {isActive && (
                    <motion.span
                      layoutId="active-power"
                      className="absolute right-3 top-3"
                      transition={{ type: "spring", stiffness: 380, damping: 30 }}
                    >
                      <StatusDot tone="accent" pulse={false} />
                    </motion.span>
                  )}
                  <div className="mb-sm flex items-center gap-sm">
                    <span className={cn("grid h-9 w-9 place-items-center rounded-md", isActive ? "bg-accent/20 text-accent-strong" : "bg-surface-raised text-content-muted")}>
                      {p.name === "performance" ? <Zap className="h-4 w-4" /> : p.name === "power-saver" ? <Leaf className="h-4 w-4" /> : <Gauge className="h-4 w-4" />}
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-content">{impact.label}</p>
                      <p className="text-2xs text-content-subtle">{impact.description}</p>
                    </div>
                  </div>
                  <Impacts impact={impact} />
                </button>
              );
            })}
          </div>
        </CapabilityGate>
      </GlassCard>

      {/* Nexus profiles */}
      <GlassCard padding="lg">
        <SectionTitle title="Nexus Profiles" description="One tap sets power, lighting & more" action={<Badge variant="accent"><Sparkles className="h-3 w-3" /> Smart</Badge>} />
        <div className="grid grid-cols-2 gap-md sm:grid-cols-3 lg:grid-cols-5">
          {nexusProfiles.map((profile) => {
            const Icon = PROFILE_ICONS[profile.icon] ?? Sliders;
            const isActive = activeProfile === profile.id;
            return (
              <button
                key={profile.id}
                disabled={busy === profile.id}
                onClick={() => run(profile.id, () => actions.applyProfile(profile.id))}
                className={cn(
                  "group flex flex-col items-center gap-sm rounded-xl border p-md text-center transition-all",
                  isActive ? "border-accent/60 bg-accent/8 shadow-glow" : "border-border hover:border-border-strong hover:bg-accent/5",
                )}
              >
                <span className={cn("grid h-12 w-12 place-items-center rounded-xl transition-colors", isActive ? "bg-brand-gradient text-white shadow-glow" : "bg-surface-raised text-content-muted group-hover:text-accent-strong")}>
                  <Icon className="h-6 w-6" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-content">{profile.name}</p>
                  <p className="text-2xs text-content-subtle">
                    {profile.power ?? "—"}
                    {profile.rgb ? ` · ${profile.rgb.effect}` : ""}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </GlassCard>

      {/* Automation */}
      <GlassCard padding="lg">
        <SectionTitle
          title="Automation"
          description="Auto-switch profiles based on what you're doing"
          action={
            <label className="flex items-center gap-sm">
              <Workflow className={cn("h-4 w-4", automation?.enabled ? "text-accent-strong" : "text-content-subtle")} />
              <span className="text-sm font-medium text-content">{automation?.enabled ? "On" : "Off"}</span>
              <Switch checked={automation?.enabled ?? false} onCheckedChange={toggleAutomation} />
            </label>
          }
        />
        <div className={cn("space-y-xs transition-opacity", !automation?.enabled && "opacity-50")}>
          {(automation?.rules ?? []).map((rule) => {
            const RuleIcon = PROFILE_ICONS[nexusProfiles.find((p) => p.id === rule.profileId)?.icon ?? "sliders"] ?? Sliders;
            return (
            <div key={rule.id} className="flex items-center gap-md rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-surface-raised text-content-muted">
                <RuleIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-content">{triggerLabel(rule.trigger)}</p>
                <p className="text-2xs text-content-subtle">
                  → apply <span className="capitalize text-content-muted">{rule.profileId.replace("-", " ")}</span>
                </p>
              </div>
              <Switch checked={rule.enabled} onCheckedChange={() => toggleRule(rule)} disabled={!automation?.enabled} />
            </div>
            );
          })}
          {!automation?.rules.length && (
            <p className="py-md text-center text-sm text-content-subtle">No automation rules.</p>
          )}
        </div>
      </GlassCard>
    </div>
  );
}

function Impacts({ impact }: { impact: ReturnType<typeof profileImpact> }) {
  return (
    <div className="space-y-xs">
      <ImpactBar icon={Cpu} label="Performance" level={impactLevel[impact.performance]} tone="accent" />
      <ImpactBar icon={BatteryCharging} label="Battery life" level={impactLevel[impact.battery]} tone="success" />
    </div>
  );
}

function ImpactBar({
  icon: Icon,
  label,
  level,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  level: number;
  tone: "accent" | "success";
}) {
  return (
    <div className="flex items-center gap-sm">
      <Icon className="h-3 w-3 shrink-0 text-content-subtle" />
      <span className="w-20 text-2xs text-content-subtle">{label}</span>
      <Meter value={level} tone={tone} className="flex-1" height={4} />
    </div>
  );
}
