import type { NotificationRow } from './notificationsCenter'

/** Collapse identical notices from the same day without deleting their read receipts. */
export function groupNotificationRows(rows: NotificationRow[]): NotificationRow[] {
  const groups = new Map<string, NotificationRow>()
  const out: NotificationRow[] = []
  for (const row of rows) {
    const key = JSON.stringify([
      row.createdAt.slice(0, 10), row.leagueId, row.kind, row.category,
      row.title.trim(), row.detail.trim(), row.severity, row.action?.href,
    ])
    const prior = groups.get(key)
    if (prior) {
      prior.relatedIds!.push(row.id)
      prior.read = prior.read && row.read
    } else {
      const grouped = { ...row, relatedIds: [row.id] }
      groups.set(key, grouped)
      out.push(grouped)
    }
  }
  return out
}
