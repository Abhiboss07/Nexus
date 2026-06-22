import { create } from "zustand";
import {
  isTauri,
  notifAdd,
  notifList,
  notifUnread,
  notifMarkRead,
  notifMarkAllRead,
  notifClear,
} from "@/lib/ipc";
import type { AppNotification, NotifyInput } from "@/lib/notification-types";

/**
 * Notification Center store — the app-wide event hub, backed by SQLite.
 *
 * The backend is the source of truth: `notify()` persists via `notif_add`, which
 * emits `notification://new`; a single global listener (NotificationManager)
 * calls `ingest()`. So every event — frontend or backend (auto-profile switch,
 * etc.) — flows through one path. In the browser (no Tauri) it degrades to an
 * in-memory list so the UI still works.
 */

const CAP = 200;

interface NotifState {
  items: AppNotification[];
  unread: number;
  loaded: boolean;
  load: () => void;
  /** Raise a notification (persisted + broadcast). */
  notify: (n: NotifyInput) => void;
  /** Apply a notification pushed from the backend listener. */
  ingest: (n: AppNotification) => void;
  markRead: (id: number) => void;
  markAllRead: () => void;
  clear: () => void;
}

export const useNotificationStore = create<NotifState>((set, get) => ({
  items: [],
  unread: 0,
  loaded: false,

  load: () => {
    if (!isTauri()) {
      set({ loaded: true });
      return;
    }
    Promise.allSettled([notifList(100), notifUnread()]).then(([l, u]) => {
      set({
        items: l.status === "fulfilled" ? l.value : [],
        unread: u.status === "fulfilled" ? u.value : 0,
        loaded: true,
      });
    });
  },

  notify: (n) => {
    const body = n.body ?? "";
    if (!isTauri()) {
      get().ingest({
        id: Date.now(),
        ts: Date.now(),
        kind: n.kind,
        severity: n.severity,
        title: n.title,
        body,
        read: false,
      });
      return;
    }
    // Persist; the backend emits notification://new → ingest() prepends it.
    notifAdd(n.kind, n.severity, n.title, body).catch(() => {});
  },

  ingest: (n) =>
    set((s) => {
      if (s.items.some((x) => x.id === n.id)) return s; // de-dupe collapsed bursts
      const items = [n, ...s.items].slice(0, CAP);
      return { items, unread: s.unread + (n.read ? 0 : 1) };
    }),

  markRead: (id) => {
    if (isTauri()) notifMarkRead(id).catch(() => {});
    set((s) => {
      const item = s.items.find((x) => x.id === id);
      if (!item || item.read) return s;
      return {
        items: s.items.map((x) => (x.id === id ? { ...x, read: true } : x)),
        unread: Math.max(0, s.unread - 1),
      };
    });
  },

  markAllRead: () => {
    if (isTauri()) notifMarkAllRead().catch(() => {});
    set((s) => ({ items: s.items.map((x) => ({ ...x, read: true })), unread: 0 }));
  },

  clear: () => {
    if (isTauri()) notifClear().catch(() => {});
    set({ items: [], unread: 0 });
  },
}));

/** Convenience: raise a notification from anywhere. */
export function notify(n: NotifyInput) {
  useNotificationStore.getState().notify(n);
}
