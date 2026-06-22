import { AnimatePresence, motion } from "framer-motion";
import {
  Zap,
  BatteryCharging,
  BatteryLow,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
  type LucideIcon,
} from "lucide-react";
import { useToastStore, type Toast } from "@/store/toast-store";
import { useReduceMotion } from "@/store/prefs-store";
import { cn } from "@/lib/cn";

const TONE: Record<Toast["tone"], { cls: string; fallback: LucideIcon }> = {
  success: { cls: "text-success", fallback: CheckCircle2 },
  info: { cls: "text-info", fallback: Info },
  warning: { cls: "text-warning", fallback: AlertTriangle },
  danger: { cls: "text-danger", fallback: XCircle },
};

const ICON: Record<NonNullable<Toast["icon"]>, LucideIcon> = {
  charging: BatteryCharging,
  battery: BatteryLow,
  info: Info,
};

/** Top-center transient toast stack. Mounted once in the app shell. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const remove = useToastStore((s) => s.remove);
  const reduce = useReduceMotion();

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[var(--z-palette)] flex flex-col items-center gap-sm px-md">
      <AnimatePresence>
        {toasts.map((t) => {
          const tone = TONE[t.tone];
          const Icon = t.icon ? ICON[t.icon] : tone.fallback;
          const electric = t.electric && !reduce;
          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="pointer-events-auto relative w-full max-w-sm overflow-hidden rounded-xl glass glass-strong glass-edge px-md py-sm shadow-e4"
            >
              {/* Electric charging flourish: a sweep of light along the top edge. */}
              {electric && (
                <motion.div
                  className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-success to-transparent"
                  initial={{ x: "-100%" }}
                  animate={{ x: "100%" }}
                  transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }}
                />
              )}
              <div className="flex items-start gap-sm">
                <motion.div
                  className={cn("mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-md bg-surface-sunken/60", tone.cls)}
                  animate={electric ? { scale: [1, 1.12, 1] } : undefined}
                  transition={electric ? { duration: 1.4, repeat: Infinity, ease: "easeInOut" } : undefined}
                >
                  <Icon className="h-4 w-4" />
                  {electric && <Zap className="absolute h-3 w-3 text-success" />}
                </motion.div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-content">{t.title}</p>
                  {t.body && <p className="mt-2xs text-2xs text-content-muted">{t.body}</p>}
                </div>
                <button
                  onClick={() => remove(t.id)}
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-content-subtle transition-colors hover:text-content"
                  aria-label="Dismiss"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
