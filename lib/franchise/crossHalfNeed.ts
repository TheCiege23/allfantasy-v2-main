/**
 * What a hole on the pro side does to the price of a college asset.
 *
 * This is the thing a combined franchise view makes possible and two separate
 * leagues cannot: if you are thin at running back in the pro league, a college
 * running back is not merely a college decision any more. He is the fix, or he
 * is not, and which one depends on WHEN HE ARRIVES.
 *
 * ── The rule that makes this honest ────────────────────────────────────────
 *
 * ⚠ A NEED NOW IS NOT FIXED BY SOMEONE FOUR YEARS AWAY, and this is the whole
 * correction. A naive version reads "thin at RB" and marks up every college
 * running back on the board, including freshmen who will not take an NFL snap
 * until the hole has been filled and re-opened twice. The premium therefore
 * decays with the arrival horizon, and by the far end it is gone.
 *
 * ⚠ AND TODAY'S HOLE IS A PROXY FOR THE HOLE AT ARRIVAL, WHICH IS NOT THE SAME
 * THING. We are pricing a player against a roster that will have turned over by
 * the time he plays. Age curves, contracts and pending free agency would tell us
 * whether the gap persists, and we model none of them — so the basis says the
 * premium rests on today's shape rather than a forecast.
 *
 * ⚠ IT MULTIPLIES DEVY POINTS AND CONVERTS NOTHING. The output adjusts a devy
 * asset's value on its own scale for this particular franchise. It does not put
 * a college player in market units — see lib/trade-intel/devyOutlook.ts. Need
 * changes what he is worth TO YOU, not what he is worth.
 */

import type { RosterNeed } from '@/lib/trade-intel/rosterNeed'

/**
 * How much of a present need survives until a college player can fill it.
 *
 * Index 0 is a player eligible for the next NFL draft. Judgement, and stated
 * rather than fitted, because nothing has been measured to fit it to. It is
 * deliberately steep: the hole you have this season is a fact, and the hole you
 * will have in four is a guess about a roster that no longer exists.
 */
const ARRIVAL_WEIGHT = [1, 0.6, 0.3, 0.1]

/** Beyond the table, a present need says nothing about him at all. */
const BEYOND_ARRIVAL_WEIGHT = 0

/**
 * How much each unfilled pro slot lifts a college asset at that position, before
 * the arrival discount.
 *
 * Deliberately smaller than `NEED_PREMIUM_PER_DEFICIT` in rosterNeed.ts, which
 * prices a player who can start THIS WEEK. A prospect cannot, however well he
 * fits, so the same deficit is worth less here.
 */
export const CROSS_HALF_PREMIUM_PER_DEFICIT = 0.04

/** Ceiling regardless of how many slots are open. */
export const CROSS_HALF_PREMIUM_CAP = 0.2

export type CrossHalfNeed = {
  position: string
  /** Unfilled starting slots at this position on the PRO side today. */
  proDeficit: number
  /** Seasons until the college player is draft-eligible. Null when unknown. */
  arrivalYears: number | null
  /** How much of the present need survives that wait, 0..1. */
  arrivalWeight: number | null
  /**
   * Multiplier on this asset's devy value FOR THIS FRANCHISE.
   *
   * ⚠ NULL WHEN WE COULD NOT LOOK — never 1.0, which would claim we checked the
   * pro roster and found it made no difference.
   */
  factor: number | null
  basis: string
  gaps: string[]
}

export const CROSS_HALF_GAPS = {
  noProNeed:
    'we could not read the pro side of this franchise, so nothing about your NFL roster is priced into this college asset',
  noHorizon:
    'we do not know which year he becomes draft-eligible, so we cannot tell whether he arrives in time to fill anything',
  presentShapeOnly:
    'the premium rests on your pro roster as it stands today — age, contracts and pending free agency would say whether the gap is still there when he arrives, and none of those are modelled',
  notAConversion:
    'this adjusts his value on the devy scale for your franchise; it does not price him in the units used for NFL players',
} as const

/**
 * Price a college asset against the franchise's pro-side need.
 *
 * `proNeed` is the ordinary roster need computed for the PRO league — the same
 * `computeRosterNeed` every trade screen already uses, just pointed at the other
 * half of the franchise.
 */
export function crossHalfNeedFactor(args: {
  /** The college player's position. */
  position: string | null | undefined
  /** Need on the pro side. Null when that half could not be read. */
  proNeed: RosterNeed | null
  /** From devyOutlook: seasons until he is draft-eligible. */
  arrivalYears: number | null
  name?: string | null
}): CrossHalfNeed {
  const who = args.name ?? 'this prospect'
  const position = (args.position ?? '').toUpperCase().trim()
  const gaps: string[] = [CROSS_HALF_GAPS.notAConversion]

  if (!args.proNeed || !position) {
    return {
      position,
      proDeficit: 0,
      arrivalYears: args.arrivalYears,
      arrivalWeight: null,
      factor: null,
      gaps: [...gaps, CROSS_HALF_GAPS.noProNeed],
      basis: `We could not read your pro roster, so ${who} is priced on the devy board alone.`,
    }
  }

  const row = args.proNeed.byPosition.find((p) => p.position === position)
  const proDeficit = row?.deficit ?? 0

  if (args.arrivalYears == null || !Number.isFinite(args.arrivalYears)) {
    return {
      position,
      proDeficit,
      arrivalYears: null,
      arrivalWeight: null,
      factor: null,
      gaps: [...gaps, CROSS_HALF_GAPS.noHorizon],
      basis: `Your pro side is ${proDeficit > 0 ? `short ${proDeficit} at ${position}` : `set at ${position}`}, but we do not know when ${who} becomes draft-eligible, so we cannot say whether he arrives in time to matter.`,
    }
  }

  const arrivalWeight =
    ARRIVAL_WEIGHT[args.arrivalYears] ?? BEYOND_ARRIVAL_WEIGHT

  /*
   * No hole is a real finding, not an absence: we looked at the pro roster and
   * it is set here. Factor 1 is correct, and the basis says which it is.
   */
  if (proDeficit <= 0) {
    return {
      position,
      proDeficit: 0,
      arrivalYears: args.arrivalYears,
      arrivalWeight,
      factor: 1,
      gaps: [...gaps, CROSS_HALF_GAPS.presentShapeOnly],
      basis: `Your pro roster is not short at ${position}, so ${who} carries no extra value to this franchise beyond his place on the devy board.`,
    }
  }

  const raw = proDeficit * CROSS_HALF_PREMIUM_PER_DEFICIT * arrivalWeight
  const premium = Math.min(raw, CROSS_HALF_PREMIUM_CAP)
  const factor = Math.round((1 + premium) * 1000) / 1000

  const timing =
    arrivalWeight === 0
      ? `he is ${args.arrivalYears} years from eligibility, which is far enough out that today's hole says nothing about him`
      : args.arrivalYears === 0
        ? 'he is eligible for the next NFL draft, so he could fill it almost immediately'
        : `he is ${args.arrivalYears} ${args.arrivalYears === 1 ? 'year' : 'years'} away, so only part of that need reaches him`

  return {
    position,
    proDeficit,
    arrivalYears: args.arrivalYears,
    arrivalWeight,
    factor,
    gaps: [...gaps, CROSS_HALF_GAPS.presentShapeOnly],
    basis:
      premium > 0
        ? `Your pro side is short ${proDeficit} at ${position} and ${timing}, so ${who} is worth about ${Math.round(premium * 100)}% more to this franchise than his devy rank alone implies.`
        : `Your pro side is short ${proDeficit} at ${position}, but ${timing}.`,
  }
}

/**
 * Apply the factor to a devy value.
 *
 * ⚠ NULL IN, NULL OUT. An unranked prospect stays unranked: a need premium on an
 * unknown quantity would manufacture a number out of a roster hole.
 */
export function applyCrossHalfNeed(
  devyPoints: number | null,
  need: CrossHalfNeed,
): number | null {
  if (devyPoints == null) return null
  if (need.factor == null) return devyPoints
  return Math.round(devyPoints * need.factor)
}
