/**
 * NotificationDrawerController — contract for notification drawer/panel open/close.
 * State is held by the consuming component (e.g. NotificationBell); this module documents
 * the expected behavior and optional keyboard (Escape to close).
 */

/** Escape key closes the notification panel when open. */
const NOTIFICATION_DRAWER_CLOSE_KEY = "Escape"

export function isNotificationDrawerCloseKey(key: string): boolean {
  return key === NOTIFICATION_DRAWER_CLOSE_KEY
}
