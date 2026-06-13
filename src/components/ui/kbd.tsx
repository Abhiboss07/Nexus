import { cn } from "@/lib/cn";

/** Keyboard hint chip. */
export function Kbd({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-[20px] items-center justify-center rounded border border-border bg-surface-sunken px-1 text-2xs font-medium text-content-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
