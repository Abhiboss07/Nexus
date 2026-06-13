/** TS mirror of src-tauri/src/control/intelligence (Phase 5.0). */

export interface Evidence {
  metric: string;
  value: string;
  threshold: string;
}

export interface Recommendation {
  id: string;
  title: string;
  detail: string;
  category: string;
  severity: "info" | "warning" | "critical";
  confidence: number;
  evidence: Evidence[];
  action: string | null;
}

export interface Trend {
  metric: string;
  current: number;
  average: number;
  min: number;
  max: number;
  direction: "rising" | "falling" | "stable";
  slope: number;
  samples: number;
  series: number[];
}

export interface TrendReport {
  metrics: Trend[];
}

export interface MaintenanceInsight {
  component: string;
  prediction: string;
  etaDays: number | null;
  confidence: number;
  severity: "info" | "warning" | "critical";
  evidence: Evidence[];
}

export interface BottleneckReport {
  bottleneck: string;
  confidence: number;
  detail: string;
  evidence: Evidence[];
}

export interface Subsystem {
  name: string;
  score: number;
  status: "optimal" | "good" | "warning" | "critical";
  detail: string;
  weight: number;
}

export interface SystemHealth {
  overallScore: number;
  grade: string;
  subsystems: Subsystem[];
}

export interface AutomationSuggestion {
  id: string;
  title: string;
  detail: string;
  triggerLabel: string;
  profileId: string;
  confidence: number;
  evidence: Evidence[];
}

export interface IntelligenceReport {
  health: SystemHealth;
  bottleneck: BottleneckReport;
  recommendations: Recommendation[];
  trends: TrendReport;
  maintenance: MaintenanceInsight[];
  automationSuggestions: AutomationSuggestion[];
}

export type NlpAction =
  | { type: "navigate"; path: string }
  | { type: "setPowerProfile"; profile: string }
  | { type: "setRgb"; effect: string; hue: number }
  | { type: "rgbOff" }
  | { type: "applyNexusProfile"; id: string }
  | { type: "info" };

export interface CommandResult {
  understood: boolean;
  intent: string;
  confidence: number;
  response: string;
  action: NlpAction | null;
}
