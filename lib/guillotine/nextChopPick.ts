/**
 * "Who's next?" (2026-10-29): a chopped manager's weekly pick of the team the next chop takes, and the
 * leaderboard of who calls it best. A chopped manager keeps their league but had nothing left to do in
 * it; this gives them a reason to come back every week and something to say in league chat.
 *
 * The rules, and why:
 *  - Only a manager whose team has been chopped picks. It is their game, not a side bet for survivors.
 *  - A pick is for NEXT week's chop and locks when that week starts, so nobody picks with the week's
 *    scores in front of them (the live chop line shows them all week).
 *  - One pick a week, changeable until it locks; only a team still alive can be picked.
 *  - One point when the pick is chopped; on a double chop, either team counts.
 *
 * Picks are league events (`GuillotineEventLog`, `next_chop_pick`), so there is no new table; the
 * leaderboard is worked out at read time from the picks and the week each team was chopped. Pure here;
 * the reads and writes are in ./nextChopPickStore.ts.
 */

export type NextChopPick = { pickerRosterId: string; week: number; pickedRosterId: string; at: string }

export type NextChopLeaderRow = {
  rosterId: string
  /** Picks that were right. */
  correct: number
  /** Picks whose week has been chopped (right or wrong). */
  settled: number
}

/** The pick that counts for each picker and week: the latest one made. */
export function latestPicks(picks: readonly NextChopPick[]): NextChopPick[] {
  const byKey = new Map<string, NextChopPick>()
  for (const p of picks) {
    const key = `${p.pickerRosterId}:${p.week}`
    const prior = byKey.get(key)
    if (!prior || p.at > prior.at) byKey.set(key, p)
  }
  return [...byKey.values()]
}

/**
 * Most right first; then the fewer picks needed to get there; then roster id, so ties do not reshuffle
 * between loads. A week counts once a team has been chopped in it.
 */
export function nextChopLeaderboard(
  picks: readonly NextChopPick[],
  choppedWeekByRoster: ReadonlyMap<string, number>,
): NextChopLeaderRow[] {
  const choppedInWeek = new Map<number, Set<string>>()
  for (const [rosterId, week] of choppedWeekByRoster) {
    choppedInWeek.set(week, (choppedInWeek.get(week) ?? new Set()).add(rosterId))
  }
  const rows = new Map<string, NextChopLeaderRow>()
  for (const p of latestPicks(picks)) {
    const row = rows.get(p.pickerRosterId) ?? { rosterId: p.pickerRosterId, correct: 0, settled: 0 }
    const fell = choppedInWeek.get(p.week)
    if (fell) {
      row.settled += 1
      if (fell.has(p.pickedRosterId)) row.correct += 1
    }
    rows.set(p.pickerRosterId, row)
  }
  return [...rows.values()].sort((a, b) => b.correct - a.correct || a.settled - b.settled || a.rosterId.localeCompare(b.rosterId))
}

/**
 * The week a pick can be made for: the one after the week being played, from the first chop week to
 * the last. Null when the chops are over.
 */
export function openPickWeek(args: { calendarWeek: number; eliminationStartWeek: number; eliminationEndWeek: number | null }): number | null {
  const week = Math.max(args.calendarWeek + 1, args.eliminationStartWeek)
  return args.eliminationEndWeek != null && week > args.eliminationEndWeek ? null : week
}
