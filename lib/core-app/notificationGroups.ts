import type { NotificationRow } from './notificationsCenter'

const CHAT_TYPES = new Set(['direct_message', 'huddle_message', 'mention', 'league_chat_message', 'at_all'])

function eventGroup(row: NotificationRow): string[] | null {
  if (!row.meta || typeof row.meta !== 'object') return null
  const meta = row.meta as Record<string, unknown>
  if (CHAT_TYPES.has(row.type ?? '')) {
    if (row.leagueId) return ['league-chat', row.leagueId]
    const threadId = meta.chatThreadId ?? meta.threadId
    if (typeof threadId === 'string') return ['conversation', threadId]
  }
  if (row.type?.startsWith('game_') && typeof meta.gameId === 'string') return ['game', meta.gameId]
  return null
}

/** Group related notices from the same day while preserving the individual IDs. */
export function groupNotificationRows(rows: NotificationRow[]): NotificationRow[] {
  const groups = new Map<string, NotificationRow>()
  const out: NotificationRow[] = []
  for (const row of rows) {
    const related = eventGroup(row)
    const key = JSON.stringify(related ? [row.createdAt.slice(0, 10), row.kind, ...related] : [
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
