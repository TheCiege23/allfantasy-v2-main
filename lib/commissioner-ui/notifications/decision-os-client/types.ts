import type { CommissionerPlatformResponse, CommissionerNotificationPayload } from '../../contracts'

/**
 * Notification Center owns the inbox, categories, read/unread state,
 * priority, history, actions, preferences, and cross-module routing —
 * but per its own contract's doc comment, a `CommissionerNotificationPayload`
 * never duplicates the module data behind it, only enough (`message`,
 * `sourceModuleId`, an optional `relatedLink`) to know about it and get
 * back to it. `getNotifications()` returns the full history (read and
 * unread alike) — the "inbox" is simply that same list's unread subset,
 * a UI-level filter, not a second method. Read/unread toggling and mute
 * preferences are local, client-persisted state (mirroring every other
 * module's own precedent — Reports' share/generate, Automation's
 * enable/disable — never a second adapter mutation method); the `read`
 * flag returned here is only the fetched baseline a fresh session starts
 * from.
 */
export interface NotificationsClient {
  getNotifications(): Promise<CommissionerPlatformResponse<CommissionerNotificationPayload[]>>
  getSummary(): Promise<CommissionerPlatformResponse<NotificationsSummary>>
}

/** The only shape Mission Control ever sees — computed by Notification Center over its own notifications, never by Mission Control. */
export interface NotificationsSummary {
  unreadCount: number
  criticalCount: number
  headline: string
}
