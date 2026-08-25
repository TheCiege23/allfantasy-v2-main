/**
 * What a devy asset is worth, in devy terms — and why that number must never be
 * added to a FantasyCalc value.
 *
 * ⚠ A DEVY PLAYER IS NOT PRICED BY ANY MARKET WE HOLD. Verified against
 * production on 2026-08-25: the `DevyAdp` table has ZERO rows, and
 * `DevyPlayer.devyAdp` is null for all 1,718 college players on file. There is
 * no FantasyCalc entry, no DynastyProcess entry, and no NCAAF trade-value source
 * anywhere in the schema. The only college signal that exists is a DERIVED
 * SCOUTING COMPOSITE — recruiting stars, production, projected draft round.
 *
 * ⚠ SO THE RANK BRIDGE IN afValue.ts IS NOT AVAILABLE HERE, AND COPYING IT WOULD
 * BE A LIE. What makes that bridge honest is that it reconciles two
 * INDEPENDENTLY DERIVED MARKET sources which agree on order (Spearman 0.939) and
 * disagree only on scale. Neither half of that holds for college: there is one
 * source, it is not a market, and nothing corroborates it. Ranking a scouting
 * composite onto the NFL value curve would produce a confident number in
 * FantasyCalc units that no trade has ever tested — the exact failure this
 * module exists to prevent.
 *
 * ⚠ AND THE OPTION CANNOT BE PRICED EITHER. The correct model for a devy asset
 * is an option — P(reaches NFL relevance) x value on arrival x time discount —
 * but P has never been OBSERVED. `graduatedToNFL` is false for all 1,718
 * players and `devy_rookie_transitions` holds zero rows, so not one college
 * player in this database has ever been seen reaching the NFL. A probability
 * fitted to zero events is an assumption wearing a number's clothes. This module
 * therefore reports `pReachesRelevance: null` and says so, rather than shipping
 * a prior that would look measured.
 *
 * ── What IS honest, and is what this returns ───────────────────────────────
 *
 * Two things about a devy asset are genuinely knowable from what we hold:
 *
 *   1. WHERE HE STANDS AMONG OTHER DEVY ASSETS. `computeDraftProjection` already
 *      scores this 0-100 over the signals actually present, renormalising rather
 *      than defaulting absent ones.
 *   2. HOW LONG THE WAIT IS. `draftEligibleYear` is populated for all 1,718
 *      players, so the horizon is a fact, not an estimate.
 *
 * Combining them gives an ORDINAL STANDING WITHIN THE DEVY POOL — enough to rank
 * one devy asset against another, which is the question a devy manager actually
 * asks. It is NOT a price, it does not convert, and the `scale` tag on every
 * result is what stops it being mistaken for one.
 */

import { computeDraftProjection, type DraftProjectionConfidence } from '@/lib/devy-model'

/**
 * The scale tag. Deliberately not the string 'fantasycalc', and carried on every
 * result so a consumer cannot forget which units it is holding. `DevyOutlook` is
 * an object rather than a bare number for the same reason: it cannot be added to
 * a FantasyCalc value without the type checker objecting, which is the only
 * version of "never mixed" that survives a refactor by someone who has not read
 * this header.
 */
export const DEVY_SCALE = 'devy-ordinal-0-100' as const
export type DevyScale = typeof DEVY_SCALE

/**
 * How much a devy asset's standing is discounted for the wait.
 *
 * Index 0 is a player eligible for the NEXT NFL draft. These are judgement and
 * are stated rather than fitted, because there is nothing to fit them to — see
 * the calibration note above. They are deliberately steep: a college player
 * scores nothing for his fantasy manager in the meantime, so the wait is a real
 * cost and not a rounding detail.
 */
const HORIZON_DISCOUNT = [1, 0.75, 0.5, 0.3]

/** Applied when the horizon is beyond the table — the wait is effectively total. */
const BEYOND_HORIZON_DISCOUNT = 0.2

export type DevyOutlook = {
  /** Always DEVY_SCALE. Present so a consumer cannot forget which units it holds. */
  scale: DevyScale
  /**
   * Standing within the devy pool, 0-100, after the horizon discount. Null when
   * not one scouting signal was available — NOT zero, which would rank an
   * unknown player below a known bad one.
   */
  score: number | null
  /** How much of the scouting model's weight was actually backed by data. */
  confidence: DraftProjectionConfidence | null
  /** Seasons until he is eligible for the NFL draft. Null when unknown. */
  horizonYears: number | null
  /** The discount applied for the wait. Null when the horizon is unknown. */
  timeDiscount: number | null
  /**
   * ⚠ ALWAYS NULL TODAY, and that is a finding rather than a stub. Zero NFL
   * transitions have ever been recorded, so this cannot be estimated from
   * anything we hold.
   */
  pReachesRelevance: number | null
  /** Why pReachesRelevance is what it is. */
  calibration: 'never-observed'
  /** Scouting signals that contributed. */
  present: string[]
  /** Scouting signals we had no value for — named, never defaulted. */
  missing: string[]
  /** Everything this number does NOT account for. */
  gaps: string[]
  /** Plain-language explanation, always present. */
  basis: string
}

export const DEVY_GAPS = {
  noMarket:
    'no market prices college players — this is a scouting composite, not a traded price, and it does not convert to the value scale used for NFL players',
  noTransitionData:
    'no college player in this database has ever been recorded reaching the NFL, so the chance he arrives at all is not estimated here',
  noAdp:
    'devy ADP is empty for every player on file, so the one market-shaped signal the scouting model expects is missing',
  unknownHorizon:
    'we do not know which year he becomes draft-eligible, so no discount for the wait is applied',
} as const

/**
 * Score a devy asset against other devy assets.
 *
 * `player` is duck-typed to match `computeDraftProjection`, which reads
 * recruitingComposite, breakoutAge, projectedDraftRound and devyAdp.
 */
export function projectDevyOutlook(args: {
  player: unknown
  /** From DevyPlayer.draftEligibleYear. Populated for every row on file. */
  draftEligibleYear: number | null
  /** The season currently being played. */
  currentSeason: number
  /** Named in the sentence when we have it. */
  name?: string | null
}): DevyOutlook {
  const { player, draftEligibleYear, currentSeason } = args
  const projection = computeDraftProjection(player)

  const gaps: string[] = [DEVY_GAPS.noMarket, DEVY_GAPS.noTransitionData]
  if (projection.missing.includes('devyAdp')) gaps.push(DEVY_GAPS.noAdp)

  const who = args.name ? args.name : 'this player'

  const horizonYears =
    draftEligibleYear == null || !Number.isFinite(draftEligibleYear)
      ? null
      : Math.max(0, draftEligibleYear - currentSeason)

  const timeDiscount =
    horizonYears == null ? null : (HORIZON_DISCOUNT[horizonYears] ?? BEYOND_HORIZON_DISCOUNT)

  /*
   * No scouting signal at all. Saying so beats ranking him anywhere, including
   * last — an unknown player is not a bad player.
   */
  if (projection.score == null) {
    return {
      scale: DEVY_SCALE,
      score: null,
      confidence: null,
      horizonYears,
      timeDiscount,
      pReachesRelevance: null,
      calibration: 'never-observed',
      present: projection.present,
      missing: projection.missing,
      gaps,
      basis: `We hold no recruiting, production or draft-projection signal for ${who}, so he is not ranked against other devy assets at all. This is not a low score.`,
    }
  }

  /*
   * The horizon is unknown. Rank him on scouting alone rather than guessing at
   * the wait, and say which half of the estimate is missing.
   */
  if (timeDiscount == null || horizonYears == null) {
    return {
      scale: DEVY_SCALE,
      score: projection.score,
      confidence: projection.confidence,
      horizonYears: null,
      timeDiscount: null,
      pReachesRelevance: null,
      calibration: 'never-observed',
      present: projection.present,
      missing: projection.missing,
      gaps: [...gaps, DEVY_GAPS.unknownHorizon],
      basis: `${who} scores ${projection.score} of 100 against other devy assets on scouting signal alone. We do not know when he becomes draft-eligible, so nothing is discounted for the wait — a player four years away would score the same here.`,
    }
  }

  const score = Math.round(projection.score * timeDiscount)
  const wait =
    horizonYears === 0
      ? 'he is eligible for the next NFL draft'
      : horizonYears === 1
        ? 'he is a year away from draft eligibility'
        : `he is ${horizonYears} years from draft eligibility`

  return {
    scale: DEVY_SCALE,
    score,
    confidence: projection.confidence,
    horizonYears,
    timeDiscount,
    pReachesRelevance: null,
    calibration: 'never-observed',
    present: projection.present,
    missing: projection.missing,
    gaps,
    basis: `${who} scores ${projection.score} of 100 on scouting against other devy assets, and ${wait}, so he stands at ${score} once the wait is priced in. This ranks him among devy assets only — it is not a value and does not compare to an NFL player's price.`,
  }
}

/** One asset in a proposed trade, tagged with which scale can price it. */
export type TradeAsset = {
  label: string
  kind: 'nfl_player' | 'devy_player' | 'nfl_rookie_pick' | 'college_pick'
}

export type MixedScaleVerdict = {
  gradeable: false
  /** Assets priced on the market scale. */
  pricedAssets: string[]
  /** Assets that only the devy scale can rank. */
  devyAssets: string[]
  reason: string
}

/**
 * Refuse to grade a trade that spans both scales.
 *
 * ⚠ THIS IS THE POINT OF THE MODULE. A deal that sends an NFL running back for
 * two devy wideouts has no single number, because the two halves are denominated
 * in different things and no tested conversion exists between them. Returning a
 * letter would mean inventing that conversion silently, and the manager would
 * have no way to tell that the grade rests on it.
 *
 * Returns null when the trade does NOT span scales, which means the normal
 * grader can proceed untouched.
 *
 * ⚠ NFL ROOKIE PICKS ARE ON THE MARKET SIDE; COLLEGE PICKS ARE NOT. "A 2027 1st"
 * and "a 2027 college 1st" are different assets with similar labels — see
 * C2CLeagueConfig.supportsTradeableRookiePicks versus
 * supportsTradeableCollegePicks. Collapsing them prices a college pick off the
 * NFL rookie curve, which is the same error as pricing the player off it.
 */
export function refuseMixedScaleGrade(assets: TradeAsset[]): MixedScaleVerdict | null {
  const devyAssets = assets
    .filter((a) => a.kind === 'devy_player' || a.kind === 'college_pick')
    .map((a) => a.label)
  const pricedAssets = assets
    .filter((a) => a.kind === 'nfl_player' || a.kind === 'nfl_rookie_pick')
    .map((a) => a.label)

  if (devyAssets.length === 0 || pricedAssets.length === 0) return null

  const devyList = devyAssets.join(', ')
  const pricedList = pricedAssets.join(', ')

  return {
    gradeable: false,
    pricedAssets,
    devyAssets,
    reason: `This trade cannot be graded as one number. ${pricedList} ${
      pricedAssets.length === 1 ? 'is' : 'are'
    } priced from real trade markets. ${devyList} ${
      devyAssets.length === 1
        ? 'is a college asset that no market prices'
        : 'are college assets that no market prices'
    } — we can rank ${
      devyAssets.length === 1 ? 'him' : 'them'
    } against other devy assets, but there is no tested way to convert that into the scale the rest of the deal uses. Grading it anyway would mean inventing an exchange rate and not telling you.`,
  }
}
