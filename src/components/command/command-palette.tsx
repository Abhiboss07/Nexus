import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { CornerDownLeft, Search } from "lucide-react";
import { NAV_ITEMS } from "@/config/navigation";
import { ACTION_COMMANDS, type CommandContext } from "@/config/commands";
import { useUIStore } from "@/store/ui-store";
import { useThemeStore } from "@/store/theme-store";
import { Kbd } from "@/components/ui/kbd";

export function CommandPalette() {
  const open = useUIStore((s) => s.commandPaletteOpen);
  const setOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const navigate = useNavigate();
  const setTheme = useThemeStore((s) => s.setTheme);
  const setBackground = useThemeStore((s) => s.setBackground);

  const ctx: CommandContext = {
    navigate,
    setTheme,
    setBackground,
    close: () => setOpen(false),
  };

  const onNavigate = useCallback(
    (path: string) => {
      navigate(path);
      setOpen(false);
    },
    [navigate, setOpen],
  );

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[var(--z-palette)] bg-black/40 backdrop-blur-sm"
              />
            </Dialog.Overlay>
            <Dialog.Content
              aria-describedby={undefined}
              className="fixed left-1/2 top-[18%] z-[var(--z-palette)] w-[min(92vw,640px)] -translate-x-1/2 outline-none"
              asChild
            >
              <motion.div
                initial={{ opacity: 0, y: -12, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ type: "spring", stiffness: 340, damping: 30 }}
              >
                <Dialog.Title className="sr-only">Command palette</Dialog.Title>
                <Command
                  loop
                  className="overflow-hidden rounded-2xl glass glass-strong glass-edge shadow-e4"
                >
                  <div className="flex items-center gap-sm border-b border-border-subtle px-md">
                    <Search className="h-4 w-4 text-content-subtle" />
                    <Command.Input
                      autoFocus
                      placeholder="Type a command or search…"
                      className="h-12 flex-1 bg-transparent text-sm text-content outline-none placeholder:text-content-subtle"
                    />
                    <Kbd>ESC</Kbd>
                  </div>

                  <Command.List className="max-h-[52vh] overflow-y-auto p-xs">
                    <Command.Empty className="py-lg text-center text-sm text-content-subtle">
                      No results found.
                    </Command.Empty>

                    <Command.Group
                      heading="Navigation"
                      className="[&_[cmdk-group-heading]]:px-xs [&_[cmdk-group-heading]]:py-2xs [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-content-subtle"
                    >
                      {NAV_ITEMS.map((item) => (
                        <PaletteItem
                          key={item.id}
                          value={`${item.label} ${item.description}`}
                          onSelect={() => onNavigate(item.path)}
                        >
                          <item.icon className="h-4 w-4 text-content-muted" />
                          <span className="flex-1">{item.label}</span>
                          <span className="text-2xs text-content-subtle">
                            {item.description}
                          </span>
                        </PaletteItem>
                      ))}
                    </Command.Group>

                    {["Actions", "Theme", "Background"].map((group) => (
                      <Command.Group
                        key={group}
                        heading={group}
                        className="[&_[cmdk-group-heading]]:px-xs [&_[cmdk-group-heading]]:py-2xs [&_[cmdk-group-heading]]:text-2xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-content-subtle"
                      >
                        {ACTION_COMMANDS.filter((c) => c.group === group).map((cmd) => (
                          <PaletteItem
                            key={cmd.id}
                            value={`${cmd.label} ${cmd.keywords?.join(" ") ?? ""}`}
                            onSelect={() => cmd.run(ctx)}
                          >
                            <cmd.icon className="h-4 w-4 text-content-muted" />
                            <span className="flex-1">{cmd.label}</span>
                            {cmd.hint && (
                              <span className="text-2xs text-content-subtle">
                                {cmd.hint}
                              </span>
                            )}
                          </PaletteItem>
                        ))}
                      </Command.Group>
                    ))}
                  </Command.List>

                  <div className="flex items-center justify-between border-t border-border-subtle px-md py-xs text-2xs text-content-subtle">
                    <span className="flex items-center gap-xs">
                      <CornerDownLeft className="h-3 w-3" /> to select
                    </span>
                    <span className="flex items-center gap-xs">
                      <Kbd>↑</Kbd>
                      <Kbd>↓</Kbd> to navigate
                    </span>
                  </div>
                </Command>
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

function PaletteItem({
  value,
  onSelect,
  children,
}: {
  value: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className="flex cursor-pointer items-center gap-sm rounded-md px-xs py-2xs text-sm text-content-muted outline-none transition-colors data-[selected=true]:bg-accent/15 data-[selected=true]:text-content"
    >
      {children}
    </Command.Item>
  );
}
