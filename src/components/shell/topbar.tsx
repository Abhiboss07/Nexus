import { useLocation } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { motion } from "framer-motion";
import { Bell, Search, Zap } from "lucide-react";
import { NAV_ITEMS } from "@/config/navigation";
import { useUIStore } from "@/store/ui-store";
import { useNotificationStore } from "@/store/notification-store";
import { Button } from "@/components/ui/button";
import { ThemeSwitcher } from "./theme-switcher";
import { TelemetryBadge } from "./telemetry-badge";
import { InstallIndicator } from "./install-indicator";
import { WindowControls } from "./window-controls";
import { ProfileMenu } from "./profile-menu";
import { Kbd } from "@/components/ui/kbd";

export function TopBar() {
  const { pathname } = useLocation();
  const openPalette = useUIStore((s) => s.toggleCommandPalette);
  const toggleNotifications = useUIStore((s) => s.setNotificationsOpen);
  const unread = useNotificationStore((s) => s.unread);

  const current =
    NAV_ITEMS.find((i) =>
      i.path === "/" ? pathname === "/" : pathname.startsWith(i.path),
    ) ?? NAV_ITEMS[0];

  return (
    <header className="drag-region z-[var(--z-topbar)] flex h-[var(--topbar-height)] shrink-0 items-center gap-md border-b border-border-subtle px-lg">
      {/* Page title / breadcrumb */}
      <div className="flex min-w-0 items-center gap-sm">
        <current.icon className="h-[18px] w-[18px] text-accent-strong" />
        <h1 className="truncate font-display text-lg font-semibold text-content">
          {current.label}
        </h1>
      </div>

      {/* Global search → opens command palette */}
      <button
        onClick={openPalette}
        className="no-drag group mx-auto flex h-9 w-full max-w-md items-center gap-sm rounded-md border border-border bg-surface-sunken/60 px-sm text-content-subtle transition-colors hover:border-border-strong hover:text-content-muted"
      >
        <Search className="h-4 w-4" />
        <span className="flex-1 text-left text-sm">Search or jump to…</span>
        <Kbd>⌘ K</Kbd>
      </button>

      {/* Right cluster */}
      <div className="flex items-center gap-2xs">
        <InstallIndicator />
        <TelemetryBadge />
        <QuickActions />
        <ThemeSwitcher />
        <Button
          variant="ghost"
          size="icon"
          className="no-drag relative"
          aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ""}`}
          onClick={() => toggleNotifications(true)}
        >
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-[3px] text-[9px] font-bold leading-none text-white">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
        <ProfileMenu />
        <WindowControls />
      </div>
    </header>
  );
}

function QuickActions() {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" className="no-drag" aria-label="Quick actions">
          <Zap className="h-[18px] w-[18px]" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={10} asChild>
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="z-[var(--z-palette)] w-56 glass glass-strong glass-edge rounded-xl p-xs shadow-e4"
          >
            <p className="px-xs py-2xs text-2xs font-semibold uppercase tracking-wider text-content-subtle">
              Quick Actions
            </p>
            {[
              "Boost Performance",
              "Toggle RGB",
              "Battery Saver",
              "Run Diagnostics",
            ].map((a) => (
              <DropdownMenu.Item
                key={a}
                className="cursor-pointer rounded-md px-xs py-xs text-sm text-content-muted outline-none transition-colors data-[highlighted]:bg-surface-raised data-[highlighted]:text-content"
              >
                {a}
              </DropdownMenu.Item>
            ))}
          </motion.div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

