import { describe, expect, it } from 'vitest'

import { kickerShareAtRank } from '@/lib/kicker-values/leagueKickerValue'
import {
  DEVY_BLEND_THRESHOLD,
  DEVY_OVERALL_AGREEMENT,
  DEVY_SIGNAL_AGREEMENT,
  KICKER_FLATNESS,
  KICKER_WITHIN_MEAN_RHO,
  KICKER_WITHIN_SEASON,
  KICKER_YEAR_OVER_YEAR,
  KICKER_YOY_MEAN_RHO,
} from '@/lib/values/publishedValueEvidence'

/**
 * 🛑 THE ANTI-DRIFT MECHANISM FOR A PUBLIC PAGE.
 *
 * `/player-values` states measurements to anyone on the internet. The failure this file exists
 * to prevent is the page continuing to claim a correlation after the model stopped acting on
 * it — a confident public statement backed by nothing, which is exactly the failure the whole
 * valuation stack was built to avoid making about players.
 *
 * So the published shares are asserted against `kickerShareAtRank`, the function the pricing
 * actually calls. Change one without the other and this fails.
 */
describe('published evidence matches the pricing model', () => {
  it('publishes the same kicker flatness curve the pricing reads', () => {
    for (const { rank, share } of KICKER_FLATNESS) {
      expect(kickerShareAtRank(rank)).toBeCloseTo(share, 3)
    }
  })

  /**
   * The page's headline claim. If the curve is ever flattened or steepened, this catches the
   * page still advertising the old spread.
   */
  it('keeps the published K1-to-K24 spread inside what the curve actually says', () => {
    const k24 = KICKER_FLATNESS.find((f) => f.rank === 24)!
    const measuredSpread = 1 / kickerShareAtRank(24)
    expect(k24.share).toBeCloseTo(kickerShareAtRank(24), 3)
    // The page says "1.55x"; the curve must stay in that neighbourhood.
    expect(measuredSpread).toBeGreaterThan(1.4)
    expect(measuredSpread).toBeLessThan(1.7)
  })
})

describe('published evidence is internally consistent', () => {
  /**
   * 🛑 THE CLAIM IS "NEGATIVE IN ALL SIX PAIRS". If a figure is ever edited to a positive
   * value, the sentence on the page becomes false while still rendering perfectly.
   */
  it('year-over-year kicker rank is negative in every measured pair', () => {
    expect(KICKER_YEAR_OVER_YEAR).toHaveLength(6)
    for (const p of KICKER_YEAR_OVER_YEAR) expect(p.rho).toBeLessThan(0)
  })

  it('reports the mean of the per-season figures, not a pooled correlation', () => {
    const mean =
      KICKER_YEAR_OVER_YEAR.reduce((s, p) => s + p.rho, 0) / KICKER_YEAR_OVER_YEAR.length
    expect(mean).toBeCloseTo(KICKER_YOY_MEAN_RHO, 2)

    const withinMean =
      KICKER_WITHIN_SEASON.reduce((s, p) => s + p.rho, 0) / KICKER_WITHIN_SEASON.length
    expect(withinMean).toBeCloseTo(KICKER_WITHIN_MEAN_RHO, 2)
  })

  /**
   * ⚠ A POOLED CORRELATION OVER CONCATENATED SEASON PAIRS REPORTS ~+0.97 AND IS AN ARTEFACT.
   * If someone ever "fixes" the mean to that, this catches it: the published mean must stay
   * far from the pooled figure and on the correct side of zero.
   */
  it('does not publish the pooled-rank artefact', () => {
    expect(KICKER_YOY_MEAN_RHO).toBeLessThan(0)
    expect(KICKER_YOY_MEAN_RHO).toBeGreaterThan(-1)
  })

  /**
   * The devy section's argument is that these signals agree too weakly to blend, measured
   * against the threshold set by the two sources that ARE blended. If devy agreement ever rose
   * above that, the page's reasoning would be stale and the blend should be revisited.
   */
  it('keeps devy agreement below the threshold that justifies a blend', () => {
    expect(DEVY_OVERALL_AGREEMENT.spearman).toBeLessThan(DEVY_BLEND_THRESHOLD.spearman)
    for (const d of DEVY_SIGNAL_AGREEMENT) {
      expect(d.spearman).toBeLessThan(DEVY_BLEND_THRESHOLD.spearman)
    }
  })

  it('carries a sample size with every correlation it publishes', () => {
    for (const d of DEVY_SIGNAL_AGREEMENT) expect(d.n).toBeGreaterThan(0)
    expect(DEVY_OVERALL_AGREEMENT.n).toBeGreaterThan(0)
  })
})
