import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useInstallStore, isActive } from "@/store/install-store";

/**
 * Global "installs in progress" pill in the top bar. Because install jobs live
 * in the global store (not the Integrations page), this stays visible — and
 * keeps counting down — no matter which page you're on. Click to jump back to
 * Integrations. Renders nothing when idle.
 */
export function InstallIndicator() {
  const navigate = useNavigate();
  const jobs = useInstallStore((s) => s.jobs);
  const active = Object.values(jobs).filter(isActive);
  if (active.length === 0) return null;

  const withPct = active.filter((j) => j.percent != null);
  const avg = withPct.length
    ? Math.round(withPct.reduce((a, j) => a + (j.percent ?? 0), 0) / withPct.length)
    : null;

  return (
    <button
      onClick={() => navigate("/integrations")}
      title="Installations in progress"
      className="no-drag flex h-8 items-center gap-xs rounded-full border border-border bg-surface-sunken/60 px-sm text-2xs font-medium text-content-muted transition-colors hover:text-content"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
      <span className="tabular-nums">
        {active.length} installing{avg != null ? ` · ${avg}%` : ""}
      </span>
    </button>
  );
}
