/**
 * "Leagues that have actually been played" — the one definition, shared.
 *
 * 🛑 EXTRACTED RATHER THAN COPIED, AND THAT IS THE POINT. This filter and sort lived inline in
 * `app/core/(shell)/[[...screen]]/page.tsx`, which was fine while the page was its only caller. The moment a
 * second caller needed it (`lib/core-app/weekAllSummary.ts`, which rebuilds the week board without a
 * request in scope) copying two lines would have created two implementations of one rule — the exact
 * failure CLAUDE.md records for the SQL copy of `normalizePlayerName`, where the copy disagreed with
 * the original on 7.2% of rows and would have written tens of thousands of unreachable rows.
 *
 * ⚠ THE FILTER IS NOT COSMETIC. `hasUnifiedRecord: false` marks AF Legacy board rows — 543 of them
 * on one production account against 60 real teams — and none has a schedule to read. Every loader
 * that walks weekly results takes THIS list, never the raw one.
 */

/**
 * The fields this rule reads. Documentation, not a constraint — see the note on `toPlayedLeagues`.
 */
export type PlayableLeague = {
  name?: unknown
  hasUnifiedRecord?: boolean
}

/**
 * Played leagues, name-sorted.
 *
 * ⚠ `!== false`, NOT `=== true`. The flag is optional: a row that simply does not carry it is a
 * real league, and `=== true` would silently drop every league from a source that has not adopted
 * the field.
 *
 * ⚠ The sort is `localeCompare` with `sensitivity: 'base'` and `numeric: true`, so "Week 10" sorts
 * after "Week 9" rather than before it. Keep it — a rail that reorders between two renders of the
 * same page reads as data loss.
 */
/**
 * ⚠ UNCONSTRAINED `<T>` WITH INTERNAL CASTS, AND THAT IS DELIBERATE RATHER THAN LAZY. The first
 * version constrained `T extends PlayableLeague`, which looked stricter and was strictly worse: the
 * page's league rows and `DashboardLeagueListPayload.leagues` (typed `unknown[]`) do not both
 * satisfy it, so inference collapsed `T` and the return type lost every field the callers actually
 * use. The ratchet caught it — **40 new errors in the page and 2 here**. The casts below are the
 * same ones the inline version used; keeping `T` free is what lets each caller keep its own type.
 */
export function toPlayedLeagues<T>(leagues: readonly T[]): T[] {
  const name = (league: T): string => String((league as { name?: unknown }).name ?? '')
  return leagues
    .filter((league) => (league as { hasUnifiedRecord?: boolean }).hasUnifiedRecord !== false)
    .sort((a, b) => name(a).localeCompare(name(b), undefined, { sensitivity: 'base', numeric: true }))
}
