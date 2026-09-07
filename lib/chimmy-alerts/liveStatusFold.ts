/**
 * When a live designation was FIRST seen.
 *
 * The game-window fold in app/api/cron/alert-sweep re-writes every urgent
 * Sleeper status every five minutes. `fetchedAt` therefore always says "just
 * now", and until 2026-09-06 the row carried no `date` at all — so nothing
 * downstream could tell an Out ruled on Friday from a scratch announced ninety
 * minutes before kickoff, which is the one fact a game-day manager needs
 * (lib/core-app/pregameInactive.ts). The fold now keeps the instant it first
 * saw the current word and resets it only when the word changes: Doubtful on
 * Saturday, Out at 11:32a on Sunday is two claims, and the second one's time
 * is the inactive announcement. Pure.
 */
export function liveFirstSeen(
  existing: { status: string | null; date: Date | null } | null | undefined,
  status: string,
  now: Date,
): Date {
  if (!existing?.date) return now
  const same = (existing.status ?? '').trim().toLowerCase() === status.trim().toLowerCase()
  return same ? existing.date : now
}
