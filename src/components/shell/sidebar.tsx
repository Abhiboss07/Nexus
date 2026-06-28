import { NavLink, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { PanelLeftClose, PanelLeftOpen, Hexagon } from "lucide-react";
import {
  NAV_GROUPS,
  NAV_GROUP_ORDER,
  NAV_ITEMS,
  type NavItem,
} from "@/config/navigation";
import { useUIStore } from "@/store/ui-store";
import { GlassTooltip } from "@/components/ui/tooltip";
import { StatusDot } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { useRenderCount } from "@/components/dev/render-count";

export function Sidebar() {
  useRenderCount("Sidebar");
  const expanded = useUIStore((s) => s.sidebarExpanded);
  const toggle = useUIStore((s) => s.toggleSidebar);
  const { pathname } = useLocation();

  return (
    <motion.aside
      initial={false}
      animate={{ width: expanded ? "var(--sidebar-width)" : "var(--sidebar-width-collapsed)" }}
      transition={{ type: "spring", stiffness: 300, damping: 32 }}
      className="relative z-[var(--z-sidebar)] flex h-full flex-col gap-md glass glass-strong glass-edge border-y-0 border-l-0 px-sm py-md"
    >
      {/* Brand */}
      <div className="flex items-center gap-sm px-2xs">
        <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-md bg-brand-gradient shadow-glow">
          <Hexagon className="h-5 w-5 text-white" strokeWidth={2.5} />
        </div>
        <AnimatePresence initial={false}>
          {expanded && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <p className="font-display text-base font-semibold leading-none text-content">
                Nexus
              </p>
              <p className="text-2xs uppercase tracking-[0.2em] text-content-subtle">
                Control Center
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-md overflow-y-auto scrollbar-none pr-2xs">
        {NAV_GROUP_ORDER.map((group) => {
          const items = NAV_ITEMS.filter((i) => i.group === group);
          if (!items.length) return null;
          return (
            <div key={group} className="space-y-2xs">
              <AnimatePresence initial={false}>
                {expanded && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="px-sm pb-2xs pt-xs text-2xs font-semibold uppercase tracking-[0.16em] text-content-subtle"
                  >
                    {NAV_GROUPS[group]}
                  </motion.p>
                )}
              </AnimatePresence>
              {items.map((item) => (
                <SidebarLink
                  key={item.id}
                  item={item}
                  expanded={expanded}
                  active={
                    item.path === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.path)
                  }
                />
              ))}
            </div>
          );
        })}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggle}
        className="no-drag flex h-9 items-center justify-center gap-xs rounded-md text-content-subtle transition-colors hover:bg-surface-raised hover:text-content"
      >
        {expanded ? (
          <>
            <PanelLeftClose className="h-4 w-4" />
            <span className="text-xs font-medium">Collapse</span>
          </>
        ) : (
          <PanelLeftOpen className="h-4 w-4" />
        )}
      </button>
    </motion.aside>
  );
}

function SidebarLink({
  item,
  expanded,
  active,
}: {
  item: NavItem;
  expanded: boolean;
  active: boolean;
}) {
  const Icon = item.icon;

  const link = (
    <NavLink
      to={item.path}
      className={cn(
        "no-drag group relative flex h-10 items-center gap-sm rounded-md px-sm outline-none transition-colors",
        active ? "text-content" : "text-content-muted hover:text-content",
        !expanded && "justify-center px-0",
      )}
    >
      {active && (
        <motion.span
          layoutId="sidebar-active"
          transition={{ type: "spring", stiffness: 380, damping: 30 }}
          className="absolute inset-0 -z-10 rounded-md bg-accent/12 ring-1 ring-inset ring-accent/25"
        />
      )}
      {active && (
        <motion.span
          layoutId="sidebar-rail"
          className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand-gradient"
        />
      )}
      <span className="relative grid place-items-center">
        <Icon
          className={cn("h-[18px] w-[18px] transition-colors", active && "text-accent-strong")}
          strokeWidth={2}
        />
        {item.badge === "dot" && (
          <StatusDot tone="warning" className="absolute -right-1 -top-1" />
        )}
      </span>
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.span
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.15 }}
            className="flex-1 truncate text-sm font-medium"
          >
            {item.label}
          </motion.span>
        )}
      </AnimatePresence>
      {expanded && typeof item.badge === "number" && (
        <span className="rounded-full bg-accent/15 px-xs py-[1px] text-2xs font-semibold text-accent-strong">
          {item.badge}
        </span>
      )}
    </NavLink>
  );

  // When collapsed, surface label + description via tooltip.
  if (!expanded) {
    return (
      <GlassTooltip
        side="right"
        label={
          <div className="space-y-[2px]">
            <p className="font-semibold text-content">{item.label}</p>
            <p className="text-2xs text-content-muted">{item.description}</p>
          </div>
        }
      >
        {link}
      </GlassTooltip>
    );
  }
  return link;
}
