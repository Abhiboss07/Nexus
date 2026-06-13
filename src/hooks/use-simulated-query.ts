import { useCallback, useEffect, useRef, useState } from "react";

type Status = "loading" | "success" | "error";

/**
 * Mimics a TanStack Query lifecycle over mock data so pages render real
 * loading / success / error states in Phase 1.5. In Phase 2 each call site
 * swaps this for `useQuery` against a Tauri command — the component contract
 * (status + data + refetch) is identical.
 */
export function useSimulatedQuery<T>(
  factory: () => T,
  opts: { delay?: number; failRate?: number } = {},
) {
  const { delay = 650, failRate = 0 } = opts;
  const [status, setStatus] = useState<Status>("loading");
  const [data, setData] = useState<T | null>(null);
  const factoryRef = useRef(factory);
  factoryRef.current = factory;

  const load = useCallback(() => {
    setStatus("loading");
    const id = window.setTimeout(() => {
      if (Math.random() < failRate) {
        setStatus("error");
        return;
      }
      setData(factoryRef.current());
      setStatus("success");
    }, delay);
    return () => window.clearTimeout(id);
  }, [delay, failRate]);

  useEffect(() => load(), [load]);

  return { status, data, refetch: load } as const;
}
