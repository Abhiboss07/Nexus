import { create } from "zustand";

/**
 * Transient toast notifications (auto-dismissing) — distinct from the persistent
 * Notification Center. Used for immediate, in-the-moment feedback like AC
 * connect/disconnect. Persistent record of the same event still goes to the
 * Notification Center via `notify()`.
 */

export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: "success" | "info" | "warning" | "danger";
  /** Glyph hint. */
  icon?: "charging" | "battery" | "info";
  /** Render the electric charging flourish (Toaster gates it on reduce-motion). */
  electric?: boolean;
}

const DURATION_MS = 4500;
const MAX = 3;

interface ToastState {
  toasts: Toast[];
  push: (t: Omit<Toast, "id">) => void;
  remove: (id: number) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push: (t) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-MAX) }));
    window.setTimeout(() => get().remove(id), DURATION_MS);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience: raise a toast from anywhere. */
export function pushToast(t: Omit<Toast, "id">) {
  useToastStore.getState().push(t);
}
