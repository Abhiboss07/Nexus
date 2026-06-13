import { createContext, useContext, useId } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import { cn } from "@/lib/cn";

/**
 * Animated, accessible tabs built on Radix. The active indicator is a shared
 * `layoutId` pill so it glides between triggers. A context carries the unique
 * layout group id so multiple Tabs instances on a page don't collide.
 */
const TabsLayoutCtx = createContext<string>("tabs");

export const Tabs = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>) => {
  const id = useId();
  return (
    <TabsLayoutCtx.Provider value={id}>
      <TabsPrimitive.Root className={cn("flex flex-col", className)} {...props} />
    </TabsLayoutCtx.Provider>
  );
};

export const TabsList = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List
    className={cn(
      "inline-flex items-center gap-2xs rounded-lg border border-border bg-surface-sunken/60 p-2xs",
      className,
    )}
    {...props}
  />
);

export const TabsTrigger = ({
  className,
  value,
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) => {
  const layoutId = useContext(TabsLayoutCtx);
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        "group relative inline-flex h-8 items-center gap-xs rounded-md px-md text-sm font-medium text-content-muted outline-none transition-colors data-[state=active]:text-content",
        className,
      )}
      {...props}
    >
      <span className="relative z-10 flex items-center gap-xs">{children}</span>
      <ActiveBg layoutId={layoutId} />
    </TabsPrimitive.Trigger>
  );
};

/** Renders the sliding pill only when its trigger is active (via CSS sibling). */
function ActiveBg({ layoutId }: { layoutId: string }) {
  return (
    <span className="absolute inset-0 hidden group-data-[state=active]:block">
      <motion.span
        layoutId={`${layoutId}-tab`}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="absolute inset-0 rounded-md bg-surface-raised shadow-e1 ring-1 ring-inset ring-border"
      />
    </span>
  );
}

export const TabsContent = ({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) => (
  <TabsPrimitive.Content
    className={cn(
      "mt-lg outline-none data-[state=active]:animate-fade-up",
      className,
    )}
    {...props}
  />
);
