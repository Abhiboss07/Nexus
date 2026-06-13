import { memo } from "react";
import { useThemeStore } from "@/store/theme-store";
import { ParticleField } from "./particle-field";

/**
 * The app-wide ambient background. Sits behind the entire shell (z -10) and
 * renders one of six modes. Everything is GPU-cheap CSS except the particle
 * field, which is opt-in. Wrapped in memo so theme/route changes don't churn it.
 */
export const BackgroundCanvas = memo(function BackgroundCanvas() {
  const background = useThemeStore((s) => s.background);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-canvas">
      {/* Base vignette common to all modes */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_-10%,rgb(var(--color-accent)/0.06),transparent_60%)]" />

      {background === "gradient" && (
        <div className="absolute inset-0 opacity-70 bg-[radial-gradient(60%_60%_at_15%_10%,rgb(var(--bg-aurora-a)/0.18),transparent_60%),radial-gradient(50%_50%_at_85%_20%,rgb(var(--bg-aurora-b)/0.16),transparent_60%),radial-gradient(60%_60%_at_60%_100%,rgb(var(--bg-aurora-c)/0.12),transparent_60%)]" />
      )}

      {background === "aurora" && (
        <>
          <div className="absolute -left-[10%] top-[-15%] h-[55vh] w-[55vh] rounded-full bg-[rgb(var(--bg-aurora-a))] opacity-25 blur-[120px] animate-aurora-shift" />
          <div className="absolute right-[-8%] top-[10%] h-[45vh] w-[45vh] rounded-full bg-[rgb(var(--bg-aurora-b))] opacity-20 blur-[120px] animate-aurora-shift [animation-delay:-6s]" />
          <div className="absolute bottom-[-20%] left-[30%] h-[50vh] w-[50vh] rounded-full bg-[rgb(var(--bg-aurora-c))] opacity-[0.14] blur-[140px] animate-aurora-shift [animation-delay:-12s]" />
        </>
      )}

      {background === "mesh" && (
        <div
          className="absolute inset-0 opacity-80 animate-aurora-shift"
          style={{
            backgroundImage:
              "radial-gradient(at 20% 20%, rgb(var(--bg-aurora-a)/0.22) 0px, transparent 50%)," +
              "radial-gradient(at 80% 10%, rgb(var(--bg-aurora-b)/0.2) 0px, transparent 50%)," +
              "radial-gradient(at 70% 80%, rgb(var(--bg-aurora-c)/0.18) 0px, transparent 50%)," +
              "radial-gradient(at 10% 90%, rgb(var(--color-iris)/0.16) 0px, transparent 50%)",
          }}
        />
      )}

      {background === "grid" && (
        <>
          <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(var(--color-accent)/0.1),transparent_70%)]" />
          <div
            className="absolute inset-0 opacity-[0.18] animate-grid-pan"
            style={{
              backgroundImage:
                "linear-gradient(rgb(var(--color-accent)/0.5) 1px, transparent 1px)," +
                "linear-gradient(90deg, rgb(var(--color-accent)/0.5) 1px, transparent 1px)",
              backgroundSize: "var(--grid-size) var(--grid-size)",
              maskImage:
                "linear-gradient(to bottom, transparent, black 30%, black 70%, transparent)",
            }}
          />
        </>
      )}

      {background === "particles" && (
        <div className="absolute inset-0 opacity-90">
          <ParticleField />
        </div>
      )}
    </div>
  );
});
