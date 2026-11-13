/**
 * NotificationCenterService — grouping and display logic for the notification center.
 */

import type { PlatformNotification } from "@/types/platform-shared"

export type NotificationGroupKey = "today" | "yesterday" | "earlier"
export const NOTIFICATION_GROUP_ORDER: NotificationGroupKey[] = [
  "today",
  "yesterday",
  "earlier",
]

function getGroupKey(dateStr: string, now?: Date): NotificationGroupKey {
  const d = new Date(dateStr)
  const ref = now ?? new Date()
  const startOfToday = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate())
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  if (d >= startOfToday) return "today"
  if (d >= startOfYesterday) return "yesterday"
  return "earlier"
}

export function groupNotifications(
  notifications: PlatformNotification[],
  now?: Date
): Record<NotificationGroupKey, PlatformNotification[]> {
  const groups: Record<NotificationGroupKey, PlatformNotification[]> = {
    today: [],
    yesterday: [],
    earlier: [],
  }
  const sorted = [...notifications].sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime()
    const bTime = new Date(b.createdAt).getTime()
    return bTime - aTime
  })
  for (const n of sorted) {
    const key = getGroupKey(n.createdAt, now)
    groups[key].push(n)
  }
  return groups
}

export const NOTIFICATION_GROUP_LABELS: Record<NotificationGroupKey, string> = {
  today: "Today",
  yesterday: "Yesterday",
  earlier: "Earlier",
}
