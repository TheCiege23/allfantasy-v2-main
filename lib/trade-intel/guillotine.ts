/**
 * Guillotine: the format where a trade is worth less every week and FAAB is the
 * real currency.
 *
 * One team is chopped per scoring period and its entire roster hits waivers. No
 * playoffs, no head-to-head — you are not trying to beat an opponent, you are
 * trying not to be LAST. Three consequences, none of which any value chart
 * knows about:
 *
 * ⚠ A TRADE DECAYS TOWARD ZERO AS THE SEASON RUNS. A player only generates value
 * for the weeks you are still alive, and the field shrinks every week. Acquiring
 * a starter with sixteen teams left is a different asset from acquiring him with
 * four left, and by the final weeks a trade is buying you one or two Sundays.
 *
 * ⚠ FAAB IS NOT A TIEBREAKER HERE, IT IS THE ACQUISITION MARKET. Every chop
 * dumps a complete roster onto waivers — better players hit the wire in this
 * format than in any other, every single week. And the budget never replenishes.
 * Pricing FAAB off a generic "share of an anchor value" heuristic understates it
 * badly in the one format where it decides seasons.
 *
 * ⚠ AND FLOOR BEATS CEILING, WHICH INVERTS NORMAL ADVICE. In head-to-head you
 * need to outscore one opponent, so upside wins games. Here you need to not be
 * last out of everyone, so a reliable fifteen is worth more than a boom-bust
 * twenty-five. A trade that raises your ceiling and lowers your floor is a bad
 * trade in this format and a good one in most others.
 */

export type GuillotineHorizon = {
  teamsRemaining: number
  startingTeams: number
  /** Scoring periods until one team is left. */
  weeksToEnd: number
  /**
   * How many more weeks THIS team can expect to be alive.
   *
   * ⚠ UNDER EQUAL ODDS, WHICH IS STATED RATHER THAN HIDDEN. If every surviving
   * team is equally likely to be chopped, the chance of surviving k more weeks
   * is (T−k)/T, and the expected number of weeks alive is exactly (T−1)/2. A
   * team well clear of the chop line does better than this and a team sitting on
   * it does worse; the margin figure below is what tells them apart.
   */
  expectedWeeksAlive: number
  /**
   * What a trade is worth now against what the same trade was worth in week one,
   * from horizon alone. 1 at the start, approaching 0 at the end.
   */
  tradeValueMultiplier: number
  /** Full rosters still to be dumped onto waivers. */
  releasesRemaining: number
  basis: string
}

export function guillotineHorizon(args: {
  teamsRemaining: number
  startingTeams: number
  teamsPerChop?: number
}): GuillotineHorizon | null {
  const { teamsRemaining, startingTeams } = args
  const perChop = Math.max(1, args.teamsPerChop ?? 1)
  if (teamsRemaining < 1 || startingTeams < 2 || teamsRemaining > startingTeams) return null

  const weeksToEnd = Math.ceil((teamsRemaining - 1) / perChop)
  const expectedWeeksAlive = (teamsRemaining - 1) / 2
  const atStart = (startingTeams - 1) / 2

  const tradeValueMultiplier = atStart > 0 ? expectedWeeksAlive / atStart : 0

  return {
    teamsRemaining,
    startingTeams,
    weeksToEnd,
    expectedWeeksAlive,
    tradeValueMultiplier,
    releasesRemaining: teamsRemaining - 1,
    basis:
      teamsRemaining <= 2
        ? `${teamsRemaining} teams left — this is decided in ${weeksToEnd} week${
            weeksToEnd === 1 ? '' : 's'
          }. Anything you trade for has almost no time to pay you back.`
        : `${teamsRemaining} of ${startingTeams} teams left. Assuming an even chance of being chopped, you can expect about ${expectedWeeksAlive.toFixed(
            1,
          )} more weeks — so a trade is worth roughly ${Math.round(
            tradeValueMultiplier * 100,
          )}% of what the same trade was worth in week one.`,
  }
}

export type ChopMargin = {
  rank: number
  teams: number
  /** Points between this team and the chop line last period. */
  margin: number
  /** Points between this team and the safe line, negative when below it. */
  onTheLine: boolean
  basis: string
}

/**
 * How close this team came to the blade last period.
 *
 * ⚠ THE COMPARISON IS AGAINST THE LOWEST SCORE, NOT THE AVERAGE. Finishing
 * eighth of ten is fine and finishing tenth ends the season; the distance that
 * matters is to the bottom, and it is the only distance that matters.
 */
export function chopMargin(args: {
  /** Last period's score for every surviving team. */
  scores: Array<{ rosterId: string; points: number }>
  rosterId: string
}): ChopMargin | null {
  const alive = args.scores.filter((s) => Number.isFinite(s.points))
  if (alive.length < 2) return null

  const sorted = [...alive].sort((a, b) => b.points - a.points)
  const idx = sorted.findIndex((s) => s.rosterId === args.rosterId)
  if (idx < 0) return null

  const me = sorted[idx]!
  const lowest = sorted[sorted.length - 1]!
  const secondLowest = sorted[sorted.length - 2]!

  /*
   * For everyone except the bottom team, the margin is the distance to the
   * chopped score. For the bottom team it is negative: how far they needed to
   * climb to survive.
   */
  const margin =
    idx === sorted.length - 1 ? me.points - secondLowest.points : me.points - lowest.points

  const onTheLine = idx >= sorted.length - 2

  return {
    rank: idx + 1,
    teams: sorted.length,
    margin: Math.round(margin * 10) / 10,
    onTheLine,
    basis:
      idx === sorted.length - 1
        ? `you were last by ${Math.abs(margin).toFixed(1)} last period`
        : onTheLine
          ? `you survived by ${margin.toFixed(1)} last period — you are on the line, and floor matters more than upside here`
          : `you were ${margin.toFixed(1)} clear of the chop last period`,
  }
}

export type FaabPower = {
  /** Winning bids observed on released players in this league. */
  sampleSize: number
  median: number
  /** What the top releases actually went for. */
  p90: number
  basis: string
}

/**
 * What FAAB actually buys in THIS league, from what people have really paid.
 *
 * ⚠ MEASURED, NOT ASSUMED, AND THAT IS THE POINT. The generic FAAB heuristic
 * prices a dollar as a linear share of some anchor value. In guillotine every
 * chop dumps a full roster onto the wire, so what a dollar buys is a fact about
 * this league's bidding and nothing else — and it is the only currency that
 * reliably converts into starters here.
 *
 * Returns null below a real sample. Quoting a median off two bids would be a
 * confident number resting on nothing.
 */
const MIN_BIDS_FOR_POWER = 8

export function faabPurchasingPower(args: { winningBids: number[] }): FaabPower | null {
  const bids = args.winningBids.filter((b) => Number.isFinite(b) && b >= 0).sort((a, b) => a - b)
  if (bids.length < MIN_BIDS_FOR_POWER) return null

  const at = (q: number) => bids[Math.min(bids.length - 1, Math.floor(q * bids.length))]!
  const median = at(0.5)
  const p90 = at(0.9)

  return {
    sampleSize: bids.length,
    median,
    p90,
    basis: `In this league the median winning bid on a chopped player is $${median} and the top ten percent go for $${p90} or more, across ${bids.length} claims. FAAB is the acquisition market here — every chop dumps a full roster on the wire — so treat a dollar as a real asset in this deal, not as a tiebreaker.`,
  }
}

/**
 * The floor-over-ceiling reminder, and when it is worth saying.
 *
 * Only surfaced once the field is small enough that a single bad week ends the
 * season. Saying it every week from week one is how a real warning becomes
 * wallpaper.
 */
export function floorOverCeilingNote(h: GuillotineHorizon): string | null {
  if (h.teamsRemaining > Math.max(4, h.startingTeams / 3)) return null
  return `With ${h.teamsRemaining} left, one bad week ends your season. You are not trying to outscore an opponent, you are trying not to finish last — a reliable floor is worth more than upside here, which is the opposite of the advice that works in head-to-head.`
}
