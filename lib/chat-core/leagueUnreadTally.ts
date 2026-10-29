/**
 * The league half of the chat bubble's count, as a pure tally so it can be tested without a
 * database. `chatBadge.ts` reads the rows and the read marks; this decides what counts.
 *
 * `byLeague` (2026-10-18, native league handoff §2): the league rail and the phone switcher draw an
 * unread badge on each league's crest. It is the SAME number the bubble already sums — split per
 * league instead of being thrown away — so the rail and the bubble can never disagree.
 */

export type LeagueUnreadRow = { leagueId: string; createdAt: Date; mentionedUserIds: string[] }

export type LeagueUnreadTally = { count: number; mentions: number; byLeague: Record<string, number> }

export function tallyLeagueUnread(
  rows: readonly LeagueUnreadRow[],
  marks: ReadonlyMap<string, Date>,
  userId: string,
): LeagueUnreadTally {
  let count = 0
  let mentions = 0
  const byLeague: Record<string, number> = {}
  for (const r of rows) {
    const readAt = marks.get(r.leagueId)
    if (readAt && r.createdAt.getTime() <= readAt.getTime()) continue
    count += 1
    byLeague[r.leagueId] = (byLeague[r.leagueId] ?? 0) + 1
    if (r.mentionedUserIds.includes(userId)) mentions += 1
  }
  return { count, mentions, byLeague }
}
