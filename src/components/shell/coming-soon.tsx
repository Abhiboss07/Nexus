import { motion } from "framer-motion";
import { type LucideIcon, Sparkles } from "lucide-react";
import { GlassCard } from "@/components/ui/glass";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "./page-header";
import { stagger, fadeUp } from "@/lib/motion";

/**
 * Architectural placeholder for feature pages not yet implemented in this phase.
 * Establishes the page scaffold (header + planned-capability grid) so each
 * module already has a consistent home to grow into.
 */
export function ComingSoon({
  title,
  description,
  icon: Icon,
  capabilities,
}: {
  title: string;
  description: string;
  icon: LucideIcon;
  capabilities: { title: string; detail: string }[];
}) {
  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={<Badge variant="accent">Phase 2</Badge>}
      />

      <GlassCard padding="lg" className="mb-lg flex items-center gap-lg overflow-hidden">
        <div className="grid h-16 w-16 shrink-0 place-items-center rounded-xl bg-brand-gradient shadow-glow">
          <Icon className="h-7 w-7 text-white" />
        </div>
        <div className="flex-1">
          <p className="flex items-center gap-xs text-sm font-medium text-content">
            <Sparkles className="h-4 w-4 text-accent" />
            Module scaffolded — hardware integration lands in Phase 2
          </p>
          <p className="mt-2xs text-sm text-content-muted">
            The shell, routing, state slots and design language are ready. Live
            data and controls will mount into this surface without refactoring.
          </p>
        </div>
      </GlassCard>

      <motion.div
        variants={stagger(0.06)}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3"
      >
        {capabilities.map((c) => (
          <motion.div key={c.title} variants={fadeUp}>
            <GlassCard interactive padding="lg" className="h-full">
              <p className="text-sm font-semibold text-content">{c.title}</p>
              <p className="mt-2xs text-xs text-content-muted">{c.detail}</p>
            </GlassCard>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
