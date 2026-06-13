import { create } from "zustand";
import { persist } from "zustand/middleware";

interface UIState {
  /** Sidebar expanded vs. collapsed (icon rail). Persisted. */
  sidebarExpanded: boolean;
  /** Command palette visibility (Ctrl/Cmd+K). Ephemeral. */
  commandPaletteOpen: boolean;
  /** Notifications drawer visibility. Ephemeral. */
  notificationsOpen: boolean;

  toggleSidebar: () => void;
  setSidebarExpanded: (v: boolean) => void;
  setCommandPaletteOpen: (v: boolean) => void;
  toggleCommandPalette: () => void;
  setNotificationsOpen: (v: boolean) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      sidebarExpanded: true,
      commandPaletteOpen: false,
      notificationsOpen: false,

      toggleSidebar: () =>
        set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
      setSidebarExpanded: (sidebarExpanded) => set({ sidebarExpanded }),
      setCommandPaletteOpen: (commandPaletteOpen) => set({ commandPaletteOpen }),
      toggleCommandPalette: () =>
        set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),
      setNotificationsOpen: (notificationsOpen) => set({ notificationsOpen }),
    }),
    {
      name: "nexus.ui",
      // Only persist layout prefs, not transient overlay state.
      partialize: (s) => ({ sidebarExpanded: s.sidebarExpanded }),
    },
  ),
);
