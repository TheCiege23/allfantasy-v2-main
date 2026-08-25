/**
 * WHEN A MESSAGE WAS SENT, IN THE SHORTEST FORM THAT IS STILL UNAMBIGUOUS.
 *
 * ⚠ NOTHING RENDERED A TIMESTAMP IN THE COMMS DRAWER. `createdAt` was fetched,
 * typed, and carried all the way to the row, then dropped — so a league chat,
 * a DM and a huddle all read as one undated wall of text and there was no way
 * to tell this morning's trade talk from last month's.
 *
 * ⚠ "Mon 9:41 PM" NAMES NO PARTICULAR MONDAY. The previous version used a bare
 * weekday for everything older than today, which is fine inside a week and
 * actively misleading outside one — a message from three weeks ago read as
 * though it were from this week. Past six days it falls back to a real date.
 */

/** Beyond this, a weekday name stops identifying a unique day. */
const WEEKDAY_WINDOW_MS = 6 * 24 * 60 * 60 * 1000

function toDate(value: number | string | Date): Date | null {
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function timeOf(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })
}

/**
 * Today → "9:41 PM"; this week → "Mon 9:41 PM"; older → "Mar 4, 9:41 PM";
 * another year → "Mar 4, 2025".
 *
 * Returns '' for a missing or unparseable value, because a row reading
 * "Invalid Date" is worse than a row with no time on it.
 */
export function formatChatMessageTimestamp(value: number | string | Date): string {
  const d = toDate(value)
  if (!d) return ''

  const now = new Date()
  const sameDay =
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  if (sameDay) return timeOf(d)

  if (d.getFullYear() !== now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  if (Math.abs(now.getTime() - d.getTime()) <= WEEKDAY_WINDOW_MS) {
    return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${timeOf(d)}`
  }

  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${timeOf(d)}`
}

/** The unabbreviated form, for the `title` tooltip on a shortened stamp. */
export function formatChatMessageTimestampFull(value: number | string | Date): string {
  const d = toDate(value)
  return d ? d.toLocaleString() : ''
}

/** A `<time datetime>` value, or '' when there is nothing valid to encode. */
export function toDateTimeAttr(value: number | string | Date): string {
  const d = toDate(value)
  return d ? d.toISOString() : ''
}

/** Consecutive same-sender styling within this window (ms). */
export const CHAT_THREAD_GROUP_MS = 5 * 60 * 1000

export function isLeagueMessageThreaded(
  prev: { authorId: string; created: number } | undefined,
  curr: { authorId: string; created: number }
): boolean {
  if (!prev) return false
  if (prev.authorId !== curr.authorId) return false
  return curr.created - prev.created <= CHAT_THREAD_GROUP_MS && curr.created >= prev.created
}

export function isChimmyMessageThreaded(
  prev: { role: 'user' | 'assistant'; createdAt: number } | undefined,
  curr: { role: 'user' | 'assistant'; createdAt: number }
): boolean {
  if (!prev) return false
  if (prev.role !== curr.role) return false
  return curr.createdAt - prev.createdAt <= CHAT_THREAD_GROUP_MS && curr.createdAt >= prev.createdAt
}
