import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import {
  Monitor,
  Cpu,
  Palette,
  BatteryCharging,
  Sparkles,
  RefreshCw,
  Puzzle,
  Layers,
  UserCog,
  Check,
  Rocket,
  Stethoscope,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { THEMES } from "@/config/themes";
import { BACKGROUNDS } from "@/config/backgrounds";
import { useThemeStore } from "@/store/theme-store";
import { useCapabilities, useHardwareProfile } from "@/hooks/use-telemetry";
import {
  isTauri,
  getAutostart,
  setAutostart,
  appUpdateInfo,
} from "@/lib/ipc";
import { CapabilityBadge } from "@/components/ui/capability-gate";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

/** Settings architecture — sections future modules slot into. */
const SETTINGS_SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette, ready: true },
  { id: "system", label: "System", icon: Monitor, ready: false },
  { id: "performance", label: "Performance", icon: Cpu, ready: false },
  { id: "battery", label: "Battery", icon: BatteryCharging, ready: false },
  { id: "ai", label: "AI", icon: Sparkles, ready: false },
  { id: "updates", label: "Updates", icon: RefreshCw, ready: false },
  { id: "plugins", label: "Plugins", icon: Puzzle, ready: false },
  { id: "themes", label: "Themes", icon: Layers, ready: true },
  { id: "profiles", label: "Profiles", icon: UserCog, ready: false },
];

export default function SettingsPage() {
  const { theme, setTheme, background, setBackground, density, setDensity } =
    useThemeStore();
  const caps = useCapabilities();
  const profile = useHardwareProfile();

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Personalize Nexus and manage your system preferences."
      />

      <div className="grid grid-cols-1 gap-lg lg:grid-cols-[220px_1fr]">
        {/* Section rail */}
        <GlassCard padding="sm" className="h-fit lg:sticky lg:top-0">
          <nav className="space-y-2xs">
            {SETTINGS_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="flex items-center gap-sm rounded-md px-sm py-xs text-sm text-content-muted transition-colors hover:bg-surface-raised hover:text-content"
              >
                <s.icon className="h-4 w-4" />
                <span className="flex-1">{s.label}</span>
                {!s.ready && <Badge size="sm">Soon</Badge>}
              </a>
            ))}
          </nav>
        </GlassCard>

        {/* Panels */}
        <motion.div
          variants={stagger(0.06)}
          initial="hidden"
          animate="show"
          className="space-y-lg"
        >
          {/* Appearance — Theme */}
          <motion.section variants={fadeUp} id="appearance">
            <GlassCard padding="lg">
              <h3 className="text-lg font-semibold text-content">Theme</h3>
              <p className="mb-md text-sm text-content-muted">
                Switching is instant and applies across the entire app.
              </p>
              <div className="grid grid-cols-2 gap-md sm:grid-cols-3">
                {THEMES.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTheme(t.id)}
                    className={cn(
                      "group relative overflow-hidden rounded-lg border p-sm text-left transition-all",
                      theme === t.id
                        ? "border-accent/60 shadow-glow"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <div
                      className="mb-sm h-16 rounded-md"
                      style={{
                        background: `linear-gradient(120deg, ${t.swatch[1]}, ${t.swatch[2]})`,
                      }}
                    />
                    <p className="flex items-center gap-xs text-sm font-medium text-content">
                      {t.label}
                      {theme === t.id && <Check className="h-3.5 w-3.5 text-accent" />}
                    </p>
                    <p className="text-2xs text-content-subtle">{t.description}</p>
                  </button>
                ))}
              </div>
            </GlassCard>
          </motion.section>

          {/* Appearance — Background */}
          <motion.section variants={fadeUp} id="themes">
            <GlassCard padding="lg">
              <h3 className="text-lg font-semibold text-content">Background</h3>
              <p className="mb-md text-sm text-content-muted">
                Pick an ambient style. Lower-cost options suit battery saver.
              </p>
              <div className="grid grid-cols-2 gap-sm sm:grid-cols-3">
                {BACKGROUNDS.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => setBackground(b.id)}
                    className={cn(
                      "rounded-lg border p-md text-left transition-all",
                      background === b.id
                        ? "border-accent/60 bg-accent/8"
                        : "border-border hover:border-border-strong",
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-content">{b.label}</p>
                      <Badge
                        size="sm"
                        variant={b.cost === "high" ? "warning" : "neutral"}
                      >
                        {b.cost}
                      </Badge>
                    </div>
                    <p className="mt-2xs text-2xs text-content-subtle">
                      {b.description}
                    </p>
                  </button>
                ))}
              </div>
            </GlassCard>
          </motion.section>

          {/* Density toggle */}
          <motion.section variants={fadeUp}>
            <GlassCard padding="lg" className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-content">Density</h3>
                <p className="text-sm text-content-muted">
                  Comfortable spacing, or compact for more on screen.
                </p>
              </div>
              <div className="flex rounded-md border border-border p-2xs">
                {(["comfortable", "compact"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDensity(d)}
                    className={cn(
                      "rounded px-md py-xs text-sm font-medium capitalize transition-colors",
                      density === d
                        ? "bg-accent/15 text-accent-strong"
                        : "text-content-muted hover:text-content",
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </GlassCard>
          </motion.section>

          {/* Device & detected control capabilities */}
          <motion.section variants={fadeUp} id="system">
            <GlassCard padding="lg">
              <div className="mb-md flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-content">Device & Capabilities</h3>
                  <p className="text-sm text-content-muted">
                    {profile ? `${profile.vendorLabel} · ${profile.cpuModel}` : "Detecting hardware…"}
                  </p>
                </div>
                {profile && <Badge variant="accent">{profile.gpuName.replace("NVIDIA GeForce ", "")}</Badge>}
              </div>

              <div className="grid grid-cols-1 gap-sm sm:grid-cols-2">
                {(
                  [
                    { key: "power", label: "Power Profiles", status: caps?.power.status },
                    { key: "fan", label: "Fan Control", status: caps?.fan.status },
                    { key: "rgb", label: "RGB Lighting", status: caps?.rgb.status },
                    { key: "battery", label: "Battery Charge Limit", status: caps?.battery.status },
                    { key: "mux", label: "GPU MUX Switch", status: caps?.mux.status },
                  ] as const
                ).map((c) => (
                  <div key={c.key} className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
                    <div>
                      <p className="text-sm font-medium text-content">{c.label}</p>
                      <p className="text-2xs text-content-subtle">
                        {c.status?.driver ? `via ${c.status.driver}` : c.status?.notes || "—"}
                      </p>
                    </div>
                    <CapabilityBadge status={c.status} />
                  </div>
                ))}
              </div>
              <p className="mt-md text-2xs text-content-subtle">
                Controls across Nexus are enabled only when the matching capability is detected.
              </p>
            </GlassCard>
          </motion.section>

          {/* Application */}
          <motion.section variants={fadeUp}>
            <ApplicationSettings />
          </motion.section>
        </motion.div>
      </div>
    </div>
  );
}

function ApplicationSettings() {
  const [autostart, setAuto] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    getAutostart().then(setAuto).catch(() => {});
    appUpdateInfo().then((u) => setVersion(u.currentVersion)).catch(() => {});
  }, []);

  async function toggle(v: boolean) {
    setAuto(v);
    if (isTauri()) await setAutostart(v).catch(() => setAuto(!v));
  }

  return (
    <GlassCard padding="lg">
      <div className="mb-md flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-content">Application</h3>
          <p className="text-sm text-content-muted">Startup, tray & updates</p>
        </div>
        <Badge variant="neutral">v{version ?? "0.1.0"}</Badge>
      </div>

      <label className="flex items-center justify-between border-b border-border-subtle py-md">
        <span className="flex items-center gap-sm">
          <Rocket className="h-4 w-4 text-content-muted" />
          <span>
            <span className="block text-sm font-medium text-content">Start on login</span>
            <span className="block text-2xs text-content-subtle">Launch Nexus in the tray at sign-in (for automation).</span>
          </span>
        </span>
        <Switch checked={autostart} onCheckedChange={toggle} />
      </label>

      <Link to="/doctor" className="flex items-center justify-between py-md">
        <span className="flex items-center gap-sm">
          <Stethoscope className="h-4 w-4 text-content-muted" />
          <span>
            <span className="block text-sm font-medium text-content">Run diagnostics</span>
            <span className="block text-2xs text-content-subtle">Health check, permissions & diagnostics export.</span>
          </span>
        </span>
        <RefreshCw className="h-4 w-4 text-content-subtle" />
      </Link>

      <p className="mt-2xs text-2xs text-content-subtle">
        Closing the window keeps Nexus running in the system tray. Updates ship via your distro package or GitHub releases.
      </p>
    </GlassCard>
  );
}
