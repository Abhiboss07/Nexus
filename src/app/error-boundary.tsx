import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary — production crash recovery for the UI. Catches render
 * errors, shows a recoverable fallback, and logs to the console (mirrored to the
 * backend log via the panic hook when running under Tauri).
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // eslint-disable-next-line no-console
    console.error("[nexus] UI error:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="grid h-screen w-screen place-items-center bg-canvas p-lg text-center">
        <div className="max-w-md">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-danger/12 text-danger">
            <AlertTriangle className="h-7 w-7" />
          </div>
          <h1 className="mt-md font-display text-2xl font-semibold text-content">Something went wrong</h1>
          <p className="mt-2xs text-sm text-content-muted">
            Nexus hit an unexpected error. Your settings are safe — reloading usually fixes it.
          </p>
          <pre className="mt-md max-h-32 overflow-auto rounded-lg bg-surface-sunken p-sm text-left text-2xs text-content-subtle">
            {this.state.error.message}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="mt-md inline-flex items-center gap-xs rounded-md bg-brand-gradient px-lg py-sm text-sm font-medium text-white shadow-glow"
          >
            <RotateCw className="h-4 w-4" /> Reload Nexus
          </button>
        </div>
      </div>
    );
  }
}
