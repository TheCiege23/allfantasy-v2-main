/**
 * Pure half of lib/player-age.ts (which imports it): when several stored rows for ONE player agree on
 * an age. Split out so a client component can apply the same rule without importing prisma.
 */

/*
 * ⚠ WHY A ONE-YEAR SPREAD IS TOLERATED AND TWO IS NOT. The SAME athlete routinely carries ages one
 * apart across sources — a stored age goes stale on his birthday until that source re-syncs
 * (Lamar Jackson CB: 28 in Rolling Insights, 27 in Sleeper, one DOB). Refusing that would blank
 * most of the league. Two years apart is not staleness, it is two people (or a broken row), and
 * that is refused. Inside one year the HIGHER value wins, because a stale age only ever lags.
 */
const MAX_AGREEING_SPREAD = 1

export function agreedAge(rows: ReadonlyArray<{ age: number | null | undefined }>): number | null {
  const ages = rows.map((r) => r.age).filter((a): a is number => typeof a === 'number' && a > 0)
  if (ages.length === 0) return null
  const lo = Math.min(...ages)
  const hi = Math.max(...ages)
  return hi - lo > MAX_AGREEING_SPREAD ? null : hi
}
