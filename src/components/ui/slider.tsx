import { forwardRef } from "react";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "@/lib/cn";

export const Slider = forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center",
      className,
    )}
    {...props}
  >
    <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-surface-raised">
      <SliderPrimitive.Range className="absolute h-full bg-brand-gradient" />
    </SliderPrimitive.Track>
    {(props.value ?? props.defaultValue ?? [0]).map((_, i) => (
      <SliderPrimitive.Thumb
        key={i}
        className="block h-4 w-4 rounded-full border-2 border-accent bg-white shadow-e2 outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-accent/60"
      />
    ))}
  </SliderPrimitive.Root>
));
Slider.displayName = "Slider";

/** Labelled slider with live value chip. */
export function SliderRow({
  label,
  value,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  unit = "",
}: {
  label: string;
  value: number;
  onValueChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <div className="py-xs">
      <div className="mb-xs flex items-center justify-between">
        <span className="text-sm font-medium text-content">{label}</span>
        <span className="rounded-md bg-surface-raised px-xs py-[2px] text-xs font-semibold tabular-nums text-accent-strong">
          {value}
          {unit}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onValueChange(v[0])}
      />
    </div>
  );
}
