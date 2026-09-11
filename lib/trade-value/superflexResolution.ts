/**
 * Is this league superflex, and on what evidence?
 *
 * 🛑 `isSuperflex` IS NOT A LABEL. It reaches FantasyCalc as `numQbs`, sets the lineup
 * optimizer's flex count, picks the trade-driver league type and goes into the AI prompt. A
 * wrong value moves every quarterback's price and the grade with it.
 *
 * `/api/trade-evaluator` used to answer the question with `data.league?.qb_format === 'sf'`
 * against a schema that did `.default('sf')`. Two consequences, both silent:
 *
 *   1. OMITTED ⇒ SUPERFLEX. Any caller that left the field out — a script, an integration,
 *      anything that is not the trade page — had every QB priced on a superflex board, which is
 *      the scarcer and more expensive one. Because zod applies the default before the route
 *      sees the value, "the caller said superflex" and "the caller said nothing" were the same
 *      input, so the route could not have reported the assumption even if it had wanted to.
 *   2. CONTRADICTED ⇒ THE CALLER WINS. A client asserting '1qb' for a league whose roster
 *      genuinely carries SUPER_FLEX was believed.
 *
 * The league's own roster positions settle it in both cases, and the evaluator already had them
 * — `parseSleeperRosterPositions` runs a few lines away for the VORP config.
 */

export type QbFormatBasis =
  /** Decided by the league's own roster slots. Evidence. */
  | 'league_roster'
  /** The caller asserted it and we had no league to check against. Testimony. */
  | 'caller'
  /** Nobody knew. NOT evidence — see the asymmetry note below. */
  | 'assumed_1qb'

export interface SuperflexResolution {
  isSuperflex: boolean
  basis: QbFormatBasis
}

export interface SuperflexInput {
  /**
   * The league's parsed starting slots, when a league was resolved. Null/undefined means no
   * league to ask — NOT "no superflex".
   */
  leagueRoster?: { superflex: boolean; startingQB: number } | null
  /** What the caller declared, if anything. */
  declared?: '1qb' | 'sf' | null
}

export function resolveSuperflex(input: SuperflexInput): SuperflexResolution {
  const roster = input.leagueRoster
  if (roster) {
    /*
     * ⚠ `superflex` ALONE IS NOT THE WHOLE TEST, AND THIS IS THE HALF THAT GETS MISSED.
     * `parseSleeperRosterPositions` sets it only for a literal `SUPER_FLEX` slot, so a true
     * 2QB league — two plain `QB` starters — reads false while pricing exactly like superflex.
     * FantasyCalc models both as `numQbs: 2`, which is the tell that they are one case.
     */
    return { isSuperflex: roster.superflex || roster.startingQB >= 2, basis: 'league_roster' }
  }
  if (input.declared) {
    return { isSuperflex: input.declared === 'sf', basis: 'caller' }
  }
  /*
   * 🛑 THE FALLBACK IS 1QB, AND THE ASYMMETRY IS THE POINT.
   *
   * Both defaults are wrong when they are wrong, so "which is more often right" is not the
   * argument. The argument is DIRECTION: superflex is wrong in the direction that inflates —
   * it quotes every quarterback off a scarcer board, manufacturing value that the league does
   * not have. 1QB is the assumption that cannot invent value, and `basis` reports it as an
   * assumption so a caller is never told a guess is a measurement.
   */
  return { isSuperflex: false, basis: 'assumed_1qb' }
}
