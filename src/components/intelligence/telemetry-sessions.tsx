import { Database, Clock, Cpu, CircuitBoard, RefreshCw, Activity } from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section";
import { useTelemetryHistory } from "@/hooks/use-telemetry-history";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { TelemetrySession } from "@/lib/telemetry-history-types";

/**
 * Reads the persistent telemetry store (SQLite sessions + aggregates) — the
 * durable history behind the in-memory ring. This is the seam Gaming
 * Intelligence builds on: every figure here comes from recorded telemetry, not
 * the volatile live cache.
 */
export function TelemetrySessions() {
  const { sessions, stats, loading, refresh } = useTelemetryHistory();

  return (
    <GlassCard padding="lg">
      <SectionTitle
        title="Telemetry History"
        description="Persistent sessions & aggregates — the basis for Gaming Intelligence"
        action={
          <button
            onClick={refresh}
            className="inline-flex items-center gap-xs rounded-md border border-border px-sm py-1 text-2xs font-medium text-content-muted transition-colors hover:text-content"
          >
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
          </button>
        }
      />

      {/* Store-wide totals */}
      <div className="mb-md grid grid-cols-2 gap-sm sm:grid-cols-4">
        <Stat icon={Activity} label="Sessions" value={`${stats?.sessions ?? 0}`} />
        <Stat icon={Clock} label="Tracked" value={formatHours(stats?.trackedMs ?? 0)} />
        <Stat icon={Cpu} label="Peak CPU" value={`${Math.round(stats?.cpuTempPeak ?? 0)}°C`} />
        <Stat icon={Database} label="DB size" value={formatBytes(stats?.dbBytes ?? 0)} />
      </div>

      {sessions.length === 0 ? (
        <p className="py-md text-center text-sm text-content-subtle">
          {loading ? "Loading history…" : "No telemetry recorded yet — sessions appear as Nexus runs."}
        </p>
      ) : (
        <div className="space-y-2xs">
          {sessions.slice(0, 8).map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      )}
    </GlassCard>
  );
}

function SessionRow({ session: s }: { session: TelemetrySession }) {
  const active = s.endedAt == null;
  return (
    <div className="flex items-center gap-md rounded-lg border border-border-subtle bg-surface-sunken/40 p-sm">
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-sm text-sm font-medium text-content">
          {formatWhen(s.startedAt)}
          {active && <Badge variant="success" size="sm">Live</Badge>}
        </p>
        <p className="text-2xs text-content-subtle">
          {formatDur(s.durationMs)} · {s.samples.toLocaleString()} samples · v{s.appVersion}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-md text-2xs tabular-nums">
        <span className="flex items-center gap-xs text-content-muted" title="Avg / peak CPU temperature">
          <Cpu className="h-3.5 w-3.5 text-accent" />
          {Math.round(s.cpuTempAvg)}° / <span className="text-warning">{Math.round(s.cpuTempMax)}°</span>
        </span>
        <span className="flex items-center gap-xs text-content-muted" title="Avg / peak GPU temperature">
          <CircuitBoard className="h-3.5 w-3.5 text-info" />
          {Math.round(s.gpuTempAvg)}° / <span className="text-warning">{Math.round(s.gpuTempMax)}°</span>
        </span>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Cpu; label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-sunken/40 p-sm">
      <p className="flex items-center gap-xs text-2xs uppercase tracking-wide text-content-subtle">
        <Icon className="h-3 w-3" /> {label}
      </p>
      <p className="mt-2xs text-sm font-semibold tabular-nums text-content">{value}</p>
    </div>
  );
}

function formatHours(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.round(ms / 60_000)}m`;
  return `${h.toFixed(1)}h`;
}

function formatDur(ms: number): string {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function formatWhen(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? `Today ${time}` : `${d.toLocaleDateString([], { month: "short", day: "numeric" })} ${time}`;
}
