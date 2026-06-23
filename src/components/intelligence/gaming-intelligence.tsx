import { useEffect, useState } from "react";
import {
  Gamepad2,
  Cpu,
  CircuitBoard,
  MemoryStick,
  Thermometer,
  Layers,
  AudioWaveform,
  TrendingUp,
  TrendingDown,
  Minus,
  Activity,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section";
import { LiveLineChart } from "@/components/charts/live-line-chart";
import { useGamingTrends, useSessionAnalysis } from "@/hooks/use-gaming";
import { useTelemetryHistory } from "@/hooks/use-telemetry-history";
import type { Limiter, MetricTrend } from "@/lib/gaming-types";
import { cn } from "@/lib/cn";

const LIMITER: Record<string, { icon: LucideIcon; cls: string }> = {
  thermal: { icon: Thermometer, cls: "bg-danger/12 text-danger" },
  cpu: { icon: Cpu, cls: "bg-warning/12 text-warning" },
  gpu: { icon: CircuitBoard, cls: "bg-info/12 text-info" },
  vram: { icon: Layers, cls: "bg-iris/12 text-iris" },
  memory: { icon: MemoryStick, cls: "bg-accent/12 text-accent-strong" },
  stutter: { icon: AudioWaveform, cls: "bg-warning/12 text-warning" },
};

function fmtWhen(ts: number): string {
  const d = new Date(ts);
  const today = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return today ? `Today ${t}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${t}`;
}
function fmtDur(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/**
 * Gaming Intelligence — pure consumer of the Rust analysis services
 * (gaming_trends / gaming_session_analytics / gaming_fps_analysis /
 * gaming_session_series). No business logic here: it renders verdicts.
 */
export function GamingIntelligence() {
  const { sessions } = useTelemetryHistory();
  const { report } = useGamingTrends();
  const [selected, setSelected] = useState<number | null>(null);

  // Default to the most recent session once the list loads.
  useEffect(() => {
    if (selected == null && sessions.length) setSelected(sessions[0].id);
  }, [sessions, selected]);

  const { analytics, fps, series, loading } = useSessionAnalysis(selected);

  return (
    <div className="space-y-md">
      <SectionTitle
        title="Gaming Intelligence"
        description="Session analytics, bottleneck & trend analysis — computed from persistent telemetry"
        action={<Badge variant="accent"><Gamepad2 className="h-3 w-3" /> v1</Badge>}
      />

      {/* Cross-session trends */}
      {report && report.trends.length > 0 && (
        <GlassCard padding="lg">
          <div className="mb-sm flex items-center justify-between">
            <p className="flex items-center gap-xs text-sm font-semibold text-content">
              <Activity className="h-4 w-4 text-accent" /> Performance Trend
            </p>
            <span className="text-2xs text-content-subtle">vs avg of {report.baselineSessions} prior</span>
          </div>
          <p className="mb-md text-xs text-content-muted">{report.summary}</p>
          <div className="grid grid-cols-2 gap-sm sm:grid-cols-3 lg:grid-cols-5">
            {report.trends.map((t) => (
              <TrendChip key={t.metric} t={t} />
            ))}
          </div>
        </GlassCard>
      )}

      {/* Session picker */}
      {sessions.length > 0 && (
        <div className="flex flex-wrap gap-xs">
          {sessions.slice(0, 8).map((s) => (
            <button
              key={s.id}
              onClick={() => setSelected(s.id)}
              className={cn(
                "rounded-lg border px-sm py-xs text-2xs font-medium transition-colors",
                selected === s.id
                  ? "border-accent/60 bg-accent/8 text-content"
                  : "border-border text-content-muted hover:text-content",
              )}
            >
              {fmtWhen(s.startedAt)} · {fmtDur(s.durationMs)}
            </button>
          ))}
        </div>
      )}

      {loading ? (
        <GlassCard padding="lg" className="flex items-center gap-sm text-sm text-content-muted">
          <Loader2 className="h-4 w-4 animate-spin" /> Analyzing session…
        </GlassCard>
      ) : analytics ? (
        <div className="grid grid-cols-1 gap-md lg:grid-cols-3">
          {/* Why-FPS-dropped / limiter analysis */}
          <div className="lg:col-span-2">
            <GlassCard padding="lg" className="h-full">
              <p className="mb-sm flex items-center gap-xs text-sm font-semibold text-content">
                <Gamepad2 className="h-4 w-4 text-accent" /> Why performance was limited
              </p>
              <p className="mb-md text-xs text-content-muted">{fps?.summary}</p>
              {fps && fps.factors.length > 0 ? (
                <div className="space-y-sm">
                  {fps.factors.map((l, i) => (
                    <LimiterRow key={i} l={l} primary={i === 0} />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-success/30 bg-success/8 p-md text-sm text-success">
                  No thermal, CPU, GPU or memory bottleneck detected — the system had headroom.
                </p>
              )}
            </GlassCard>
          </div>

          {/* Key analytics */}
          <GlassCard padding="lg" className="h-full">
            <p className="mb-sm text-sm font-semibold text-content">Session analytics</p>
            <div className="space-y-2xs">
              <Stat label="Avg CPU" value={`${analytics.cpuUsageAvg.toFixed(0)}%`} />
              <Stat label="Avg GPU" value={`${analytics.gpuUsageAvg.toFixed(0)}%`} />
              <Stat label="Avg RAM" value={`${analytics.memUsageAvg.toFixed(0)}%`} />
              {analytics.vramPctMax > 0 && (
                <Stat label="Peak VRAM" value={`${analytics.vramPctMax.toFixed(0)}%`} tone={analytics.vramPctMax >= 92 ? "danger" : undefined} />
              )}
              <Stat label="Peak CPU temp" value={`${analytics.cpuTempMax.toFixed(0)}°C`} tone={analytics.cpuTempMax >= 90 ? "danger" : undefined} />
              <Stat label="Peak GPU temp" value={`${analytics.gpuTempMax.toFixed(0)}°C`} />
              <Stat label="Avg power" value={`${analytics.powerAvgW.toFixed(0)} W`} />
              <Stat label="Throttling" value={`${analytics.throttlePct.toFixed(1)}%`} tone={analytics.throttlePct > 1 ? "danger" : undefined} />
              {analytics.fpsSamples > 0 ? (
                <>
                  <Stat label="Avg FPS" value={analytics.fpsAvg.toFixed(0)} />
                  <Stat label="1% low FPS" value={analytics.fpsLow1pct.toFixed(0)} />
                </>
              ) : (
                <Stat label="FPS" value="no source" />
              )}
            </div>
          </GlassCard>

          {/* Thermal (+FPS) timeline */}
          {series.length > 1 && (
            <div className="lg:col-span-3">
              <GlassCard padding="lg">
                <SectionTitle
                  title="Session timeline"
                  description={fps?.hasFps ? "Temperatures & FPS" : "Temperatures (install MangoHud for FPS)"}
                />
                <LiveLineChart
                  domain={[0, 100]}
                  series={[
                    { key: "cpuTemp", label: "CPU °C", color: "rgb(var(--color-danger))", data: series.map((p) => p.cpuTemp) },
                    { key: "gpuTemp", label: "GPU °C", color: "rgb(var(--color-iris))", data: series.map((p) => p.gpuTemp) },
                    ...(fps?.hasFps
                      ? [{ key: "fps", label: "FPS", color: "rgb(var(--color-accent))", data: series.map((p) => p.fps) }]
                      : []),
                  ]}
                />
              </GlassCard>
            </div>
          )}
        </div>
      ) : (
        <GlassCard padding="lg" className="text-center text-sm text-content-subtle">
          No session telemetry yet — sessions appear here as Nexus records them.
        </GlassCard>
      )}
    </div>
  );
}

function TrendChip({ t }: { t: MetricTrend }) {
  const Icon = t.direction === "up" ? TrendingUp : t.direction === "down" ? TrendingDown : Minus;
  const tone =
    t.verdict === "improved" ? "text-success" : t.verdict === "regressed" ? "text-danger" : "text-content-muted";
  return (
    <div className="rounded-lg bg-surface-sunken/40 p-sm">
      <p className="text-2xs uppercase tracking-wide text-content-subtle">{t.label}</p>
      <p className="mt-2xs text-sm font-semibold tabular-nums text-content">{round(t.current)}</p>
      <p className={cn("flex items-center gap-xs text-2xs font-medium tabular-nums", tone)}>
        <Icon className="h-3 w-3" /> {t.deltaPct > 0 ? "+" : ""}{t.deltaPct.toFixed(0)}%
      </p>
    </div>
  );
}

function LimiterRow({ l, primary }: { l: Limiter; primary: boolean }) {
  const meta = LIMITER[l.kind] ?? LIMITER.cpu;
  return (
    <div className={cn("rounded-lg border p-md", primary ? "border-accent/40 bg-accent/5" : "border-border-subtle bg-surface-sunken/30")}>
      <div className="flex items-start gap-md">
        <div className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-md", meta.cls)}>
          <meta.icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center justify-between gap-sm text-sm font-semibold text-content">
            <span>{l.title}{primary && <span className="ml-xs text-2xs font-medium text-accent-strong">primary</span>}</span>
            <Badge variant="neutral" size="sm">{l.confidence}%</Badge>
          </p>
          <p className="mt-2xs text-xs text-content-muted">{l.detail}</p>
          <p className="mt-xs text-2xs text-content-subtle">→ {l.recommendation}</p>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle/60 py-2xs">
      <span className="text-xs text-content-muted">{label}</span>
      <span className={cn("text-xs font-semibold tabular-nums", tone === "danger" ? "text-danger" : "text-content")}>{value}</span>
    </div>
  );
}

function round(n: number): string {
  return Math.abs(n) >= 10 ? n.toFixed(0) : n.toFixed(1);
}
