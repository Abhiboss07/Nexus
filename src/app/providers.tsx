import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TelemetryProvider } from "@/providers/telemetry-provider";
import { useIntelligencePoller } from "@/hooks/use-intelligence";
import { InstallManager } from "@/components/integrations/install-manager";
import { NotificationManager } from "@/components/notifications/notification-manager";

/** Runs the single global intelligence poll; renders nothing. */
function IntelligencePoller() {
  useIntelligencePoller();
  return null;
}

/**
 * Global providers. TanStack Query is the data layer; in Phase 2 its query
 * functions call Tauri commands. Defaults are tuned for desktop telemetry:
 * short stale time, no window-focus refetch storms.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <TelemetryProvider>
        <IntelligencePoller />
        <InstallManager />
        <NotificationManager />
        {children}
      </TelemetryProvider>
    </QueryClientProvider>
  );
}
