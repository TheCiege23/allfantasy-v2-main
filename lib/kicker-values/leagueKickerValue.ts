/**
 * What a kicker is worth — measured, and deliberately NOT ranked.
 *
 * 🛑 READ THIS BEFORE ADDING A KICKER RANKING. The obvious build is the one the IDP stack
 * uses: project each player, rank the board, price the rank on a decay curve. For kickers
 * that would fabricate signal, and the measurement is unambiguous.
 *
 * Measured on production 2026-08-29 over 4,482 kicker game rows (2019-2025), scored under a
 * real league's own rulebook via `computeLeagueProjectedPoints`:
 *
 *   RANK DOES NOT PERSIST YEAR TO YEAR — and it does not merely decay to zero, it INVERTS.
 *     2019->20  rho -0.802      2022->23  rho -0.368
 *     2020->21  rho -0.584      2023->24  rho -0.280
 *     2021->22  rho -0.349      2024->25  rho -0.348
 *     mean -0.455, NEGATIVE IN ALL SIX PAIRS.
 *
 *   RANK DOES NOT PERSIST WITHIN A SEASON EITHER. Weeks 1-9 against weeks 10+:
 *     -0.230, +0.033, -0.177, -0.232, -0.038, +0.007, +0.018 — mean -0.088, i.e. nothing.
 *
 * ⚠ The per-season figures above are the valid ones. Pooling rank PAIRS across seasons and
 * running one correlation reports ~+0.97 and is an artefact: ranks restart at 1 every season,
 * so concatenation manufactures agreement. That mistake was made and caught while measuring
 * this; do not repeat it.
 *
 *   AND THE POSITION IS FLAT. Share of K1's points per game, averaged over 7 seasons:
 *     K3 89.9%   K6 82.9%   K12 76.8%   K18 69.9%   K24 64.7%   K30 52.9%
 *
 * Two consequences, and they point the same way. Nobody can know in advance who this year's
 * K1 is, and it would barely matter if they could: the whole startable population sits inside
 * a 1.55x band. A kicker is therefore priced as a POSITION, not as a player.
 *
 * ⚠ WHAT THIS REPLACED OVERSTATED THE SPREAD BY ROUGHLY EIGHT TIMES. The hand-set ladder in
 * `lib/idp-kicker-values.ts` ran 1200 / 800 / 500 / 300 / 100 — K1 at 12x a K25, ordered by
 * Sleeper's `search_rank`, which is a popularity poll rather than a projection. The measured
 * points ratio between K1 and K24 is 1.55x, and the ordering it used has no predictive value
 * at all. That ladder is now DELETED rather than merely bypassed: this module is the only
 * thing in the codebase that says what a kicker is worth, and `buildIdpKickerValueMap` takes
 * the number from here through its `kickerValue` context rather than owning a second one.
 *
 * WHAT DOES VARY, AND IS WORTH COMPUTING: the LEAGUE. Replacement level is a property of the
 * rulebook, not of the player — a 12-team league starting one kicker can replace him off
 * waivers tomorrow, while a league starting two from the same ~32-man supply cannot. That is
 * measurable, so it is what this module models.
 *
 * Pure: no prisma, no fetch, no clock.
 */

/**
 * How many kickers the NFL supplies at a time.
 *
 * One per team, and in practice a little more as teams churn through injuries and slumps.
 * Used only to turn a league's starting demand into a scarcity ratio.
 */
export const KICKER_SUPPLY = 32

/**
 * Share of K1's points per game by rank, averaged over the seven measured seasons.
 *
 * ⚠ THIS IS A DESCRIPTION OF THE POSITION, NOT A PRICING LADDER, AND MUST NOT BECOME ONE.
 * It is used to size how much a league's starters are worth OVER their replacement — a
 * question about the league's slot requirements. It is deliberately never indexed by an
 * individual player's rank, because no rank we could assign him predicts his next season
 * (see the header).
 */
const MEASURED_SHARE_BY_RANK: ReadonlyArray<{ rank: number; share: number }> = [
  { rank: 1, share: 1.0 },
  { rank: 3, share: 0.899 },
  { rank: 6, share: 0.829 },
  { rank: 12, share: 0.768 },
  { rank: 18, share: 0.699 },
  { rank: 24, share: 0.647 },
  { rank: 30, share: 0.529 },
]

/** Linear read of the measured shares, held flat past the last observation. */
export function kickerShareAtRank(rank: number): number {
  const r = Math.max(1, rank)
  const pts = MEASURED_SHARE_BY_RANK
  if (r >= pts[pts.length - 1].rank) return pts[pts.length - 1].share
  for (let i = 1; i < pts.length; i++) {
    if (r <= pts[i].rank) {
      const a = pts[i - 1]
      const b = pts[i]
      const t = (r - a.rank) / (b.rank - a.rank)
      return a.share + (b.share - a.share) * t
    }
  }
  return pts[0].share
}

/**
 * What the kicker position is worth at its most valuable, in the same 0-10000 units the
 * trade engine speaks.
 *
 * ⚠ A PRODUCT DECISION, LIKE THE IDP CEILING, AND FOR THE SAME REASON: no market prices
 * kickers, so nothing measures the exchange rate against offence. Unlike the IDP ceiling it
 * is set LOW and deliberately so — the measurement above says a kicker is a fungible slot
 * filler, and a number large enough to swing a trade grade would contradict the finding this
 * module exists to state.
 *
 * 500 dynasty puts a kicker below every startable offensive asset and roughly at a deep
 * bench flier, which is what he is. REDRAFT IS HIGHER (650), not lower, and the asymmetry is
 * the same one the IDP ceiling documents: dynasty values embed multi-year and youth premiums
 * that a kicker categorically cannot earn, so relative to offence he is worth strictly less
 * in dynasty than in a format where he fills a mandatory slot this week.
 */
export const KICKER_CEILING_DYNASTY = 500
export const KICKER_CEILING_REDRAFT = 650

/** How many kicker starting slots a league's roster demands. */
export function countKickerSlots(rosterPositions: readonly string[] | null | undefined): number {
  if (!Array.isArray(rosterPositions)) return 0
  return rosterPositions.filter((p) => String(p).toUpperCase() === 'K').length
}

export interface LeagueKickerValueArgs {
  rosterPositions: readonly string[] | null | undefined
  numTeams: number
  isDynasty: boolean
}

export interface LeagueKickerValue {
  /**
   * What EVERY rostered kicker in this league is worth. One number on purpose.
   *
   * Null when the league starts no kicker — then a kicker is not an asset in it at all, and
   * quoting a price would invent a market for a player nobody can field.
   */
  value: number | null
  /** Where replacement level falls in this league — the rank a waiver kicker occupies. */
  replacementRank: number
  /**
   * How much of the position's own range this league's starters actually command. The
   * scarcity term: 1 kicker in a 12-team league is nearly free, 2 in a 14-team league is not.
   */
  scarcity: number
  /**
   * Constant, and the whole point. Surfaces should say this out loud rather than implying a
   * precision the position does not have.
   */
  rankPredictability: 'none'
  /** Why the value is what it is, in one line a manager can argue with. */
  basis: string
}

/**
 * Price the kicker position for one league.
 *
 * Every kicker gets the same number. That is not a placeholder or a missing feature: it is
 * the finding. See the header for the six season pairs behind it.
 */
export function resolveLeagueKickerValue(args: LeagueKickerValueArgs): LeagueKickerValue {
  const slots = countKickerSlots(args.rosterPositions)
  const numTeams = Number.isFinite(args.numTeams) && args.numTeams > 0 ? args.numTeams : 12

  if (slots === 0) {
    return {
      value: null,
      replacementRank: 0,
      scarcity: 0,
      rankPredictability: 'none',
      basis: 'This league starts no kicker, so a kicker is not a tradeable asset in it.',
    }
  }

  /*
   * Replacement level is the first kicker nobody is forced to start. With one slot and twelve
   * teams that is K13 — and the measured board says K13 is still ~76% of K1, which is exactly
   * why the position prices low no matter how the ceiling is set.
   */
  const replacementRank = slots * numTeams + 1

  /*
   * Scarcity: what fraction of the league's own starting demand the supply cannot cover.
   * At 12 starters against a 32-kicker supply this is small; at 28 it is large. Clamped so a
   * pathological roster cannot price a kicker above the position ceiling.
   */
  const demand = slots * numTeams
  const scarcity = Math.max(0, Math.min(1, demand / KICKER_SUPPLY))

  /*
   * The value the position commands over its own replacement, scaled by scarcity. Using the
   * MEASURED share at replacement rather than a guessed floor: the flatter the board is at
   * that rank, the less a starting kicker is worth, which is the mechanism the data supports.
   */
  const ceiling = args.isDynasty ? KICKER_CEILING_DYNASTY : KICKER_CEILING_REDRAFT
  const edgeOverReplacement = 1 - kickerShareAtRank(replacementRank)
  const value = Math.max(1, Math.round(ceiling * (0.35 + 0.65 * scarcity) * (0.5 + edgeOverReplacement)))

  return {
    value,
    replacementRank,
    scarcity: Math.round(scarcity * 1000) / 1000,
    rankPredictability: 'none',
    basis:
      `Every kicker prices the same here: kicker rank does not persist ` +
      `(year-over-year Spearman -0.455, negative in all six measured season pairs), and the ` +
      `startable population spans only 1.55x. This league starts ${slots} kicker` +
      `${slots === 1 ? '' : 's'} across ${numTeams} teams, so replacement is about K${replacementRank}.`,
  }
}
