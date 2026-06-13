import { motion } from "framer-motion";
import {
  Gauge,
  MonitorPlay,
  Rocket,
  Palette,
  Fan,
  Cpu,
  Gamepad2,
  FlaskConical,
  Container,
  Package,
  Boxes,
  Monitor,
  Check,
  X,
  Copy,
  RefreshCw,
  Plug,
  type LucideIcon,
} from "lucide-react";
import { PageHeader } from "@/components/shell/page-header";
import { GlassCard } from "@/components/ui/glass";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionTitle } from "@/components/ui/section";
import { useIntegrations } from "@/hooks/use-integrations";
import type { Integration, IntegrationCategory } from "@/lib/integrations-types";
import { stagger, fadeUp } from "@/lib/motion";
import { cn } from "@/lib/cn";

const ICON: Record<string, LucideIcon> = {
  mangohud: Gauge,
  gamescope: MonitorPlay,
  gamemode: Rocket,
  openrgb: Palette,
  coolercontrol: Fan,
  lact: Cpu,
  steam: Gamepad2,
  lutris: Gamepad2,
  heroic: Gamepad2,
  bottles: FlaskConical,
  docker: Container,
  podman: Container,
  flatpak: Package,
  snap: Package,
  "nvidia-container-toolkit": Boxes,
  "display-server": Monitor,
};

const CATEGORIES: { id: IntegrationCategory; label: string; icon: LucideIcon }[] = [
  { id: "gaming", label: "Gaming Tools", icon: Rocket },
  { id: "hardware", label: "Hardware Control", icon: Cpu },
  { id: "launchers", label: "Game Launchers", icon: Gamepad2 },
  { id: "containers", label: "Containers & Packaging", icon: Boxes },
  { id: "system", label: "System", icon: Monitor },
];

export default function IntegrationsPage() {
  const { items, loading, refresh } = useIntegrations();
  const detected = items.filter((i) => i.detected).length;

  return (
    <div>
      <PageHeader
        title="System Integrations"
        description="What Nexus has discovered about your Linux ecosystem."
        actions={
          <>
            <Badge variant="accent" size="md">
              <Plug className="h-3.5 w-3.5" /> {detected} / {items.length} detected
            </Badge>
            <Button variant="solid" size="md" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Rescan
            </Button>
          </>
        }
      />

      <motion.div variants={stagger(0.05)} initial="hidden" animate="show" className="space-y-lg">
        {CATEGORIES.map((cat) => {
          const group = items.filter((i) => i.category === cat.id);
          if (!group.length) return null;
          const found = group.filter((i) => i.detected).length;
          return (
            <motion.section key={cat.id} variants={fadeUp}>
              <SectionTitle
                title={cat.label}
                description={`${found} of ${group.length} available`}
                action={<cat.icon className="h-4 w-4 text-content-subtle" />}
              />
              <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
                {group.map((it) => (
                  <IntegrationCard key={it.id} item={it} />
                ))}
              </div>
            </motion.section>
          );
        })}
      </motion.div>
    </div>
  );
}

function IntegrationCard({ item }: { item: Integration }) {
  const Icon = ICON[item.id] ?? Package;
  return (
    <GlassCard
      interactive
      padding="md"
      className={cn("flex items-start gap-md", !item.detected && "opacity-80")}
    >
      <div
        className={cn(
          "grid h-11 w-11 shrink-0 place-items-center rounded-lg",
          item.detected ? "bg-accent/12 text-accent-strong" : "bg-surface-raised text-content-subtle",
        )}
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-sm">
          <p className="truncate text-sm font-semibold text-content">{item.name}</p>
          {item.detected ? (
            <span className="flex shrink-0 items-center gap-xs text-2xs font-medium text-success">
              <Check className="h-3.5 w-3.5" /> Installed
            </span>
          ) : (
            <span className="flex shrink-0 items-center gap-xs text-2xs font-medium text-content-subtle">
              <X className="h-3 w-3" /> Missing
            </span>
          )}
        </div>
        {item.detected ? (
          <p className="mt-2xs truncate text-2xs text-content-muted">{item.detail || "Detected"}</p>
        ) : item.hint ? (
          <button
            onClick={() => navigator.clipboard?.writeText(item.hint)}
            className="group mt-2xs flex w-full items-center gap-xs rounded-md bg-surface-sunken/60 px-xs py-2xs text-left"
            title="Copy install command"
          >
            <code className="min-w-0 flex-1 truncate text-2xs text-content-subtle">{item.hint}</code>
            <Copy className="h-3 w-3 shrink-0 text-content-subtle transition-colors group-hover:text-content" />
          </button>
        ) : (
          <p className="mt-2xs text-2xs text-content-subtle">Not available</p>
        )}
      </div>
    </GlassCard>
  );
}
