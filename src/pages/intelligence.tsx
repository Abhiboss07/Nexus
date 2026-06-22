import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Brain,
  TrendingUp,
  TrendingDown,
  Minus,
  Info,
  AlertTriangle,
  ShieldAlert,
  Wrench,
  Workflow,
  ArrowRight,
  Activity,
  Gauge,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { RingGauge } from "@/components/ui/ring-gauge";
import { Meter } from "@/components/ui/progress";
import { Sparkline } from "@/components/ui/sparkline";
import { SectionTitle } from "@/components/ui/section";
import { CommandBar } from "@/components/intelligence/command-bar";
import { TelemetrySessions } from "@/components/intelligence/telemetry-sessions";
import { useIntelligence } from "@/hooks/use-intelligence";
import type { Evidence } from "@/lib/intelligence-types";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

const SEV: Record<string, { icon: typeof Info; cls: string }> = {
  info: { icon: Info, cls: "bg-info/12 text-info" },
  warning: { icon: AlertTriangle, cls: "bg-warning/12 text-warning" },
  critical: { icon: ShieldAlert, cls: "bg-danger/12 text-danger" },
};

const BOTTLENECK_LABEL: Record<string, string> = {
  cpu: "CPU-bound", gpu: "GPU-bound", vram: "VRAM-bound", memory: "Memory-bound", disk: "Disk-bound", none: "Balanced",
};

function statusTone(status: string) {
  return status === "optimal" ? "success" : status === "good" ? "info" : status === "warning" ? "warning" : "danger";
}

export default function IntelligencePage() {
  const { report } = useIntelligence();

  const overall = report?.health.overallScore ?? 0;
  const overallTone = overall >= 85 ? "success" : overall >= 70 ? "info" : overall >= 50 ? "warning" : "danger";

  return (
    <div>
      <PageHeader
        title="Intelligence Core"
        description="On-device reasoning across every subsystem — every insight traceable to real telemetry."
        actions={<Badge variant="accent" size="md"><Brain className="h-3.5 w-3.5" /> Deterministic · On-device</Badge>}
      />

      {/* Command bar */}
      <div className="mb-lg">
        <CommandBar />
      </div>

      <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="space-y-lg">
        {/* Persistent telemetry — sessions & aggregates (foundation for Gaming Intelligence) */}
        <motion.div variants={fadeUp}>
          <TelemetrySessions />
        </motion.div>

        {/* Health + bottleneck */}
        <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
          <motion.div variants={fadeUp}>
            <GlassCard padding="lg" className="flex h-full flex-col items-center justify-center text-center">
              <RingGauge value={overall} size={160} thickness={13} tone={overallTone} label={`${overall}`} sublabel="Health Score" />
              <p className="mt-md text-sm font-semibold capitalize text-content">{report?.health.grade ?? "—"}</p>
              <p className="text-xs text-content-muted">Weighted across {report?.health.subsystems.length ?? 0} subsystems</p>
            </GlassCard>
          </motion.div>

          <motion.div variants={fadeUp} className="lg:col-span-2">
            <GlassCard padding="lg" className="h-full">
              <SectionTitle
                title="Subsystem Health"
                action={
                  <Badge variant={report?.bottleneck.bottleneck === "none" ? "success" : "warning"}>
                    <Gauge className="h-3 w-3" /> {BOTTLENECK_LABEL[report?.bottleneck.bottleneck ?? "none"]}
                  </Badge>
                }
              />
              <div className="space-y-sm">
                {(report?.health.subsystems ?? []).map((s) => (
                  <div key={s.name} className="flex items-center gap-md">
                    <span className="w-20 text-sm font-medium text-content">{s.name}</span>
                    <Meter value={s.score} tone={statusTone(s.status)} className="flex-1" height={8} />
                    <span className="w-10 text-right text-xs font-semibold tabular-nums text-content">{s.score}</span>
                    <span className="hidden w-44 truncate text-2xs text-content-subtle sm:block">{s.detail}</span>
                  </div>
                ))}
              </div>
              {report && (
                <p className="mt-md rounded-lg bg-surface-sunken/50 p-sm text-xs text-content-muted">
                  <span className="font-medium text-content">Bottleneck:</span> {report.bottleneck.detail} <span className="text-content-subtle">({report.bottleneck.confidence}% confidence)</span>
                </p>
              )}
            </GlassCard>
          </motion.div>
        </div>

        {/* Recommendations */}
        <motion.section variants={fadeUp}>
          <SectionTitle title="AI Recommendations" description="Evidence-based · capability-aware" />
          <div className="grid grid-cols-1 gap-md lg:grid-cols-2">
            {(report?.recommendations ?? []).map((r) => {
              const sev = SEV[r.severity] ?? SEV.info;
              return (
                <GlassCard key={r.id} padding="lg" interactive className="flex flex-col gap-sm">
                  <div className="flex items-start gap-md">
                    <div className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-md", sev.cls)}><sev.icon className="h-5 w-5" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center justify-between gap-sm text-sm font-semibold text-content">
                        <span>{r.title}</span>
                        <Badge variant="neutral" size="sm">{r.confidence}%</Badge>
                      </p>
                      <p className="mt-2xs text-xs text-content-muted">{r.detail}</p>
                    </div>
                  </div>
                  <EvidenceChips evidence={r.evidence} />
                  {r.action && (
                    <Link to={r.action} className="flex items-center gap-xs text-xs font-medium text-accent-strong hover:underline">
                      Take action <ArrowRight className="h-3 w-3" />
                    </Link>
                  )}
                </GlassCard>
              );
            })}
          </div>
        </motion.section>

        {/* Trends */}
        <motion.section variants={fadeUp}>
          <SectionTitle title="Trend Analytics" description="Least-squares direction over the session" />
          <div className="grid grid-cols-2 gap-md sm:grid-cols-3 lg:grid-cols-6">
            {(report?.trends.metrics ?? []).map((t) => {
              const Arrow = t.direction === "rising" ? TrendingUp : t.direction === "falling" ? TrendingDown : Minus;
              const tone = t.metric.includes("Temp") ? (t.direction === "rising" ? "danger" : "success") : "accent";
              return (
                <GlassCard key={t.metric} padding="md" interactive>
                  <div className="flex items-center justify-between">
                    <span className="text-2xs uppercase tracking-wider text-content-subtle">{t.metric}</span>
                    <Arrow className={cn("h-3.5 w-3.5", t.direction === "rising" ? "text-danger" : t.direction === "falling" ? "text-success" : "text-content-subtle")} />
                  </div>
                  <p className="mt-2xs font-display text-xl font-semibold text-content">{Math.round(t.current)}{t.metric.includes("Fan") ? "" : t.metric.includes("Temp") ? "°" : "%"}</p>
                  <p className="text-2xs text-content-subtle">avg {Math.round(t.average)} · {t.direction}</p>
                  <div className="mt-xs">
                    <Sparkline data={t.series.length ? t.series : [0, 0]} tone={tone as "accent" | "success" | "danger"} height={28} />
                  </div>
                </GlassCard>
              );
            })}
          </div>
        </motion.section>

        {/* Maintenance + Automation */}
        <div className="grid grid-cols-1 gap-md lg:grid-cols-2">
          <motion.section variants={fadeUp}>
            <SectionTitle title="Predictive Maintenance" action={<Wrench className="h-4 w-4 text-content-subtle" />} />
            <div className="space-y-sm">
              {(report?.maintenance ?? []).map((m, i) => {
                const sev = SEV[m.severity] ?? SEV.info;
                return (
                  <GlassCard key={i} padding="md" className="flex items-start gap-md">
                    <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md", sev.cls)}><sev.icon className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center justify-between gap-sm text-sm font-semibold text-content">
                        <span>{m.component}</span>
                        <span className="flex items-center gap-xs">
                          {m.etaDays != null && <Badge variant="info" size="sm">~{Math.round(m.etaDays)}d</Badge>}
                          <Badge variant="neutral" size="sm">{m.confidence}%</Badge>
                        </span>
                      </p>
                      <p className="mt-2xs text-xs text-content-muted">{m.prediction}</p>
                      <EvidenceChips evidence={m.evidence} />
                    </div>
                  </GlassCard>
                );
              })}
            </div>
          </motion.section>

          <motion.section variants={fadeUp}>
            <SectionTitle title="Automation Suggestions" action={<Workflow className="h-4 w-4 text-content-subtle" />} />
            <div className="space-y-sm">
              {report && report.automationSuggestions.length === 0 ? (
                <GlassCard padding="lg" className="flex items-center gap-md">
                  <Activity className="h-7 w-7 text-content-subtle" />
                  <div>
                    <p className="text-sm font-semibold text-content">No new automations suggested</p>
                    <p className="text-xs text-content-muted">Your active rules already cover observed patterns.</p>
                  </div>
                </GlassCard>
              ) : (
                (report?.automationSuggestions ?? []).map((a) => (
                  <GlassCard key={a.id} padding="md" interactive className="flex items-start gap-md">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-accent/12 text-accent-strong"><Workflow className="h-4 w-4" /></div>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center justify-between gap-sm text-sm font-semibold text-content">
                        <span>{a.title}</span>
                        <Badge variant="neutral" size="sm">{a.confidence}%</Badge>
                      </p>
                      <p className="mt-2xs text-xs text-content-muted">{a.detail}</p>
                      <p className="mt-xs text-2xs text-content-subtle">{a.triggerLabel} → <span className="capitalize text-content-muted">{a.profileId.replace("-", " ")}</span></p>
                      <Link to="/performance" className="mt-xs flex items-center gap-xs text-xs font-medium text-accent-strong hover:underline">Set up <ArrowRight className="h-3 w-3" /></Link>
                    </div>
                  </GlassCard>
                ))
              )}
            </div>
          </motion.section>
        </div>
      </motion.div>
    </div>
  );
}

function EvidenceChips({ evidence }: { evidence: Evidence[] }) {
  if (!evidence.length) return null;
  return (
    <div className="flex flex-wrap gap-xs">
      {evidence.map((e, i) => (
        <span key={i} className="inline-flex items-center gap-xs rounded-md bg-surface-sunken/60 px-xs py-2xs text-2xs text-content-muted">
          <span className="text-content-subtle">{e.metric}</span>
          <span className="font-medium text-content">{e.value}</span>
          {e.threshold !== "—" && <span className="text-content-subtle">/ {e.threshold}</span>}
        </span>
      ))}
    </div>
  );
}
