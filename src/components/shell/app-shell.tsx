import { Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Sidebar } from "./sidebar";
import { TopBar } from "./topbar";
import { BackgroundCanvas } from "@/components/background/background-canvas";
import { CommandPalette } from "@/components/command/command-palette";
import { NotificationDrawer } from "@/components/notifications/notification-drawer";
import { Toaster } from "@/components/ui/toaster";
import { SetupWizard } from "@/components/shell/setup-wizard";
import { RenderCountOverlay, useRenderCount } from "@/components/dev/render-count";
import { PerfOverlay } from "@/components/dev/perf-overlay";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useGlobalHotkeys } from "@/hooks/use-hotkeys";
import { useAmbientPause } from "@/hooks/use-ambient-pause";
import { pageTransition } from "@/lib/motion";

/**
 * The persistent application chrome: ambient background, sidebar, top bar, and
 * an animated content outlet. Only the routed content remounts on navigation.
 */
export function AppShell() {
  useRenderCount("AppShell");
  useGlobalHotkeys();
  useAmbientPause();
  const location = useLocation();

  return (
    <TooltipProvider delayDuration={200} skipDelayDuration={300}>
      <BackgroundCanvas />
      <CommandPalette />
      <NotificationDrawer />
      <Toaster />
      <SetupWizard />
      <RenderCountOverlay />
      <PerfOverlay />

      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />

        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar />
          <main className="relative flex-1 overflow-y-auto">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={location.pathname}
                variants={pageTransition}
                initial="hidden"
                animate="show"
                exit="exit"
                className="mx-auto h-full w-full max-w-[1600px] px-lg py-lg"
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </main>
        </div>
      </div>
    </TooltipProvider>
  );
}
