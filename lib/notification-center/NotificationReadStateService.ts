/**
 * NotificationReadStateService — mark as read / mark all as read API contract.
 * Actual API calls are in useNotifications; this module documents endpoints and optimistic update behavior.
 */

export const NOTIFICATIONS_ENDPOINT = "/api/shared/notifications"
export const NOTIFICATIONS_READ_ENDPOINT = NOTIFICATIONS_ENDPOINT
export const NOTIFICATIONS_READ_ALL_ENDPOINT = `${NOTIFICATIONS_ENDPOINT}/read-all`

export function getNotificationsEndpoint(limit: number, options?: { leagueId?: string | null }): string {
  const safeLimit = Math.min(Math.max(Number(limit) || 1, 1), 100)
  const params = new URLSearchParams({ limit: String(safeLimit) })
  if (options?.leagueId) params.set("leagueId", options.leagueId)
  return `${NOTIFICATIONS_ENDPOINT}?${params.toString()}`
}

export function getNotificationsReadAllEndpoint(options?: { leagueId?: string | null }): string {
  if (!options?.leagueId) return NOTIFICATIONS_READ_ALL_ENDPOINT
  return `${NOTIFICATIONS_READ_ALL_ENDPOINT}?leagueId=${encodeURIComponent(options.leagueId)}`
}

/** Path for PATCH single notification read: /api/shared/notifications/[notificationId]/read */
export function getNotificationReadEndpoint(notificationId: string): string {
  return `${NOTIFICATIONS_ENDPOINT}/${encodeURIComponent(notificationId)}/read`
}
