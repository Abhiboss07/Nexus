/**
 * Estimated battery/performance impact per power-profile name. Used for the
 * Power Center previews. Covers both power-profiles-daemon and platform_profile
 * naming. Unknown names fall back to a neutral estimate.
 */
export type Impact = "low" | "medium" | "high";

export interface ProfileImpact {
  label: string;
  description: string;
  performance: Impact;
  battery: Impact; // battery *life* (high = best longevity)
  tone: "success" | "info" | "warning";
}

const MAP: Record<string, ProfileImpact> = {
  performance: { label: "Performance", description: "Max clocks & responsiveness", performance: "high", battery: "low", tone: "warning" },
  balanced: { label: "Balanced", description: "Smart power for everyday use", performance: "medium", battery: "medium", tone: "info" },
  "power-saver": { label: "Power Saver", description: "Quiet & efficient, longest runtime", performance: "low", battery: "high", tone: "success" },
  // platform_profile equivalents
  "low-power": { label: "Low Power", description: "Quiet & efficient", performance: "low", battery: "high", tone: "success" },
  quiet: { label: "Quiet", description: "Silent & efficient", performance: "low", battery: "high", tone: "success" },
  cool: { label: "Cool", description: "Thermal-optimized", performance: "medium", battery: "medium", tone: "info" },
};

export function profileImpact(name: string): ProfileImpact {
  return (
    MAP[name] ?? {
      label: name.replace(/-/g, " "),
      description: "Custom power profile",
      performance: "medium",
      battery: "medium",
      tone: "info",
    }
  );
}

export const impactLevel: Record<Impact, number> = { low: 33, medium: 66, high: 100 };
