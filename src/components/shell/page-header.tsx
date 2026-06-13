import { motion } from "framer-motion";
import { fadeUp } from "@/lib/motion";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="show"
      className="mb-lg flex flex-wrap items-end justify-between gap-md"
    >
      <div>
        <h2 className="font-display text-3xl font-semibold tracking-tight text-content">
          {title}
        </h2>
        {description && (
          <p className="mt-2xs text-sm text-content-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-xs">{actions}</div>}
    </motion.div>
  );
}
