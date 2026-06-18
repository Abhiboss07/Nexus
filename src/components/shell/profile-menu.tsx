import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { motion } from "framer-motion";
import {
  ChevronDown,
  Cpu,
  CircuitBoard,
  MemoryStick,
  Clock,
  Gauge,
  UserCog,
  Cog,
  Palette,
  Download,
  Upload,
  FileText,
  Power,
  type LucideIcon,
} from "lucide-react";
import { useHardwareProfile, useMemory } from "@/hooks/use-telemetry";
import { usePowerInfo, useActiveProfile, useNexusProfiles } from "@/hooks/use-control";
import { isTauri, systemUptime, quitApp, exportDiagnostics } from "@/lib/ipc";
import { formatBytes } from "@/lib/format";

/* ------------------------------ helpers --------------------------------- */

function formatUptime(secs: number): string {
  if (secs <= 0) return "—";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Snapshot every `nexus.*` localStorage key (theme, layout, persisted stores). */
function backupConfig() {
  const data: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("nexus.")) data[k] = localStorage.getItem(k) ?? "";
  }
  download(
    `nexus-config-${new Date().toISOString().slice(0, 10)}.json`,
    JSON.stringify({ kind: "nexus-config-backup", version: 1, data }, null, 2),
  );
}

async function exportDiagnosticsFile() {
  let md: string;
  try {
    md = isTauri() ? await exportDiagnostics() : "# Nexus Diagnostics (demo)\n";
  } catch {
    md = "# Nexus Diagnostics\n(export failed)\n";
  }
  download("nexus-diagnostics.md", md, "text/markdown");
}

/* ------------------------------ component -------------------------------- */

export function ProfileMenu() {
  const navigate = useNavigate();
  const profile = useHardwareProfile();
  const mem = useMemory();
  const power = usePowerInfo();
  const activeId = useActiveProfile();
  const nexusProfiles = useNexusProfiles();
  const restoreRef = useRef<HTMLInputElement>(null);
  const [uptime, setUptime] = useState(0);
  const [open, setOpen] = useState(false);

  // Refresh uptime whenever the menu opens (cheap, on-demand).
  useEffect(() => {
    if (!open || !isTauri()) return;
    systemUptime().then(setUptime).catch(() => {});
  }, [open]);

  const profileName =
    nexusProfiles.find((p) => p.id === activeId)?.name ?? (activeId ? activeId : "—");
  const powerMode = power?.current ?? "—";
  const device = profile?.productName || profile?.vendorLabel || "Linux device";

  function restore(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const data = parsed?.data ?? parsed;
        if (!data || typeof data !== "object") throw new Error("bad file");
        for (const [k, v] of Object.entries(data)) {
          if (k.startsWith("nexus.")) localStorage.setItem(k, String(v));
        }
        window.location.reload();
      } catch {
        window.alert("That doesn't look like a valid Nexus config backup.");
      }
    };
    reader.readAsText(file);
  }

  const stats: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: Cpu, label: "CPU", value: profile?.cpuModel ?? "—" },
    { icon: CircuitBoard, label: "GPU", value: profile?.gpuName ?? "—" },
    { icon: MemoryStick, label: "RAM", value: mem ? formatBytes(mem.totalBytes, 0) : "—" },
  ];
  const session: { icon: LucideIcon; label: string; value: string }[] = [
    { icon: Clock, label: "Uptime", value: formatUptime(uptime) },
    { icon: UserCog, label: "Profile", value: profileName },
    { icon: Gauge, label: "Power", value: powerMode },
  ];

  type Action = { icon: LucideIcon; label: string; run: () => void; danger?: boolean };
  const actions: Action[] = [
    { icon: UserCog, label: "Profile", run: () => navigate("/settings") },
    { icon: Cog, label: "Preferences", run: () => navigate("/settings") },
    {
      icon: Palette,
      label: "Themes",
      run: () => {
        navigate("/settings");
        window.setTimeout(
          () => document.getElementById("appearance")?.scrollIntoView({ behavior: "smooth" }),
          120,
        );
      },
    },
    { icon: Download, label: "Backup Configuration", run: backupConfig },
    { icon: Upload, label: "Restore Configuration", run: () => restoreRef.current?.click() },
    { icon: FileText, label: "Export Diagnostics", run: exportDiagnosticsFile },
    {
      icon: Power,
      label: "Quit Nexus",
      danger: true,
      run: () => {
        if (isTauri()) quitApp().catch(() => {});
      },
    },
  ];

  return (
    <>
      {/* Hidden file input drives Restore Configuration. */}
      <input ref={restoreRef} type="file" accept="application/json,.json" hidden onChange={restore} />
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <button className="no-drag ml-2xs flex items-center gap-xs rounded-full py-1 pl-1 pr-xs transition-colors hover:bg-surface-raised">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-gradient text-xs font-bold text-white">
              NX
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-content-subtle" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="end" sideOffset={10} asChild>
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              className="z-[var(--z-palette)] w-72 glass glass-strong glass-edge rounded-xl p-xs shadow-e4"
            >
              {/* Identity */}
              <div className="flex items-center gap-sm px-xs py-xs">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-gradient text-sm font-bold text-white">
                  NX
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-content">Nexus User</p>
                  <p className="truncate text-2xs text-content-subtle">{device}</p>
                </div>
              </div>

              {/* System spec */}
              <div className="mt-2xs space-y-2xs rounded-lg bg-surface-sunken/50 p-sm">
                {stats.map((s) => (
                  <Row key={s.label} icon={s.icon} label={s.label} value={s.value} />
                ))}
              </div>

              {/* Session */}
              <div className="mt-2xs grid grid-cols-3 gap-2xs">
                {session.map((s) => (
                  <div key={s.label} className="rounded-lg bg-surface-sunken/40 p-xs text-center">
                    <s.icon className="mx-auto h-3.5 w-3.5 text-content-subtle" />
                    <p className="mt-2xs truncate text-2xs font-semibold capitalize text-content" title={s.value}>
                      {s.value}
                    </p>
                    <p className="text-[10px] uppercase tracking-wide text-content-subtle">{s.label}</p>
                  </div>
                ))}
              </div>

              <DropdownMenu.Separator className="my-xs h-px bg-border" />

              {actions.map((a) => (
                <DropdownMenu.Item
                  key={a.label}
                  onSelect={(e) => {
                    e.preventDefault();
                    a.run();
                  }}
                  className={
                    "flex cursor-pointer items-center gap-sm rounded-md px-xs py-xs text-sm outline-none transition-colors data-[highlighted]:bg-surface-raised " +
                    (a.danger
                      ? "text-danger data-[highlighted]:text-danger"
                      : "text-content-muted data-[highlighted]:text-content")
                  }
                >
                  <a.icon className="h-4 w-4" />
                  {a.label}
                </DropdownMenu.Item>
              ))}
            </motion.div>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </>
  );
}

function Row({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-sm">
      <Icon className="h-3.5 w-3.5 shrink-0 text-content-subtle" />
      <span className="w-9 shrink-0 text-2xs text-content-subtle">{label}</span>
      <span className="min-w-0 flex-1 truncate text-2xs font-medium text-content" title={value}>
        {value}
      </span>
    </div>
  );
}
