/**
 * Who is in the bubble — the real rule, not a window below the cut.
 *
 * 🛑 THE RULE THIS TOURNAMENT ACTUALLY RUNS IS NOT WHAT EITHER IMPLEMENTATION
 * DID. Both the engine and the standings board treated the bubble as "the next N
 * managers after the cut": everybody inside the cut was safe, and the challengers
 * were simply the next few by rank.
 *
 * The rule as written on the commissioner's own sheet — *"Rankings 59-64 + Top 6
 * Scorers from Rankings 65-120"* — is materially different in two ways:
 *
 *   1. THE BOTTOM OF THE CUT IS NOT SAFE. Seeds 59–64 are in the bubble and can
 *      lose their place. Under the old rule they had already advanced.
 *   2. THE CHALLENGERS ARE CHOSEN BY POINTS, NOT BY RANK. Rank is W/L first, so
 *      the top scorers below the line are usually NOT the next few by rank — a
 *      6-3 team outranks an 4-5 team who outscored the entire conference. Taking
 *      the next few by rank picks different people than the rule names.
 *
 * So twelve compete for the last six places: six defending, six attacking. Under
 * the old rule those same six were already through and six different managers
 * were fighting for a separate set of spots.
 *
 * ⚠ ONE FUNCTION, USED BY THE ENGINE AND THE SCREEN. This is the same hazard as
 * `compareStandings`: a board that composes the bubble slightly differently from
 * the engine shows a manager as safe and then eliminates them.
 *
 * ⚠ CHALLENGERS ARE RANKED ON CUMULATIVE POINTS, which is what
 * `TournamentShell.bubbleScoringMode` defaults to and the only figure available
 * for an imported league today. A single-week variant needs per-week scoring
 * that is not ingested yet — see the weekly ingest work.
 */

export type BubbleComposition<T> = {
  /** Through, and not at risk. */
  safe: T[]
  /** Inside the cut, but defending their place in the bubble. */
  atRisk: T[]
  /** Below the cut, in the bubble on points. */
  challengers: T[]
  /** Below the cut and not in the bubble. */
  eliminated: T[]
}

/**
 * @param ranked every scored manager in the conference, already in standings
 *               order (W/L, then the tournament's tiebreaker).
 * @param cut how many advance outright.
 * @param bubbleSize how many places are contested — the same number is taken
 *                   from each side, so `6` means six defending and six attacking.
 * @param pointsOf cumulative points for a row, used to pick the challengers.
 */
export function composeBubble<T>(
  ranked: T[],
  opts: {
    cut: number
    bubbleSize: number
    enabled: boolean
    pointsOf: (row: T) => number
  },
): BubbleComposition<T> {
  const cut = Math.max(0, Math.min(opts.cut, ranked.length))
  const above = ranked.slice(0, cut)
  const below = ranked.slice(cut)

  if (!opts.enabled || opts.bubbleSize <= 0) {
    return { safe: above, atRisk: [], challengers: [], eliminated: below }
  }

  /* Never put the whole cut at risk: a bubble larger than the field it defends
     would leave nobody through, which is a misconfiguration rather than a rule. */
  const defending = Math.min(opts.bubbleSize, above.length)
  const safe = above.slice(0, above.length - defending)
  const atRisk = above.slice(above.length - defending)

  /*
   * ⚠ SORTED BY POINTS, NOT BY RANK, AND THAT IS THE WHOLE POINT OF THE RULE.
   * `below` arrives in standings order, which is wins-first. The managers the
   * rule wants are the highest SCORERS beneath the line, who are frequently not
   * the next names in that list.
   */
  const byPoints = [...below].sort((a, b) => opts.pointsOf(b) - opts.pointsOf(a))
  const challengers = byPoints.slice(0, Math.min(opts.bubbleSize, byPoints.length))

  const chosen = new Set(challengers)
  const eliminated = below.filter((row) => !chosen.has(row))

  return { safe, atRisk, challengers, eliminated }
}

/**
 * How many places the bubble decides.
 *
 * ⚠ `bubbleSize` DEFENDING PLUS `bubbleSize` ATTACKING, FOR `bubbleSize` PLACES.
 * The older engine advanced `floor(bubbleSize / 2)` out of a bubble it had
 * composed from below the cut only — a different number out of a different
 * group. Stated here so the two are never quietly reconciled to each other.
 */
export function bubbleWinnerCount(bubbleSize: number): number {
  return Math.max(0, bubbleSize)
}
