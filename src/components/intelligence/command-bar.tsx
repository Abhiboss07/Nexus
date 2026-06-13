import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ArrowRight, Wand2, CheckCircle2, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTelemetrySource } from "@/hooks/use-telemetry";
import {
  nlpCommand,
  setProfile,
  rgbApply,
  rgbOff,
  applyNexusProfile,
} from "@/lib/ipc";
import type { CommandResult, NlpAction } from "@/lib/intelligence-types";
import { cn } from "@/lib/cn";

const SUGGESTIONS = [
  "boost performance",
  "make it quieter",
  "set lights to blue",
  "how hot is the CPU?",
];

const COLORS: Record<string, number> = {
  red: 0, orange: 30, yellow: 55, green: 120, teal: 175, cyan: 175,
  blue: 215, purple: 270, violet: 270, pink: 320, magenta: 320,
};

/** Minimal client-side intent parser for browser/demo mode. */
function demoParse(input: string): CommandResult {
  const q = input.toLowerCase().trim();
  const has = (...w: string[]) => w.some((x) => q.includes(x));
  if (has("boost", "performance", "turbo", "faster", "gaming"))
    return { understood: true, intent: "power.performance", confidence: 92, response: "Switching to the Performance power profile.", action: { type: "setPowerProfile", profile: "performance" } };
  if (has("quiet", "silent", "saver", "battery", "cooler", "eco"))
    return { understood: true, intent: "power.saver", confidence: 90, response: "Switching to the Power Saver profile.", action: { type: "setPowerProfile", profile: "power-saver" } };
  if (has("balanced", "normal"))
    return { understood: true, intent: "power.balanced", confidence: 88, response: "Switching to the Balanced power profile.", action: { type: "setPowerProfile", profile: "balanced" } };
  if (has("rainbow"))
    return { understood: true, intent: "rgb.rainbow", confidence: 90, response: "Setting a rainbow effect.", action: { type: "setRgb", effect: "rainbow", hue: 0 } };
  if (has("off") && has("light", "rgb"))
    return { understood: true, intent: "rgb.off", confidence: 90, response: "Turning off the lighting.", action: { type: "rgbOff" } };
  const color = Object.keys(COLORS).find((c) => q.includes(c));
  if (color && has("light", "rgb", "keyboard", "color", color))
    return { understood: true, intent: "rgb.color", confidence: 90, response: `Setting the keyboard to ${color}.`, action: { type: "setRgb", effect: "static", hue: COLORS[color] } };
  if (has("how hot", "temperature", "temps"))
    return { understood: true, intent: "query.temps", confidence: 80, response: "Demo mode — connect under Tauri to read live temps.", action: { type: "info" } };
  const nav: [string, string][] = [["performance", "/performance"], ["battery", "/battery"], ["rgb", "/rgb"], ["storage", "/storage"], ["game", "/game"], ["integration", "/integrations"]];
  if (has("open", "go to", "show")) {
    const m = nav.find(([k]) => q.includes(k));
    if (m) return { understood: true, intent: "navigate", confidence: 88, response: `Opening ${m[0]}.`, action: { type: "navigate", path: m[1] } };
  }
  return { understood: false, intent: "none", confidence: 0, response: 'Try "boost performance", "make it quieter", or "set lights to blue".', action: null };
}

export function CommandBar() {
  const navigate = useNavigate();
  const live = useTelemetrySource() === "live";
  const [input, setInput] = useState("");
  const [result, setResult] = useState<CommandResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function execute(a: NlpAction) {
    if (a.type === "navigate") return navigate(a.path);
    if (!live) return;
    try {
      if (a.type === "setPowerProfile") await setProfile(a.profile);
      else if (a.type === "setRgb") await rgbApply({ effect: a.effect, hue: a.hue, brightness: 100, speed: 50 });
      else if (a.type === "rgbOff") await rgbOff();
      else if (a.type === "applyNexusProfile") await applyNexusProfile(a.id);
    } catch {
      /* surfaced via response text */
    }
  }

  async function run(text?: string) {
    const cmd = (text ?? input).trim();
    if (!cmd) return;
    setBusy(true);
    setInput(cmd);
    let res: CommandResult;
    try {
      res = live ? await nlpCommand(cmd) : demoParse(cmd);
    } catch {
      res = demoParse(cmd);
    }
    setResult(res);
    if (res.action) await execute(res.action);
    setBusy(false);
  }

  return (
    <div className="rounded-2xl glass glass-strong glass-edge p-md shadow-e2">
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="flex items-center gap-sm rounded-xl border border-border bg-surface-sunken/60 p-2xs pl-md focus-within:border-accent/50">
        <Wand2 className="h-4 w-4 text-accent" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Tell Nexus what to do — e.g. “boost performance”, “make it quieter”…"
          className="flex-1 bg-transparent py-xs text-sm text-content outline-none placeholder:text-content-subtle"
        />
        <Button type="submit" variant="primary" size="icon" disabled={busy || !input.trim()}>
          <ArrowRight className="h-4 w-4" />
        </Button>
      </form>

      <div className="mt-sm flex flex-wrap items-center gap-xs">
        <Sparkles className="h-3.5 w-3.5 text-content-subtle" />
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => run(s)} className="rounded-full border border-border px-sm py-2xs text-2xs text-content-muted transition-colors hover:border-accent/50 hover:text-content">
            {s}
          </button>
        ))}
      </div>

      <AnimatePresence>
        {result && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={cn("mt-md flex items-center gap-sm rounded-lg border p-sm text-sm", result.understood ? "border-success/30 bg-success/10 text-content" : "border-warning/30 bg-warning/10 text-content")}>
            {result.understood ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <HelpCircle className="h-4 w-4 shrink-0 text-warning" />}
            <span className="min-w-0 flex-1">{result.response}</span>
            {result.understood && <Badge variant="neutral" size="sm">{result.confidence}% · {result.intent}</Badge>}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
