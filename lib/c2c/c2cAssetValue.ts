/**
 * What a Campus-to-Canton asset is worth in a trade.
 *
 * ⚠ C2C IS NOT DEVY, AND THE DIFFERENCE IS THE WHOLE MODULE. In a devy league a
 * college player scores nothing — he is an option and only an option, which is
 * what lib/trade-intel/devyOutlook.ts prices. In C2C he DOES score, into the
 * campus half of a weighted lineup, so he is a producing asset AND an option on
 * his pro future. Valuing him with the devy model alone drops the half of him
 * that shows up on the scoreboard every week.
 *
 * ⚠ AND HIS POINTS ARE WORTH LESS THAN A PRO'S — THIS IS THE TRAP. `C2CLeague`
 * defaults to `campusScoreWeight 0.4` against `cantonScoreWeight 0.6`, and
 * `computeOfficialScore` in scoringEngine.ts multiplies each side by its weight.
 * So 15 campus points contribute 6 to the official score while 15 canton points
 * contribute 9. A valuation that compares raw points across the two sides
 * overvalues every college player by half again, and the error is invisible
 * because both numbers are "points".
 *
 * ⚠ THE TWO HALVES DO NOT ADD. Weighted points and devy points are different
 * scales — one is a real unit measured off a scoreboard, the other is an ordinal
 * standing on a borrowed curve. This returns both and refuses to sum them, for
 * the same reason devyOutlook refuses to quote a devy asset in market units.
 *
 * ── Dormant today, and honestly so ─────────────────────────────────────────
 *
 * ⚠ Verified against production 2026-08-25: `c2c_leagues` holds ZERO rows, and
 * `player_weekly_scores` holds 80 rows, ALL NFL, with `max(season) = 2098` —
 * fixture data. There is not one NCAAF weekly score in the database. So
 * `fantasyPtsForPlayer` returns its `?? 0` fallback for every college player,
 * and a C2C campus score computed today would be zero for everyone, silently.
 *
 * This module therefore takes points as an INPUT rather than reading that table,
 * so it is exercised by tests now and correct the moment college scoring lands.
 * It returns null — never 0 — when points are absent.
 */

import { devyAssetValue, type DevyAssetValue } from '@/lib/trade-intel/devyTradeValue'
import type { DevyOutlook } from '@/lib/trade-intel/devyOutlook'

/** Weighted points are a real unit, but a C2C-league-specific one. */
export const C2C_WEIGHTED_POINTS = 'c2c-weighted-points' as const
export type C2CWeightedPointsScale = typeof C2C_WEIGHTED_POINTS

export type C2CSide = 'campus' | 'canton'

export type C2CAssetValue = {
  scale: C2CWeightedPointsScale
  side: C2CSide
  /** The league's weight for this side. */
  sideWeight: number
  /** Points he actually puts up, unweighted. Null when we hold no scoring. */
  rawPointsPerWeek: number | null
  /**
   * What those points contribute to the official score. Null when raw is null —
   * NOT 0, which would say he plays and scores nothing.
   */
  weightedPointsPerWeek: number | null
  /**
   * His option on a pro future, in DEVY POINTS.
   *
   * ⚠ A DIFFERENT SCALE FROM THE FIELDS ABOVE. Never added to them. Null for a
   * canton (pro) player, who has no college future to option.
   */
  devyOption: DevyAssetValue | null
  gaps: string[]
  basis: string
}

export const C2C_GAPS = {
  noScoring:
    'we hold no weekly scoring for this player, so his campus contribution is not estimated — that is an absence, not a zero',
  noCollegeScores:
    'there is no NCAAF weekly scoring in the database at all, so no college player can be priced on production yet',
  scalesDoNotAdd:
    'weighted points and devy points are different scales and are reported separately — the option cannot be added to the production',
} as const

/**
 * Read a side's weight off the league.
 *
 * ⚠ DEFAULTS MATCH THE SCHEMA (campus 0.4 / canton 0.6) rather than 0.5/0.5.
 * Splitting them evenly would silently reprice every college player in every
 * league whose config we failed to load.
 */
export function c2cSideWeight(
  side: C2CSide,
  league?: { campusScoreWeight?: number | null; cantonScoreWeight?: number | null } | null,
): number {
  if (side === 'campus') return league?.campusScoreWeight ?? 0.4
  return league?.cantonScoreWeight ?? 0.6
}

/**
 * Price one C2C asset.
 *
 * `pointsPerWeek` is the caller's own expectation for him — a season average, a
 * projection, whatever it holds. Null when it holds nothing, which is every
 * college player today.
 */
export function c2cAssetValue(args: {
  side: C2CSide
  pointsPerWeek: number | null
  league?: { campusScoreWeight?: number | null; cantonScoreWeight?: number | null } | null
  /** Devy inputs, for the campus side only. */
  devyRank?: number | null
  outlook?: Pick<DevyOutlook, 'timeDiscount' | 'gaps' | 'score'> | null
  name?: string | null
}): C2CAssetValue {
  const { side, pointsPerWeek } = args
  const sideWeight = c2cSideWeight(side, args.league)
  const who = args.name ?? 'this player'

  const raw = pointsPerWeek != null && Number.isFinite(pointsPerWeek) ? pointsPerWeek : null
  const weighted = raw == null ? null : Math.round(raw * sideWeight * 10) / 10

  /*
   * Only a campus asset carries an option — a canton player is already in the
   * NFL, so there is no arrival left to price.
   */
  const devyOption =
    side === 'campus' && args.outlook
      ? devyAssetValue({ devyRank: args.devyRank ?? null, outlook: args.outlook, name: args.name })
      : null

  const gaps: string[] = []
  if (raw == null) gaps.push(side === 'campus' ? C2C_GAPS.noCollegeScores : C2C_GAPS.noScoring)
  if (devyOption) gaps.push(C2C_GAPS.scalesDoNotAdd)

  const production =
    raw == null
      ? `We hold no weekly scoring for ${who}, so his ${side} contribution is not estimated. That is an absence of data, not a zero.`
      : `${who} scores ${raw} a week, which counts ${weighted} toward the official score at this league's ${side} weight of ${sideWeight}.`

  const option =
    devyOption?.value != null
      ? ` Separately he is devy asset #${devyOption.devyRank} at ${devyOption.value} devy points — an option on his pro future, on a different scale that does not add to the points above.`
      : side === 'campus'
        ? ' His option on a pro future is not ranked.'
        : ''

  return {
    scale: C2C_WEIGHTED_POINTS,
    side,
    sideWeight,
    rawPointsPerWeek: raw,
    weightedPointsPerWeek: weighted,
    devyOption,
    gaps,
    basis: `${production}${option}`,
  }
}

/**
 * How much more a canton point is worth than a campus one in this league.
 *
 * ⚠ THE NUMBER MANAGERS GET WRONG. At the schema defaults this is 1.5 — a pro
 * scoring the same as a college player is worth half again as much to the
 * official score. Comparing the two on raw points, which is what every ordinary
 * points column invites, overvalues the college side by exactly this factor.
 *
 * Null when campus carries no weight at all, because the ratio is then
 * undefined rather than infinite.
 */
export function cantonToCampusRatio(
  league?: { campusScoreWeight?: number | null; cantonScoreWeight?: number | null } | null,
): number | null {
  const campus = c2cSideWeight('campus', league)
  const canton = c2cSideWeight('canton', league)
  if (campus <= 0) return null
  return Math.round((canton / campus) * 100) / 100
}
