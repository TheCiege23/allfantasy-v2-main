/**
 * The trade deadline a new redraft or keeper league starts with, for every sport. Pure.
 *
 * THE RULE: three weeks before the playoffs open — the week before the playoffs, minus two. That
 * leaves two full regular-season weeks after the deadline for the rosters it froze to settle the
 * playoff race, which is what the platforms' own defaults do:
 *
 *   NFL   playoffs week 15 → deadline week 12   (Sleeper defaults to 11, ESPN to about 12-13)
 *   NBA   playoffs week 23 → deadline week 20   (about the first week of March)
 *   NHL   playoffs week 25 → deadline week 22   (about the first week of March)
 *   MLB   playoffs week 24 → deadline week 21   (about mid-August)
 *
 * The playoff start comes from the league's own bracket (`redraftPlayoffShapeFor`), so a 4-team NFL
 * bracket that opens in week 16 gets a week-13 deadline — the gap is what is fixed, not the week.
 *
 * ⚠ THE DEADLINE WEEK ITSELF IS STILL OPEN. "Deadline week 12" refuses from week 13
 * (`deadlinePassed`), so the last two regular-season weeks are the ones that close.
 *
 * Null when there is no regular season long enough to hold one (no playoffs, or a playoff start in
 * the first three weeks) — a league that says nothing about a deadline keeps trades open, which is
 * what it did before this default existed.
 */

/** Weeks between the deadline week and the first playoff week. */
export const TRADE_DEADLINE_WEEKS_BEFORE_PLAYOFFS = 3

export function defaultTradeDeadlineWeek(playoffStartWeek: number | null | undefined): number | null {
  if (typeof playoffStartWeek !== 'number' || !Number.isFinite(playoffStartWeek)) return null
  const week = Math.floor(playoffStartWeek) - TRADE_DEADLINE_WEEKS_BEFORE_PLAYOFFS
  return week >= 1 ? week : null
}
