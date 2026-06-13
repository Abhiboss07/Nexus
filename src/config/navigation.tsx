import {
  LayoutDashboard,
  Gauge,
  Palette,
  BatteryCharging,
  HardDrive,
  ListChecks,
  Stethoscope,
  Gamepad2,
  Settings,
  Plug,
  Brain,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Short description used in command palette + tooltips. */
  description: string;
  /** Optional keyboard accelerator hint, e.g. "G then D". */
  accelerator?: string;
  /** Optional badge (count or status dot). */
  badge?: number | "dot";
  group: "core" | "tools" | "intelligence" | "system";
}

/**
 * The application's page registry. This is the single source of truth used by:
 *   - the router (route generation)
 *   - the sidebar (rendering + grouping)
 *   - the command palette (navigation results)
 * Adding a page is a one-line change here.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    path: "/",
    icon: LayoutDashboard,
    description: "System overview & live telemetry",
    accelerator: "G D",
    group: "core",
  },
  {
    id: "performance",
    label: "Performance",
    path: "/performance",
    icon: Gauge,
    description: "CPU, GPU & power tuning",
    accelerator: "G P",
    group: "core",
  },
  {
    id: "rgb",
    label: "RGB Studio",
    path: "/rgb",
    icon: Palette,
    description: "Lighting zones, effects & sync",
    group: "tools",
  },
  {
    id: "battery",
    label: "Battery Center",
    path: "/battery",
    icon: BatteryCharging,
    description: "Charge limits, health & profiles",
    group: "tools",
  },
  {
    id: "storage",
    label: "Storage Center",
    path: "/storage",
    icon: HardDrive,
    description: "Drives, usage & SMART health",
    group: "tools",
  },
  {
    id: "tasks",
    label: "Task Manager",
    path: "/tasks",
    icon: ListChecks,
    description: "Processes, services & resources",
    group: "system",
  },
  {
    id: "doctor",
    label: "System Doctor",
    path: "/doctor",
    icon: Stethoscope,
    description: "Diagnostics, fixes & optimization",
    badge: "dot",
    group: "system",
  },
  {
    id: "integrations",
    label: "Integrations",
    path: "/integrations",
    icon: Plug,
    description: "Detected ecosystem tools & runtimes",
    group: "system",
  },
  {
    id: "game",
    label: "Game Center",
    path: "/game",
    icon: Gamepad2,
    description: "Library, profiles & game boost",
    group: "tools",
  },
  {
    id: "intelligence",
    label: "Intelligence",
    path: "/intelligence",
    icon: Brain,
    description: "Reasoning, recommendations & insights",
    accelerator: "G I",
    group: "intelligence",
  },
  {
    id: "settings",
    label: "Settings",
    path: "/settings",
    icon: Settings,
    description: "Preferences, themes & plugins",
    accelerator: "G S",
    group: "system",
  },
];

export const NAV_GROUPS: Record<NavItem["group"], string> = {
  core: "Overview",
  tools: "Devices",
  intelligence: "Intelligence",
  system: "System",
};

export const NAV_GROUP_ORDER: NavItem["group"][] = [
  "core",
  "tools",
  "intelligence",
  "system",
];
