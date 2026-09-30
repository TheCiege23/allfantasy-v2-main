/**
 * A devy prospect's trend — the ONE answer both devy screens give.
 *
 * The cross-league Devy hub (`lib/core-app/devy.ts`) and the per-league Devy tab
 * (`lib/core-app/devyLeagueTab.ts`) both draw a trend beside a prospect. They used to decide it
 * separately, and they disagreed: the tab said "no trend measured" while the hub drew a green
 * arrow beside every prospect in the pool. Both now ask this module, and both render through
 * `components/core-app/screens/DevyTrendMark.tsx`, so they cannot drift apart again.
 *
 * 🛑 THERE IS NO MEASURED TREND TODAY, AND `stockTrendDelta` IS NOT ONE.
 * `DevyPlayer.stockTrendDelta` is named like a change over time, but its only writer
 * (`lib/workers/devy-data-worker.ts`) stores `draftProjectionScore/100*10 + c2cPointsSeason/10` —
 * a LEVEL, recomputed from the current row, never compared with a previous one. It is
 * non-negative for every scored prospect, so reading its sign as a direction paints the whole
 * pool as rising. `DevyPlayer.trend` has no writer at all.
 *
 * So the answer is null ("no trend measured"), never 'flat': "flat" is a claim that a value held
 * still, and nothing here has measured that either.
 *
 * To make this real, a writer has to persist two readings of the same measure at two times and
 * store their difference. When that exists, change THIS function — both screens follow.
 */

export type DevyTrend = 'up' | 'down' | 'flat'

/** The copy for an unmeasured trend. Shared so the two screens say the same words. */
export const DEVY_NO_TREND_LABEL = 'No trend measured'

/**
 * A prospect's trend, or null when none is measured — which, today, is always.
 *
 * Takes the row so call sites do not change when a real delta arrives; deliberately does NOT
 * read `stockTrendDelta` (see the header).
 */
export function devyTrendOf(_prospect: { id: string }): DevyTrend | null {
  return null
}

/** Glyph and accessible label for a trend, including the unmeasured one. */
export function devyTrendPresentation(trend: DevyTrend | null): { glyph: string; label: string } {
  if (trend == null) return { glyph: '·', label: DEVY_NO_TREND_LABEL }
  if (trend === 'up') return { glyph: '↑', label: 'Trending up' }
  if (trend === 'down') return { glyph: '↓', label: 'Trending down' }
  return { glyph: '—', label: 'Flat' }
}
