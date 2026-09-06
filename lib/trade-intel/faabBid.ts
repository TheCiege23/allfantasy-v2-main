/**
 * What to bid, in dollars, in a league where FAAB is the ONLY way to acquire anybody. PURE.
 *
 * ── 🛑 WHY THIS EXISTS AND A TRADE VALUE DOES NOT ANSWER IT ─────────────────────────────────
 * Survivor All-Stars Guillotine says it outright: "There are no trades allowed in this league."
 * Every acquisition is a waiver bid on the roster of whoever was eliminated, against a $1000
 * season budget that does not carry over. So "is this trade fair?" is a question the league never
 * asks, and the whole trade-value surface is aimed past it. The question is "what do I bid?"
 *
 * ── THE EXCHANGE RATE IS NOT INVENTED HERE ─────────────────────────────────────────────────
 * `marketValueService.faabValue` already publishes one: a FULL budget is worth about the market
 * value of the ~`FAAB_ANCHOR_RANK`-th ranked asset, and `$X of $B = (X/B) × anchor`. This module
 * INVERTS that same rate rather than picking a second one — two exchange rates in one codebase is
 * the defect, not the fix. Its honesty label travels with it: the payload calls it "AF heuristic
 * (not market data)", and so does every sentence this module produces.
 *
 * ── 🛑 VALUE IS MARGINAL, NOT ABSOLUTE, AND THAT IS THE WHOLE POINT ─────────────────────────
 * A player is worth what he adds OVER THE MAN HE REPLACES in your starting lineup. The same
 * player is therefore worth different money to different teams, which is true, and is the reason
 * a league-wide "player value" cannot answer a bidding question on its own. A team already strong
 * at the position should bid nothing; the chart says they should bid the same as everybody.
 *
 * ── ⚠ WHY THE SURVIVAL HORIZON MOSTLY CANCELS, WHICH IS NOT THE INTUITIVE ANSWER ────────────
 * It is tempting to discount a bid by how long you expect to survive. That double-counts. The
 * player's value is already horizon-discounted (`survivorHorizon`), AND your budget expires at
 * the same moment for the same reason — you cannot spend it after you are chopped. Numerator and
 * denominator shrink together, so the ratio is very nearly horizon-free.
 *
 * What does NOT cancel is PACING. Unspent FAAB scores zero points, so dying with money is a
 * strictly dominated outcome: with `B` dollars and `W` expected weeks, anything under `B / W` on
 * a genuine upgrade means you are on track to be eliminated holding cash. That is the floor, and
 * it is an argument rather than a tuned constant — at one week left it correctly says "spend it
 * all", because on the last week the money is worth exactly nothing.
 */

import type { SurvivorHorizon } from './survivorSchedule'

export interface FaabBidInput {
  /**
   * The player's value under THIS league's rules — already through `scoringFit` and any
   * mid-season roster-change blend. Passing a raw chart value prices a league nobody is in.
   */
  playerValue: number
  /**
   * The value of the starter he would displace. Zero when he fills a slot you cannot fill at all,
   * which is the only case where his full value is marginal.
   */
  replacedValue: number
  /** FAAB you have left right now. */
  budgetRemaining: number
  /** The league's full season budget — the denominator the published anchor is expressed against. */
  budgetTotal: number
  /**
   * `MarketValuesPayload.faab.anchorValue`. Null when the payload resolved no anchor.
   *
   * 🛑 NULL DISABLES THE DOLLAR CONVERSION RATHER THAN SUBSTITUTING A GUESS. A bid is a number a
   * manager will actually spend; inventing the rate that produces it is the one thing this module
   * must not do.
   */
  anchorValue: number | null
  /** Where you are in the elimination schedule. Null means no pace floor — stated, not hidden. */
  horizon: SurvivorHorizon | null
}

export interface FaabBid {
  /** Do not pay more than this. Never above `budgetRemaining`. */
  ceiling: number
  /** What he adds over the man he replaces, in value points. Zero or less means do not bid. */
  marginalValue: number
  /** The marginal value converted at the league's published FAAB anchor. */
  fairValueBid: number
  /** `budgetRemaining / expectedWeeksAlive` — below this you are on track to die holding cash. */
  paceFloor: number
  /** The ceiling as a share of what you have left, for a surface that wants to show the working. */
  shareOfBudget: number
  reason: string
}

const usable = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * The bid ceiling, or null when it cannot be computed.
 *
 * ⚠ RETURNS null RATHER THAN ZERO ON MISSING INPUTS. Zero is a recommendation — "do not bid on
 * this man" — and it is the recommendation this module gives for a player who does not improve
 * your lineup. Returning it for an unreadable budget would tell a manager to pass on somebody
 * nobody has evaluated. Same refusal `scoringFit` and `survivorHorizon` make.
 */
export function faabBidCeiling(input: FaabBidInput): FaabBid | null {
  if (!usable(input.playerValue) || !usable(input.replacedValue)) return null
  if (!usable(input.budgetRemaining) || input.budgetRemaining < 0) return null
  if (!usable(input.budgetTotal) || input.budgetTotal <= 0) return null
  if (input.anchorValue == null || !usable(input.anchorValue) || input.anchorValue <= 0) return null

  const marginalValue = input.playerValue - input.replacedValue

  /*
   * 🛑 A NON-UPGRADE IS A ZERO, AND THIS IS THE MOST USEFUL THING THE MODULE SAYS. In a league
   * with a fixed budget and no trades, the commonest expensive mistake is bidding on a name rather
   * than on an improvement. The chart cannot tell you this; only your own lineup can.
   */
  if (marginalValue <= 0) {
    return {
      ceiling: 0,
      marginalValue,
      fairValueBid: 0,
      paceFloor: 0,
      shareOfBudget: 0,
      reason:
        'He does not improve your starting lineup — the man he would replace is worth as much or ' +
        'more. Bid nothing; in a fixed-budget league the dollars are the scarce thing, not the name.',
    }
  }

  /* The inverse of `faabValue`: value points → dollars, at the league's own published rate. */
  const fairValueBid = (marginalValue / input.anchorValue) * input.budgetTotal

  /* Dying with unspent FAAB is strictly dominated. At one week left this is the whole budget. */
  const weeks = input.horizon?.expectedWeeksAlive
  const paceFloor = usable(weeks) && weeks > 0 ? input.budgetRemaining / weeks : 0

  const ceiling = Math.min(input.budgetRemaining, Math.max(fairValueBid, paceFloor))
  const shareOfBudget = input.budgetRemaining > 0 ? ceiling / input.budgetRemaining : 0

  /*
   * ⚠ THE PACING SENTENCE IS ONLY AVAILABLE WHEN THERE IS A PACE, AND A TEST CAUGHT THIS SHIPPING
   * WITHOUT THE GUARD. With no schedule the first branch rendered "at this expected weeks" — broken
   * prose, and worse, it made the expiry argument for a league whose horizon we do not know. When
   * the ceiling is capped by the budget there are two different reasons why, and they are not
   * interchangeable: pacing says spend it, or his fair value simply exceeds your means.
   */
  const paced = usable(weeks) && weeks > 0
  const cappedByBudget = ceiling >= input.budgetRemaining

  const priceSentence =
    `Priced at the league's FAAB anchor (an AF heuristic, not market data): he adds ` +
    `${Math.round(marginalValue)} value over your current starter.`

  const driver = cappedByBudget
    ? paced && paceFloor >= fairValueBid
      ? `That is everything you have left — with about ${(weeks as number).toFixed(1)} weeks to go, ` +
        'FAAB you do not spend scores nothing.'
      : `He is worth more than you can afford. ${priceSentence} That prices him at ` +
        `$${Math.round(fairValueBid)}, so your whole remaining $${Math.round(input.budgetRemaining)} ` +
        'is the ceiling.'
    : paced && paceFloor > fairValueBid
      ? `Paced rather than priced: $${Math.round(input.budgetRemaining)} across about ` +
        `${(weeks as number).toFixed(1)} more weeks is $${Math.round(paceFloor)} a week, and bidding ` +
        'under that puts you on track to be eliminated holding cash.'
      : `${priceSentence} That is ${Math.round(shareOfBudget * 100)}% of what you have left.`

  return {
    ceiling: Math.round(ceiling),
    marginalValue: Math.round(marginalValue),
    fairValueBid: Math.round(fairValueBid),
    paceFloor: Math.round(paceFloor),
    shareOfBudget,
    reason: driver,
  }
}
