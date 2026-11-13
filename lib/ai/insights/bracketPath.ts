/**
 * Bracket Path Calculator
 *
 * Given a team and the current bracket results, trace the path that team
 * must take to win the championship. Shows:
 *   - Which rounds they've already won
 *   - Which opponent they face next (or "TBD" if not yet known)
 *   - Whether they've been eliminated
 *
 * Used for rooting guide ("Your champion pick still needs to beat 3 teams")
 * and for commissioner recaps ("Brazil is still alive — 2 wins needed").
 *
 * roundOrder = array of rounds from current to final, e.g.:
 *   ["quarter_final", "semi_final", "final"]
 */

type BracketPathNode = {
  round: string
  matchId: string | null
  requiredOpponent: string | null
  description: string
  /** True if this team already won this round. */
  isWon: boolean
  /** True if this team was eliminated in this round. */
  isEliminated: boolean
}

export type BracketPathResult = {
  teamName: string
  /** "alive" = still in the tournament | "eliminated" = knocked out | "champion" = won it all */
  currentStatus: "alive" | "eliminated" | "champion"
  pathNodes: BracketPathNode[]
  matchesWon: number
  matchesRemaining: number
}

