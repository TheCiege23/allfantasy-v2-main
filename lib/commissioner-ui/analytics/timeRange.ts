import type { LeagueAnalyticsSnapshot } from './decision-os-client/types'

/**
 * 30a — the time-range filter, applied ONCE to the whole snapshot.
 *
 * ⚠ THE EXPORT MIRRORS THE SCREEN BECAUSE THERE IS ONLY ONE FILTERED OBJECT.
 * The handoff requires the CSV to match what is on screen with the same range
 * applied. Rather than trusting two code paths to stay in step, the view
 * filters the snapshot and then renders *and* exports that same filtered value.
 * A range that changes the charts cannot fail to change the export, because the
 * export never sees the unfiltered snapshot at all.
 *
 * Anything not indexed by week is returned untouched — a four-season comparison
 * does not have a "last 4 weeks" reading, and silently emptying it would look
 * like a league with no history rather than a filter that does not apply.
 */

export type AnalyticsTimeRange = 'season' | 'last4' | 'all'

export const TIME_RANGES: Array<{ id: AnalyticsTimeRange; label: string; hint: string }> = [
  { id: 'season', label: 'This season', hint: 'Every week played so far' },
  { id: 'last4', label: 'Last 4 weeks', hint: 'The four most recent weeks' },
  { id: 'all', label: 'All-time', hint: 'Every season on record' },
]

const LAST_N = 4

function tail<T>(rows: T[], n: number): T[] {
  return rows.length <= n ? rows : rows.slice(rows.length - n)
}

export function applyTimeRange(
  snapshot: LeagueAnalyticsSnapshot,
  range: AnalyticsTimeRange,
): LeagueAnalyticsSnapshot {
  if (range === 'all' || range === 'season') {
    /*
     * 'season' and 'all' differ only in the season-comparison panel, which is
     * already every season on record. Neither truncates the weekly series: a
     * league's season IS its weeks so far, and "all-time" weekly data is the
     * same rows plus history we do not hold per-week.
     */
    return snapshot
  }

  return {
    ...snapshot,
    healthByWeek: tail(snapshot.healthByWeek, LAST_N),
    transactionsByWeek: tail(snapshot.transactionsByWeek, LAST_N),
    trends: snapshot.trends.map((series) => ({ ...series, points: tail(series.points, LAST_N) })),
    /*
     * Season comparison is deliberately left whole. It is indexed by season,
     * not by week, so "last 4 weeks" has no meaning for it — emptying it would
     * read as "this league has no history".
     */
  }
}

/** Rendered next to the switcher so the reader knows what the numbers cover. */
/**
 * Rendered next to the switcher so the reader knows what the numbers cover.
 *
 * ⚠ "Weeks 1–N, this season" WAS WRONG THE MOMENT REAL DATA ARRIVED. The week count falls back to
 * `transactionsByWeek`, and those are CALENDAR weeks — a dynasty league's imported activity runs
 * January to August, so a real league rendered "Weeks 1–13, this season" over thirteen weeks that
 * span two thirds of a calendar year and no NFL week 13. The label was accurate only against a
 * fixture whose weeks happened to be season weeks.
 *
 * `healthByWeek` genuinely is season weeks, so it keeps the season wording; the transaction
 * fallback says what it actually counts.
 */
export function describeRange(range: AnalyticsTimeRange, snapshot: LeagueAnalyticsSnapshot): string {
  const seasonWeeks = snapshot.healthByWeek.length
  const weeks = seasonWeeks || snapshot.transactionsByWeek.length
  if (range === 'last4') return `Last ${Math.min(LAST_N, weeks) || LAST_N} weeks`
  if (range === 'all') return `All ${snapshot.seasonComparison.length || 1} seasons on record`
  if (seasonWeeks) return `Weeks 1–${seasonWeeks}, this season`
  return weeks ? `${weeks} weeks with activity` : 'This season'
}
