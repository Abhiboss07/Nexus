/** TS mirror of src-tauri/src/notifications.rs. */

export type NotificationSeverity = "info" | "success" | "warning" | "critical";

/** Source category. */
export type NotificationKind =
  | "battery"
  | "thermal"
  | "integration"
  | "profile"
  | "doctor"
  | "update"
  | "system";

export interface AppNotification {
  id: number;
  /** ms epoch */
  ts: number;
  kind: NotificationKind | string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  read: boolean;
}

/** What callers pass to `notify(...)`. */
export interface NotifyInput {
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body?: string;
}
