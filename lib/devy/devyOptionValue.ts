/**
 * What a devy asset is worth, in the SAME units as an NFL player's price.
 *
 * ⚠ THIS IS THE FIRST DEVY NUMBER IN THIS REPO THAT CONVERTS. Everything before
 * it — `devyOutlook`'s 0-100 standing, `devyTradeValue`'s devy points — is
 * deliberately a denomination that compares devy assets to each other and to
 * nothing else, because the two inputs a price needs had never been measured.
 * Both now have been:
 *
 *   P(drafted | position, stars)   lib/devy/draftRates.generated.ts
 *                                  8 recruit classes, 10 draft years, 10,028 recruits
 *   E[board value | drafted]       lib/devy/arrivalValues.generated.ts
 *                                  3 draft classes against the FantasyCalc dynasty board
 *
 * value = P(drafted) x E[value | drafted] x horizon discount
 *
 * Both factors are measured on real outcomes and E is already denominated in
 * FantasyCalc dynasty board units, so the product is too. That is what makes
 * this comparable to an NFL player: no conversion happens anywhere here, which
 * is precisely why it is safe. A conversion is what previous attempts could not
 * justify.
 *
 * ── ⚠ WHAT THIS IS NOT COMPARABLE TO, AND THE MEASUREMENT THAT SAYS SO ──────
 *
 * `lib/pick-curve.ts` anchors a fantasy rookie first at 950 "market units".
 * THOSE ARE NOT THESE UNITS. Measured against the same board, the top twelve
 * skill players of a draft class are currently worth:
 *
 *     class 2023   top12 mean 5,663    5.96x the 950 anchor
 *     class 2024   top12 mean 5,037    5.30x
 *     class 2025   top12 mean 4,530    4.77x
 *
 * A rookie first buys one of those players, so on THIS board it is worth
 * thousands, not 950. The pick curve's scale was fitted on a different board
 * (its own note records 398 rows; this one is 475) and its author flagged the
 * curve as SHAPE-ONLY with each caller keeping its own scale — which is exactly
 * what that ⚠ was for.
 *
 * So: a devy value from this module may be added to an NFL player's FantasyCalc
 * value. It may NOT be compared against `FIRST_ROUND_IN_MARKET_UNITS` or any
 * `pickRoundValue()` output without first restating the pick curve on this
 * board. This module deliberately exports no conversion for that, because none
 * has been measured.
 *
 * ── THE BASE RATE PREFERS THE CONTINUOUS COMPOSITE OVER THE STAR BUCKET ─────
 *
 * `recruitingComposite` (0.70-1.00) is what a star rating is a ROUNDING of, and
 * it was only adopted here after being measured to carry signal the bucket had
 * already spent. Splitting each (position, stars) cell at its OWN median rating
 * — so the test cannot merely re-detect stars — the upper half is drafted more
 * often in 10 of 11 rateable tiers, mean lift 2.25x:
 *
 *     QB 4-star   5.9% -> 19.8%   (6 vs 20 drafted)
 *     RB 4-star  11.9% -> 36.4%   (13 vs 40)
 *     TE 4-star  10.9% -> 32.7%   (6 vs 18)
 *     WR 3-star   1.9% ->  4.6%   (19 vs 46)
 *
 * The one tier that does not separate (RB 2-star, 0.33x) rests on 6 drafted
 * against 2 — noise, and visible as such because the table ships counts.
 *
 * ⚠ IT ALSO PRICES PROSPECTS THE STAR TABLE REFUSES. The 5-star cells hold 18
 * QBs, 27 RBs and 31 WRs against a `minSample` of 50, so the BEST prospects were
 * exactly the ones that returned null. The 0.95+ composite band holds 65, 80 and
 * 123 — above the floor — because it also catches high 4-stars. TE stays null
 * there (22 recruits), which is the correct answer rather than a filled hole.
 *
 * ── COLLEGE PRODUCTION LEADS, AND IT IS WHAT MAKES THE VALUE MOVE ───────────
 *
 * Three tables, tried in order, each measured on the same cohort:
 *
 *   1. production  peak season-TOTAL PPA quintile, within position
 *   2. composite   recruiting composite band
 *   3. stars       the star bucket
 *
 * Production leads because it is far the strongest and the only one that
 * CHANGES. Recruiting rank is fixed before a player sets foot on campus;
 * production moves every week he plays. Splitting players who took meaningful
 * snaps at the median, the season total separates drafted from undrafted by
 * 22-176x, against 2.25x for the composite within stars.
 *
 * The hierarchy is also the right one on the merits: price a prospect on
 * recruiting rank until he plays, and on what he has actually done thereafter.
 *
 * ⚠ THE FALLBACK IS LEGITIMATE, THE ZERO IS NOT. A player with no production
 * falls back to the composite. He must NEVER be read as the historical cohort's
 * never-produced group: in that cohort a peak of zero means "never produced
 * across an entire career" and is drafted 0-3% of the time, whereas for a
 * current freshman it means "not yet" and is no information at all. Same number,
 * opposite facts. `draftRateForProduction` returns null on a non-positive input
 * for exactly this reason, and the generated table ships no zero band.
 *
 * ⚠ AND IT MUST BE FED `ppaSeasonTotal`, NOT `ppaTotal`. Those are different
 * quantities — the latter holds averagePPA.all despite its name, and separates
 * by 0.88-2.19x, INVERTED for WR and TE. A mix-up would place the whole pool in
 * the bottom quintile, uniformly enough that nothing would look broken.
 */

import {
  draftRateFor,
  draftRateForComposite,
  draftRateForProduction,
} from '@/lib/devy/draftRates.generated'
import { arrivalValueFor } from '@/lib/devy/arrivalValues.generated'

/**
 * The units this module speaks. Named so a consumer cannot forget which board a
 * number came from — the mistake that made the pick-curve comparison above look
 * reasonable for a whole session.
 */
export const DEVY_MARKET_SCALE = 'fantasycalc-dynasty-superflex-12' as const
export type DevyMarketScale = typeof DEVY_MARKET_SCALE

/**
 * Ratio between this board and `lib/pick-curve.ts`'s anchor, measured ex-post
 * across three classes (4.77x, 5.30x, 5.96x).
 *
 * ⚠ RECORDED, NOT APPLIED. It is an ex-post upper bound — it prices the top
 * twelve with hindsight, and nobody buying a rookie pick has that. The true
 * factor is lower by an amount nothing here measures, so multiplying by this
 * would trade one unjustified conversion for another. It exists so the next
 * person starts from a number instead of from scratch.
 */
export const OBSERVED_BOARD_TO_PICK_CURVE_RATIO = {
  measuredRatios: [4.77, 5.3, 5.96],
  basis: 'ex-post mean value of the top 12 skill players per draft class, 2023-2025',
  caveat: 'upper bound — hindsight-selected. Not a sanctioned conversion factor.',
} as const

/** Discount for the wait, mirroring `devyOutlook`'s table so the two agree. */
const HORIZON_DISCOUNT = [1, 0.75, 0.5, 0.3]
const BEYOND_HORIZON_DISCOUNT = 0.2

export type DevyOptionValue = {
  scale: DevyMarketScale
  /**
   * The option's worth in board units, or null when any factor is unmeasured.
   * ⚠ Null is never zero: an unpriced prospect is not a worthless one.
   */
  value: number | null
  /** P(drafted) for this cohort. Null when the cell is missing or under-sampled. */
  pDrafted: number | null
  /** Recruits behind pDrafted, so a consumer can see how thin the cell is. */
  pSampleSize: number | null
  /** Which table answered. Null when none could. */
  pSource: 'production' | 'composite' | 'stars' | null
  /** E[board value | drafted] for the position. Null when unmeasured. */
  arrivalValue: number | null
  horizonYears: number | null
  horizonDiscount: number | null
  /** Everything that stopped this being a number, named individually. */
  missing: string[]
  basis: string
}

export type DevyOptionValueArgs = {
  position: string | null
  /**
   * `DevyPlayer.ppaSeasonTotal` — peak season-TOTAL PPA. The strongest signal and
   * the only one that moves during a season.
   * ⚠ NOT `ppaTotal`, which holds the per-play average despite its name.
   */
  ppaSeasonTotal?: number | null
  /** Continuous recruiting composite (0.70-1.00). Preferred over stars. */
  recruitingComposite?: number | null
  recruitingStars: number | null
  draftEligibleYear: number | null
  currentSeason: number
  name?: string | null
}

/**
 * Price a devy asset as an option, or say honestly why it cannot be priced.
 *
 * ⚠ EVERY MISSING FACTOR RETURNS NULL RATHER THAN A DEFAULT. A 5-star recruit
 * has no measured draft rate — the cohorts are 18 to 31 players against a
 * `minSample` of 50 — so the BEST prospects are precisely the ones this cannot
 * price yet. Substituting the 4-star rate there would understate them
 * confidently, which is worse than declining.
 */
export function devyOptionValue(args: DevyOptionValueArgs): DevyOptionValue {
  const { position, recruitingStars, draftEligibleYear, currentSeason } = args
  const recruitingComposite = args.recruitingComposite ?? null
  const ppaSeasonTotal = args.ppaSeasonTotal ?? null
  const missing: string[] = []

  /*
   * ⚠ COMPOSITE FIRST, STARS SECOND, AND THE SOURCE IS REPORTED. The composite
   * band is the better-calibrated and better-sampled cell (see the header), but
   * a player can carry stars and no composite, so the bucket stays as a
   * fallback. Which one answered is part of the result: two prospects priced off
   * different tables are not equally well measured, and a consumer that cannot
   * tell them apart will average them as if they were.
   */
  const productionCell = position ? draftRateForProduction(position, ppaSeasonTotal) : null
  const compositeCell = position ? draftRateForComposite(position, recruitingComposite) : null
  const starCell = position ? draftRateFor(position, recruitingStars) : null

  const pSource: DevyOptionValue['pSource'] =
    productionCell != null
      ? 'production'
      : compositeCell != null
        ? 'composite'
        : starCell != null
          ? 'stars'
          : null

  const rate = productionCell?.rate ?? compositeCell?.rate ?? starCell?.rate ?? null
  const sampleSize =
    productionCell?.recruits ?? compositeCell?.recruits ?? starCell?.recruits ?? null

  if (rate == null) {
    missing.push(
      ppaSeasonTotal == null && recruitingComposite == null && recruitingStars == null
        ? 'ppaSeasonTotal, recruitingComposite and recruitingStars'
        : `draftRate(${position ?? 'unknown position'}, composite ${recruitingComposite ?? 'none'} / ${recruitingStars ?? 'no'}-star)`,
    )
  }

  const arrival = position ? arrivalValueFor(position) : null
  if (!arrival) missing.push(`arrivalValue(${position ?? 'unknown position'})`)

  const horizonYears =
    draftEligibleYear == null || !Number.isFinite(draftEligibleYear)
      ? null
      : Math.max(0, draftEligibleYear - currentSeason)
  if (horizonYears == null) missing.push('draftEligibleYear')

  const horizonDiscount =
    horizonYears == null ? null : (HORIZON_DISCOUNT[horizonYears] ?? BEYOND_HORIZON_DISCOUNT)

  const who = args.name ?? 'this prospect'

  if (rate == null || !arrival || horizonDiscount == null || horizonYears == null) {
    return {
      scale: DEVY_MARKET_SCALE,
      value: null,
      pDrafted: rate,
      pSampleSize: sampleSize,
      pSource,
      arrivalValue: arrival?.expectedLow ?? null,
      horizonYears,
      horizonDiscount,
      missing,
      basis: `${who} cannot be priced: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} unmeasured. This is not a low value.`,
    }
  }

  /*
   * ⚠ expectedLow, NOT meanOnBoard. The mean conditions on the player having
   * made the board at all — a number about the ones it worked out for. Using it
   * would price every prospect as though the bust case does not exist, which is
   * the exact failure the arrival-value backfill was written to avoid.
   */
  const value = Math.round(rate * arrival.expectedLow * horizonDiscount)

  const wait =
    horizonYears === 0
      ? 'eligible for the next NFL draft'
      : horizonYears === 1
        ? 'a year from draft eligibility'
        : `${horizonYears} years from draft eligibility`

  return {
    scale: DEVY_MARKET_SCALE,
    value,
    pDrafted: rate,
    pSampleSize: sampleSize,
    pSource,
    arrivalValue: arrival.expectedLow,
    horizonYears,
    horizonDiscount,
    missing,
    basis:
      `${(rate * 100).toFixed(1)}% of ${position}s in this ` +
      `${
        pSource === 'production'
          ? `production quintile (peak PPA ${ppaSeasonTotal})`
          : pSource === 'composite'
            ? `composite band (${recruitingComposite})`
            : `${recruitingStars}-star bucket`
      } ` +
      `have been drafted (${sampleSize} measured), and a drafted ${position} is worth ` +
      `${arrival.expectedLow} on the dynasty board once busts are counted. ${who} is ${wait}, ` +
      `so the option prices at ${value}. This is a cohort base rate, not a read on him specifically.`,
  }
}
