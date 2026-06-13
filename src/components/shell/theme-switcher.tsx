import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { motion } from "framer-motion";
import { Check, Palette } from "lucide-react";
import { THEMES } from "@/config/themes";
import { BACKGROUNDS } from "@/config/backgrounds";
import { useThemeStore } from "@/store/theme-store";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function ThemeSwitcher() {
  const { theme, setTheme, background, setBackground } = useThemeStore();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" className="no-drag" aria-label="Themes">
          <Palette className="h-[18px] w-[18px]" />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={10}
          asChild
        >
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="z-[var(--z-palette)] w-72 glass glass-strong glass-edge rounded-xl p-sm shadow-e4"
          >
            <p className="px-2xs pb-xs pt-2xs text-2xs font-semibold uppercase tracking-wider text-content-subtle">
              Theme
            </p>
            <div className="grid grid-cols-1 gap-2xs">
              {THEMES.map((t) => (
                <DropdownMenu.Item
                  key={t.id}
                  onSelect={(e) => {
                    e.preventDefault();
                    setTheme(t.id);
                  }}
                  className={cn(
                    "flex cursor-pointer items-center gap-sm rounded-md px-xs py-xs outline-none transition-colors data-[highlighted]:bg-surface-raised",
                    theme === t.id && "bg-surface-raised",
                  )}
                >
                  <span className="flex -space-x-1">
                    {t.swatch.map((c, i) => (
                      <span
                        key={i}
                        className="h-4 w-4 rounded-full ring-2 ring-surface"
                        style={{ background: c }}
                      />
                    ))}
                  </span>
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-content">
                      {t.label}
                    </span>
                    <span className="block text-2xs text-content-subtle">
                      {t.description}
                    </span>
                  </span>
                  {theme === t.id && <Check className="h-4 w-4 text-accent" />}
                </DropdownMenu.Item>
              ))}
            </div>

            <DropdownMenu.Separator className="my-xs h-px bg-border" />

            <p className="px-2xs pb-xs text-2xs font-semibold uppercase tracking-wider text-content-subtle">
              Background
            </p>
            <div className="grid grid-cols-3 gap-2xs">
              {BACKGROUNDS.map((b) => (
                <DropdownMenu.Item
                  key={b.id}
                  onSelect={(e) => {
                    e.preventDefault();
                    setBackground(b.id);
                  }}
                  className={cn(
                    "cursor-pointer rounded-md px-xs py-xs text-center text-2xs font-medium outline-none transition-colors data-[highlighted]:bg-surface-raised",
                    background === b.id
                      ? "bg-accent/15 text-accent-strong"
                      : "text-content-muted",
                  )}
                >
                  {b.label}
                </DropdownMenu.Item>
              ))}
            </div>
          </motion.div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
