import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TelemetryProvider } from "@/providers/telemetry-provider";

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
      <TelemetryProvider>{children}</TelemetryProvider>
    </QueryClientProvider>
  );
}
