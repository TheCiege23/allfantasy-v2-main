/**
 * Huddles split into "This week" and "Earlier" (2026-11-05, chat redesign). Every week adds a matchup
 * huddle (lib/chat-core/matchupThreads.ts), so a season of finished "Week 3 · …" rooms otherwise sits
 * in one flat list burying the one that matters now.
 *
 * Recent = any activity in the last 7 days, OR anything unread — an unread huddle is never "earlier",
 * however old its last message. Order inside each section is the server's (most recent first).
 */

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

type Sectionable = {
  lastMessageAt: string
  unreadCount: number
  context?: { lastMessageCreatedAt?: string | null } | null
}

export function splitThreadsByRecency<T extends Sectionable>(threads: T[], now: Date): { recent: T[]; earlier: T[] } {
  const recent: T[] = []
  const earlier: T[] = []
  for (const t of threads) {
    const at = Date.parse(t.context?.lastMessageCreatedAt || t.lastMessageAt)
    const fresh = Number.isFinite(at) && now.getTime() - at < WEEK_MS
    ;(fresh || t.unreadCount > 0 ? recent : earlier).push(t)
  }
  return { recent, earlier }
}
