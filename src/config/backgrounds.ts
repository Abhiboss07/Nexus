export type BackgroundMode =
  | "static"
  | "gradient"
  | "aurora"
  | "mesh"
  | "particles"
  | "grid";

export interface BackgroundMeta {
  id: BackgroundMode;
  label: string;
  description: string;
  /** Relative GPU/CPU cost — surfaced in settings for low-power profiles. */
  cost: "none" | "low" | "medium" | "high";
}

export const BACKGROUNDS: BackgroundMeta[] = [
  {
    id: "static",
    label: "Static",
    description: "Flat canvas, zero overhead",
    cost: "none",
  },
  {
    id: "gradient",
    label: "Gradient",
    description: "Soft static brand gradient",
    cost: "low",
  },
  {
    id: "aurora",
    label: "Aurora",
    description: "Slow drifting light fields",
    cost: "medium",
  },
  {
    id: "mesh",
    label: "Mesh",
    description: "Animated gradient mesh",
    cost: "medium",
  },
  {
    id: "particles",
    label: "Particle Field",
    description: "Floating connected nodes",
    cost: "high",
  },
  {
    id: "grid",
    label: "Cyber Grid",
    description: "Perspective neon grid",
    cost: "low",
  },
];

export const DEFAULT_BACKGROUND: BackgroundMode = "aurora";
