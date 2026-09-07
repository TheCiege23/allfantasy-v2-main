/**
 * What to bid, in dollars, in a league where FAAB is the ONLY way to acquire anybody. PURE.
 *
 * ── 🛑 WHY THIS EXISTS AND A TRADE VALUE DOES NOT ANSWER IT ─────────────────────────────────
 * Survivor All-Stars Guillotine says it outright: "There are no trades allowed in this league."
 * Every acquisition is a waiver bid on the roster of whoever was eliminated, against a $1000
 * season budget that does not carry over. So "is this trade fair?" is a question the league never
 * asks, and the whole trade-value surface is aimed past it. The question is "what do I bid?"
 *
 * ── 🛑 THE FIRST VERSION USED THE REPO'S FIXED FAAB ANCHOR AND IT DID NOT SURVIVE THE FORMAT ─
 * `marketValueService.faabValue` publishes an exchange rate: a full budget is worth about the
 * market value of the ~150th-ranked asset. Inverting it was the right instinct — one exchange
 * rate, not two — and the result was measured against the live league before wiring, which is the
 * only reason it did not ship:
 *
 *     Survivor All-Stars Guillotine, week 11, advising BDog256, $1000 left
 *       Drake London    margin 4002   ->  $1000   (the WHOLE budget)
 *       Kyren Williams  margin 3088   ->  $1000
 *       Drake Maye      margin 1873   ->  $1000
 *
 * "Bid everything on all three" is not advice. The anchor is 189 value points, and London's margin
 * alone is 21x that, so every genuine upgrade blows through any budget.
 *
 * ⚠ AND THE CAUSE IS THE FORMAT, NOT THE ARITHMETIC. A rank-150 anchor encodes "a full budget buys
 * you a waiver flyer", which is true in a 12-team league with a deep free-agent pool. Measured in
 * this one: 267 players rostered, a 198-player chart, and **zero** free agents on it. There is no
 * flyer to buy. The only supply is a chopped roster, which drops genuine starters every week.
 * Different supply, different price, and a constant calibrated elsewhere cannot know that.
 *
 * ── THE FIX IS TO PRICE AGAINST THE SUPPLY, WHICH NEEDS NO ANCHOR AT ALL ────────────────────
 * Your budget buys a share of what is actually for sale. Spread it across the upgrades on offer,
 * in proportion to how much each one improves you:
 *
 *     bid(p) = budget x margin(p) / (weeksLeft x totalMarginOnOfferThisWeek)
 *
 * Self-normalizing, no free parameter, and the budget constraint falls out rather than being
 * imposed: win every upgrade this week and you have spent exactly one week's share.
 *
 * ⚠ THE ONE PREMISE, STATED SO IT CAN BE ARGUED WITH: future weeks' pools resemble this one. That
 * is what `weeksLeft` divides by. It is a real assumption — a week where a stacked roster gets
 * chopped is worth more than an average one — and it is the honest default when you cannot see
 * next week's casualty. At one week left it correctly disappears: `weeksLeft` is 1, so this week's
 * pool gets the entire remaining budget, because unspent FAAB scores nothing.
 */

import type { SurvivorHorizon } from './survivorSchedule'

export interface FaabCandidate {
  id: string
  name: string
  position: string | null
  /**
   * The player's value under THIS league's rules — already through `scoringFit` and any
   * mid-season roster-change blend. A raw chart value prices a league nobody is in.
   */
  playerValue: number
  /**
   * The starter he would displace in YOUR lineup. Zero when he fills a slot you cannot fill at
   * all, which is the only case where his full value is marginal.
   */
  replacedValue: number
}

export interface FaabBid {
  id: string
  name: string
  position: string | null
  /** Do not pay more than this. */
  ceiling: number
  /** What he adds over the man he replaces. Zero or less means do not bid. */
  marginalValue: number
  /** His share of this week's upgrade value, 0–1. */
  shareOfSupply: number
  reason: string
}

export interface FaabAllocation {
  bids: FaabBid[]
  /** Total marginal value on offer this week, counting upgrades only. */
  supplyValue: number
  /** What this week's pool is worth of your budget — `budgetRemaining / weeksAssumed`. */
  weekBudget: number
  /** Expected weeks you still get to play. 1 when no schedule was supplied. */
  weeksAssumed: number
  /** True when `weeksAssumed` came from a real schedule rather than the fallback. */
  paced: boolean
  reason: string
}

const usable = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n)

/**
 * Allocate a FAAB budget across everyone hitting waivers this week.
 *
 * 🛑 POOL-BASED ON PURPOSE, AND PASSING ONE PLAYER IS A FOOTGUN. A bid is only meaningful against
 * the alternatives — a player who is your one upgrade deserves your whole week's budget, and the
 * same player alongside two better ones does not. Calling this with a single candidate asserts
 * "he is the only upgrade available", which is a claim about the pool, not about him.
 *
 * ⚠ RETURNS null RATHER THAN ZEROS ON UNUSABLE INPUT. Zero is a recommendation — "do not bid on
 * this man" — and it is what a non-upgrade gets. Returning it for an unreadable budget would tell
 * a manager to pass on somebody nobody has evaluated. Same refusal `scoringFit` makes.
 */
export function allocateFaabAcrossPool(input: {
  pool: FaabCandidate[]
  budgetRemaining: number
  horizon: SurvivorHorizon | null
}): FaabAllocation | null {
  if (!Array.isArray(input.pool)) return null
  if (!usable(input.budgetRemaining) || input.budgetRemaining < 0) return null

  const weeks = input.horizon?.expectedWeeksAlive
  const paced = usable(weeks) && weeks >= 1
  const weeksAssumed = paced ? (weeks as number) : 1
  const weekBudget = input.budgetRemaining / weeksAssumed

  const scored = input.pool.map((c) => ({
    c,
    margin: usable(c.playerValue) && usable(c.replacedValue) ? c.playerValue - c.replacedValue : null,
  }))

  const supplyValue = scored.reduce((s, x) => s + (x.margin != null && x.margin > 0 ? x.margin : 0), 0)

  const bids: FaabBid[] = scored.map(({ c, margin }) => {
    const head = { id: c.id, name: c.name, position: c.position }

    if (margin == null) {
      return {
        ...head,
        ceiling: 0,
        marginalValue: 0,
        shareOfSupply: 0,
        reason: 'No usable value for him or for the man he would replace — not priced, rather than priced at zero.',
      }
    }

    /*
     * 🛑 A NON-UPGRADE IS A ZERO, AND THIS IS THE MOST USEFUL THING THE MODULE SAYS. In a fixed
     * budget league with no trades, the commonest expensive mistake is bidding on a name rather
     * than on an improvement. The chart cannot tell you which you are doing; only your lineup can.
     */
    if (margin <= 0) {
      return {
        ...head,
        ceiling: 0,
        marginalValue: Math.round(margin),
        shareOfSupply: 0,
        reason:
          'He does not improve your starting lineup — the man he would replace is worth as much or ' +
          'more. Bid nothing; the dollars are the scarce thing, not the name.',
      }
    }

    const shareOfSupply = supplyValue > 0 ? margin / supplyValue : 0
    const ceiling = Math.min(input.budgetRemaining, weekBudget * shareOfSupply)

    return {
      ...head,
      ceiling: Math.round(ceiling),
      marginalValue: Math.round(margin),
      shareOfSupply,
      reason:
        `He is ${Math.round(shareOfSupply * 100)}% of the upgrade value on waivers this week, so he ` +
        `gets ${Math.round(shareOfSupply * 100)}% of this week's $${Math.round(weekBudget)}` +
        (paced
          ? ` — your $${Math.round(input.budgetRemaining)} spread over about ${weeksAssumed.toFixed(1)} more weeks.`
          : ' — your whole remaining budget, because no elimination schedule was supplied to pace it against.'),
    }
  })

  const upgrades = bids.filter((b) => b.ceiling > 0).length
  const reason = paced
    ? `${upgrades} genuine upgrade${upgrades === 1 ? '' : 's'} on waivers. $${Math.round(input.budgetRemaining)} ` +
      `across about ${weeksAssumed.toFixed(1)} more weeks is $${Math.round(weekBudget)} for this week's pool, ` +
      'split by how much each man actually improves you.'
    : `${upgrades} genuine upgrade${upgrades === 1 ? '' : 's'} on waivers, and no schedule to pace against — ` +
      'this week\'s pool is priced against your whole remaining budget, which is the aggressive read.'

  return { bids, supplyValue: Math.round(supplyValue), weekBudget: Math.round(weekBudget), weeksAssumed, paced, reason }
}
