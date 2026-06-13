import { cn } from "@/lib/cn";

/** Horizontal hue spectrum slider (0–360). */
export function HuePicker({
  hue,
  onChange,
  className,
}: {
  hue: number;
  onChange: (h: number) => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-xs", className)}>
      <div className="relative h-6">
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "linear-gradient(to right, hsl(0 90% 55%), hsl(60 90% 55%), hsl(120 90% 55%), hsl(180 90% 55%), hsl(240 90% 55%), hsl(300 90% 55%), hsl(360 90% 55%))",
          }}
        />
        <input
          type="range"
          min={0}
          max={360}
          value={hue}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[3px] [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow-e3"
          style={{ accentColor: `hsl(${hue} 90% 55%)` }}
        />
      </div>
      <div className="flex flex-wrap gap-xs">
        {[0, 30, 50, 140, 180, 210, 270, 320].map((h) => (
          <button
            key={h}
            onClick={() => onChange(h)}
            className={cn(
              "h-7 w-7 rounded-full ring-2 transition-transform hover:scale-110",
              hue === h ? "ring-white" : "ring-transparent",
            )}
            style={{ background: `hsl(${h} 90% 55%)` }}
            aria-label={`Set hue ${h}`}
          />
        ))}
      </div>
    </div>
  );
}
