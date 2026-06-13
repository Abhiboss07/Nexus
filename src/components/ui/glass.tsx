import { forwardRef, type HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/cn";

/**
 * The Glass Engine surface primitive. Every elevated container in the app is a
 * GlassSurface so depth, blur, and edge highlights stay perfectly consistent.
 */
const glassVariants = cva("relative isolate overflow-hidden", {
  variants: {
    material: {
      panel: "glass glass-edge",
      strong: "glass glass-strong glass-edge",
      solid: "bg-surface-raised border border-border",
      sunken: "bg-surface-sunken border border-border-subtle",
    },
    radius: {
      md: "rounded-md",
      lg: "rounded-lg",
      xl: "rounded-xl",
      "2xl": "rounded-2xl",
    },
    elevation: {
      none: "",
      e1: "shadow-e1",
      e2: "shadow-e2",
      e3: "shadow-e3",
      e4: "shadow-e4",
    },
    padding: {
      none: "",
      sm: "p-sm",
      md: "p-md",
      lg: "p-lg",
    },
    grain: {
      true: "grain",
      false: "",
    },
  },
  defaultVariants: {
    material: "panel",
    radius: "xl",
    elevation: "e2",
    padding: "md",
    grain: false,
  },
});

export interface GlassSurfaceProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof glassVariants> {}

export const GlassSurface = forwardRef<HTMLDivElement, GlassSurfaceProps>(
  ({ className, material, radius, elevation, padding, grain, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        glassVariants({ material, radius, elevation, padding, grain }),
        className,
      )}
      {...props}
    />
  ),
);
GlassSurface.displayName = "GlassSurface";

/* --------------------------------------------------------------------------
   GlassCard — interactive variant with hover lift + accent ring.
   -------------------------------------------------------------------------- */
export interface GlassCardProps
  extends HTMLMotionProps<"div">,
    Pick<GlassSurfaceProps, "material" | "radius" | "elevation" | "padding"> {
  interactive?: boolean;
  glow?: boolean;
}

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  (
    {
      className,
      material = "panel",
      radius = "xl",
      elevation = "e2",
      padding = "md",
      interactive = false,
      glow = false,
      ...props
    },
    ref,
  ) => (
    <motion.div
      ref={ref}
      whileHover={
        interactive
          ? { y: -3, transition: { type: "spring", stiffness: 320, damping: 24 } }
          : undefined
      }
      className={cn(
        glassVariants({ material, radius, elevation, padding }),
        interactive &&
          "cursor-pointer transition-[box-shadow,border-color] duration-base hover:border-accent/40 hover:shadow-e3",
        glow && "hover:shadow-glow",
        className,
      )}
      {...props}
    />
  ),
);
GlassCard.displayName = "GlassCard";

/* GlassPanel — non-interactive structural pane (sidebar bg, drawers). */
export const GlassPanel = forwardRef<HTMLDivElement, GlassSurfaceProps>(
  (props, ref) => <GlassSurface ref={ref} elevation="none" {...props} />,
);
GlassPanel.displayName = "GlassPanel";
