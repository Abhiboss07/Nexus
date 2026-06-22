import { AnimatePresence, motion } from "framer-motion";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  Trash2,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  BatteryCharging,
  Thermometer,
  Package,
  Sliders,
  Stethoscope,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { useUIStore } from "@/store/ui-store";
import { useNotificationStore } from "@/store/notification-store";
import type { AppNotification, NotificationSeverity } from "@/lib/notification-types";
import { cn } from "@/lib/cn";

const SEV: Record<NotificationSeverity, { icon: LucideIcon; cls: string }> = {
  info: { icon: Info, cls: "text-info" },
  success: { icon: CheckCircle2, cls: "text-success" },
  warning: { icon: AlertTriangle, cls: "text-warning" },
  critical: { icon: XCircle, cls: "text-danger" },
};

const KIND_ICON: Record<string, LucideIcon> = {
  battery: BatteryCharging,
  thermal: Thermometer,
  integration: Package,
  profile: Sliders,
  doctor: Stethoscope,
  update: RefreshCw,
  system: Bell,
};

function relTime(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ts).toLocaleDateString([], { month: "short", day: "numeric" });
}

/** Slide-in Notification Center, controlled by ui-store.notificationsOpen. */
export function NotificationDrawer() {
  const open = useUIStore((s) => s.notificationsOpen);
  const setOpen = useUIStore((s) => s.setNotificationsOpen);
  const { items, unread, markRead, markAllRead, clear } = useNotificationStore();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[var(--z-palette)] bg-black/30"
            onClick={() => setOpen(false)}
          />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className="fixed right-0 top-0 z-[var(--z-palette)] flex h-full w-[380px] max-w-[92vw] flex-col glass glass-strong glass-edge border-l border-border shadow-e4"
          >
            <header className="flex items-center justify-between border-b border-border-subtle px-lg py-md">
              <p className="flex items-center gap-sm text-sm font-semibold text-content">
                <Bell className="h-4 w-4 text-accent" /> Notifications
                {unread > 0 && (
                  <span className="rounded-full bg-accent px-xs text-2xs font-bold text-white">{unread}</span>
                )}
              </p>
              <div className="flex items-center gap-xs">
                <button
                  onClick={markAllRead}
                  disabled={unread === 0}
                  title="Mark all read"
                  className="grid h-7 w-7 place-items-center rounded-md text-content-subtle transition-colors hover:bg-surface-raised hover:text-content disabled:opacity-40"
                >
                  <CheckCheck className="h-4 w-4" />
                </button>
                <button
                  onClick={clear}
                  disabled={items.length === 0}
                  title="Clear all"
                  className="grid h-7 w-7 place-items-center rounded-md text-content-subtle transition-colors hover:bg-surface-raised hover:text-danger disabled:opacity-40"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto p-sm">
              {items.length === 0 ? (
                <div className="grid h-full place-items-center text-center">
                  <div>
                    <BellOff className="mx-auto h-8 w-8 text-content-subtle" />
                    <p className="mt-sm text-sm text-content-muted">No notifications</p>
                    <p className="text-2xs text-content-subtle">System events show up here.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-2xs">
                  {items.map((n) => (
                    <NotificationRow key={n.id} n={n} onRead={() => markRead(n.id)} />
                  ))}
                </div>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

function NotificationRow({ n, onRead }: { n: AppNotification; onRead: () => void }) {
  const sev = SEV[n.severity as NotificationSeverity] ?? SEV.info;
  const Kind = KIND_ICON[n.kind] ?? Bell;
  return (
    <button
      onClick={onRead}
      className={cn(
        "flex w-full items-start gap-sm rounded-lg border p-sm text-left transition-colors",
        n.read
          ? "border-border-subtle bg-transparent"
          : "border-accent/30 bg-accent/5 hover:border-accent/50",
      )}
    >
      <div className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-sunken/60", sev.cls)}>
        <Kind className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-sm">
          <p className="flex items-center gap-xs truncate text-sm font-medium text-content">
            <sev.icon className={cn("h-3 w-3 shrink-0", sev.cls)} />
            {n.title}
          </p>
          <span className="shrink-0 text-2xs tabular-nums text-content-subtle">{relTime(n.ts)}</span>
        </div>
        {n.body && <p className="mt-2xs text-2xs text-content-muted">{n.body}</p>}
      </div>
      {!n.read && <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent opacity-0 group-hover:opacity-100" />}
    </button>
  );
}
