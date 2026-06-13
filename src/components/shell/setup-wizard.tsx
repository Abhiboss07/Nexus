import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Hexagon,
  ScanSearch,
  ShieldCheck,
  Rocket,
  Check,
  X,
  AlertTriangle,
  Copy,
  ArrowRight,
  Cpu,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  isTauri,
  getSetupState,
  setSetupComplete,
  runHealthCheck,
  checkPermissions,
  getAutostart,
  setAutostart,
} from "@/lib/ipc";
import { useHardwareProfile } from "@/hooks/use-telemetry";
import type { HealthCheck, Permissions } from "@/lib/system-types";
import { cn } from "@/lib/cn";

/** Decides whether the first-run wizard should show (Tauri, not yet completed). */
function useSetupGate() {
  const [needed, setNeeded] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
    getSetupState().then((s) => setNeeded(!s.completed)).catch(() => setNeeded(false));
  }, []);
  return { needed, dismiss: () => setNeeded(false) };
}

const STEPS = ["welcome", "scan", "permissions", "preferences", "done"] as const;
type Step = (typeof STEPS)[number];

export function SetupWizard() {
  const { needed, dismiss } = useSetupGate();
  const profile = useHardwareProfile();
  const [step, setStep] = useState<Step>("welcome");
  const [health, setHealth] = useState<HealthCheck | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [autostart, setAuto] = useState(false);

  useEffect(() => {
    if (step === "scan" && !health) runHealthCheck().then(setHealth).catch(() => {});
    if (step === "permissions" && !perms) checkPermissions().then(setPerms).catch(() => {});
    if (step === "preferences") getAutostart().then(setAuto).catch(() => {});
  }, [step, health, perms]);

  if (!needed) return null;

  const idx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(STEPS.length - 1, idx + 1)]);

  async function finish() {
    try {
      await setAutostart(autostart);
      await setSetupComplete();
    } catch {
      /* best-effort */
    }
    dismiss();
  }

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] grid place-items-center bg-black/60 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-[min(94vw,560px)] glass glass-strong glass-edge rounded-2xl p-xl shadow-e4"
      >
        {/* Progress dots */}
        <div className="mb-lg flex items-center justify-center gap-xs">
          {STEPS.map((s, i) => (
            <span key={s} className={cn("h-1.5 rounded-full transition-all", i <= idx ? "w-6 bg-accent" : "w-1.5 bg-border")} />
          ))}
        </div>

        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }}>
            {step === "welcome" && (
              <Center>
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-brand-gradient shadow-glow">
                  <Hexagon className="h-8 w-8 text-white" />
                </div>
                <h2 className="mt-md font-display text-2xl font-semibold text-content">Welcome to Nexus</h2>
                <p className="mt-2xs text-sm text-content-muted">
                  {profile ? `Detected your ${profile.vendorLabel} — ${profile.cpuModel}.` : "Let's get your machine set up."}
                </p>
                <p className="mt-md text-xs text-content-subtle">A quick setup validates drivers, capabilities and permissions.</p>
              </Center>
            )}

            {step === "scan" && (
              <div>
                <Header icon={ScanSearch} title="Driver & capability scan" subtitle="Checking what Nexus can control on this device" />
                <div className="mt-md max-h-72 space-y-2xs overflow-y-auto">
                  {(health?.checks ?? []).map((c) => (
                    <CheckRow key={c.name} name={c.name} status={c.status} detail={c.detail} />
                  ))}
                  {!health && <p className="py-md text-center text-sm text-content-subtle">Scanning…</p>}
                </div>
              </div>
            )}

            {step === "permissions" && (
              <div>
                <Header icon={ShieldCheck} title="Permissions" subtitle="RGB & fan control need the input group" />
                <div className="mt-md space-y-sm">
                  <PermRow label="Power profile control" ok={perms?.powerControllable} />
                  <PermRow label="RGB write access" ok={perms?.rgbWritable} />
                  <PermRow label="Fan write access" ok={perms?.fanWritable} />
                </div>
                {perms && !perms.inInputGroup && (
                  <div className="mt-md rounded-lg border border-warning/30 bg-warning/10 p-md">
                    <p className="flex items-center gap-xs text-sm font-medium text-warning"><AlertTriangle className="h-4 w-4" /> Add yourself to the input group</p>
                    <button onClick={() => navigator.clipboard?.writeText("sudo usermod -aG input $USER")} className="mt-xs flex w-full items-center gap-xs rounded-md bg-surface-sunken px-sm py-xs text-left">
                      <code className="flex-1 truncate text-2xs text-content-muted">sudo usermod -aG input $USER</code>
                      <Copy className="h-3.5 w-3.5 text-content-subtle" />
                    </button>
                    <p className="mt-2xs text-2xs text-content-subtle">Then log out and back in. You can finish setup now — telemetry & power profiles work without it.</p>
                  </div>
                )}
              </div>
            )}

            {step === "preferences" && (
              <div>
                <Header icon={Rocket} title="Preferences" subtitle="A couple of optional defaults" />
                <label className="mt-md flex items-center justify-between rounded-lg border border-border p-md">
                  <span>
                    <span className="block text-sm font-medium text-content">Start on login</span>
                    <span className="block text-2xs text-content-subtle">Run Nexus in the tray when you sign in (for automation).</span>
                  </span>
                  <Switch checked={autostart} onCheckedChange={setAuto} />
                </label>
                <p className="mt-md flex items-center gap-xs text-2xs text-content-subtle"><Cpu className="h-3 w-3" /> Closing the window keeps Nexus in the system tray.</p>
              </div>
            )}

            {step === "done" && (
              <Center>
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-success/15 text-success">
                  <Check className="h-8 w-8" />
                </div>
                <h2 className="mt-md font-display text-2xl font-semibold text-content">You're all set</h2>
                <p className="mt-2xs text-sm text-content-muted">Nexus is monitoring your {profile?.vendorLabel ?? "system"} with live telemetry.</p>
              </Center>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-xl flex items-center justify-between">
          <button onClick={finish} className="text-xs text-content-subtle hover:text-content">Skip</button>
          {step === "done" ? (
            <Button variant="primary" size="md" onClick={finish}><Check className="h-4 w-4" /> Finish</Button>
          ) : (
            <Button variant="primary" size="md" onClick={next}>Continue <ArrowRight className="h-4 w-4" /></Button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="text-center">{children}</div>;
}
function Header({ icon: Icon, title, subtitle }: { icon: typeof Cpu; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-md">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-accent/12 text-accent-strong"><Icon className="h-5 w-5" /></div>
      <div>
        <h2 className="font-display text-lg font-semibold text-content">{title}</h2>
        <p className="text-xs text-content-muted">{subtitle}</p>
      </div>
    </div>
  );
}
function CheckRow({ name, status, detail }: { name: string; status: string; detail: string }) {
  const tone = status === "ok" ? "text-success" : status === "warn" ? "text-warning" : "text-danger";
  const Icon = status === "ok" ? Check : status === "warn" ? AlertTriangle : X;
  return (
    <div className="flex items-center gap-sm rounded-md px-2xs py-xs">
      <Icon className={cn("h-4 w-4 shrink-0", tone)} />
      <span className="flex-1 text-sm text-content">{name}</span>
      <span className="truncate text-2xs text-content-subtle">{detail}</span>
    </div>
  );
}
function PermRow({ label, ok }: { label: string; ok?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border-subtle bg-surface-sunken/40 p-md">
      <span className="text-sm text-content">{label}</span>
      {ok ? <span className="flex items-center gap-xs text-2xs font-medium text-success"><Check className="h-3.5 w-3.5" /> Ready</span> : <span className="flex items-center gap-xs text-2xs font-medium text-content-subtle"><Lock className="h-3 w-3" /> Needs input group</span>}
    </div>
  );
}
