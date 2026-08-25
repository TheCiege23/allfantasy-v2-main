/**
 * Where a future pick is likely to land, and therefore what it is actually
 * worth.
 *
 * ⚠ "A 2027 1ST" IS NOT A VALUE. It is a range, and which end of the range it
 * sits at depends entirely on the team it comes from. A first from a 3-7 team is
 * near the top of the round; a first from the team that just traded FOR Josh
 * Allen is near the bottom, for two straight years if they keep him. Pricing
 * both off the same round-average chart hands the contender a discount on every
 * pick they send out, which is exactly the trade the seller thinks they won.
 *
 * ⚠ AND THE SIGNAL DECAYS. Today's standings say a lot about next spring's draft
 * order and very little about the one after that. Rosters turn over, managers
 * quit, a quarterback gets hurt in week 3. So the estimate is pulled toward the
 * middle of the round as the horizon grows, and by the third year it IS the
 * middle — which is the same thing as admitting we do not know.
 *
 * ⚠ AND IT ASSUMES REVERSE-STANDINGS ORDER, WHICH MANY LEAGUES DO NOT USE.
 * Lotteries, reverse max points-for, and playoff-seeded orders all exist and we
 * do not read which one a league runs. The assumption is stated in the basis
 * string so a manager can discount it rather than discovering it.
 */

import { toBaselinePick } from './leagueScale'

/**
 * How much today's standings are allowed to move the estimate, by how many
 * offseasons away the pick is.
 *
 * Index 0 is the draft immediately ahead. These are judgement, and they are
 * deliberately conservative: at index 0 the current standings still only carry
 * seventy percent of the estimate, because there are weeks left to play.
 */
const HORIZON_WEIGHT = [0.7, 0.35, 0.1]

export type PickOutlook = {
  /**
   * The 12-team pick this is equivalent to, because every stored price is a
   * 12-team price. Null when the league already IS twelve teams.
   */
  baselineEquivalent: { round: number; slot: number; overall: number } | null
  season: number
  round: number
  /** 1 = first pick of the round. Null when there is no signal at all. */
  projectedSlot: number | null
  /** How much of the estimate came from the sender's standing, 0..1. */
  standingWeight: number
  /** True when the estimate is just the middle of the round. */
  isRoundAverage: boolean
  basis: string
}

export function projectPickSlot(args: {
  /** The pick's draft year. */
  season: number
  round: number
  /** The season currently being played. */
  currentSeason: number
  /**
   * Rank of the team the pick ORIGINATES from, 1 = best record. Null when we
   * cannot identify them, which is the common case for a pick that has already
   * changed hands.
   */
  senderRank: number | null
  teamCount: number
  /** Named in the sentence when we have it. */
  senderName?: string | null
}): PickOutlook {
  const { season, round, currentSeason, senderRank, teamCount } = args
  const mid = (teamCount + 1) / 2

  const offseasonsOut = Math.max(0, season - currentSeason - 1)
  const weight = senderRank == null ? 0 : (HORIZON_WEIGHT[offseasonsOut] ?? 0)

  if (weight === 0 || senderRank == null) {
    const eq = toBaselinePick({ round, slot: Math.round(mid), teamCount })
    return {
      season,
      round,
      projectedSlot: Math.round(mid),
      baselineEquivalent: eq.unchanged
        ? null
        : { round: eq.baselineRound, slot: eq.baselineSlot, overall: eq.overall },
      standingWeight: 0,
      isRoundAverage: true,
      basis:
        senderRank == null
          ? `we cannot tell which team this ${season} ${ordinalRound(round)} comes from, so it is priced as a middle pick`
          : `${season} is too far out for today's standings to say anything, so it is priced as a middle pick`,
    }
  }

  /*
   * Reverse standings: the best team picks last. Rank 1 of 12 -> slot 12.
   */
  const fromStanding = teamCount - senderRank + 1
  const slot = weight * fromStanding + (1 - weight) * mid
  const who = args.senderName ? args.senderName : `their ${ordinal(senderRank)}-place team`
  const eq = toBaselinePick({ round, slot: Math.round(slot), teamCount })

  /*
   * TWO SEPARATE CORRECTIONS, AND A DEEP LEAGUE NEEDS BOTH. The first says WHERE
   * in the round the pick lands, from the sender's record. The second says what
   * that position is actually worth, because every stored price is a 12-team
   * price and "1.28 of 32" is a third-rounder in those terms. Applying only the
   * first still overvalues every pick in a big league by a multiple.
   */
  const scale = eq.unchanged
    ? ''
    : ` — which is the ${ordinal(eq.overall)} player off the board, priced as a ${
        eq.baselineRound
      }.${String(eq.baselineSlot).padStart(2, '0')} in the 12-team terms our values use`

  return {
    season,
    round,
    projectedSlot: Math.round(slot),
    baselineEquivalent: eq.unchanged
      ? null
      : { round: eq.baselineRound, slot: eq.baselineSlot, overall: eq.overall },
    standingWeight: weight,
    isRoundAverage: false,
    basis: `${who} is ${ordinal(senderRank)} of ${teamCount} right now, so this ${season} ${ordinalRound(
      round,
    )} projects around ${round}.${String(Math.round(slot)).padStart(2, '0')} rather than the middle of the round (assumes reverse-standings order)${scale}`,
  }
}

/**
 * The second-order effect, said out loud rather than modelled.
 *
 * A trade that sends a star TO the team whose pick you are receiving makes that
 * team better, which pushes the pick later still. How much later is not
 * measurable from anything we hold — the honest move is to tell the manager the
 * direction and let them price it.
 */
export function pickInflationWarning(args: {
  /** The pick is coming from the same team receiving the best player in the deal. */
  senderIsAcquiringStar: boolean
  season: number
  round: number
}): string | null {
  if (!args.senderIsAcquiringStar) return null
  return `This ${args.season} ${ordinalRound(
    args.round,
  )} comes from the team acquiring the best player in the deal. If that works for them the pick lands later than their current record suggests — possibly for both years.`
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

function ordinalRound(round: number): string {
  return `${ordinal(round)}`
}
