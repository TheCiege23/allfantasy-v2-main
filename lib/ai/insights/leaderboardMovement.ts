/**
 * Leaderboard Movement Calculator
 *
 * For each upcoming match, simulate both outcomes and compute the exact
 * rank changes across the pool. AI receives the pre-computed table —
 * it never re-runs this math.
 */
import type { InsightPool } from "./types"

type RankChange = {
  entryId: string
  displayName: string
  currentRank: number
  newRank: number
  /** Positive = moved up (better), negative = fell. */
  deltaRank: number
  pointsGained: number
  isCurrentUser: boolean
}

type LeaderboardScenario = {
  ifTeamWins: string
  rankChanges: RankChange[]
  entriesAffected: number
  entriesGaining: number
}

type LeaderboardShift = {
  matchId: string
  matchDescription: string
  round: string
  /** Always exactly 2 scenarios: home team wins, away team wins. */
  scenarios: [LeaderboardScenario, LeaderboardScenario]
  /** Largest absolute rank delta in any scenario. */
  maxRankSwing: number
  /** Which outcome reshuffles the most entries? */
  highestImpactWinner: string
}

export function computeLeaderboardMovement(pool: InsightPool): LeaderboardShift[] {
  const upcoming = pool.matches.filter((m) => m.status === "scheduled")

  return upcoming.map((match) => {
    const scenarios = [match.homeTeam, match.awayTeam].map(
      (winner): LeaderboardScenario => {
        // Compute hypothetical new scores for every entry
        const hypothetical = pool.entries.map((entry) => {
          const pick = entry.picks.find((p) => p.matchId === match.matchId)
          const gained = pick?.pickedTeam === winner ? match.pointsAtStake : 0
          return {
            entryId: entry.entryId,
            displayName: entry.displayName,
            isCurrentUser: entry.isCurrentUser,
            currentRank: entry.rank,
            newScore: entry.currentScore + gained,
            gained,
          }
        })

        // Re-rank: higher score = better rank. Ties preserve prior rank order.
        const ranked = [...hypothetical].sort(
          (a, b) => b.newScore - a.newScore || a.currentRank - b.currentRank,
        )

        const rankChanges: RankChange[] = ranked
          .map((e, i) => ({
            entryId: e.entryId,
            displayName: e.displayName,
            isCurrentUser: e.isCurrentUser,
            currentRank: e.currentRank,
            newRank: i + 1,
            deltaRank: e.currentRank - (i + 1),
            pointsGained: e.gained,
          }))
          // Only include entries whose rank changed OR who gain points
          .filter((r) => r.deltaRank !== 0 || r.pointsGained > 0)

        return {
          ifTeamWins: winner,
          rankChanges,
          entriesAffected: rankChanges.length,
          entriesGaining: rankChanges.filter((r) => r.pointsGained > 0).length,
        }
      },
    ) as [LeaderboardScenario, LeaderboardScenario]

    const maxRankSwing = Math.max(
      ...scenarios.flatMap((s) => s.rankChanges.map((r) => Math.abs(r.deltaRank))),
      0,
    )
    const highestImpactWinner =
      scenarios[0].entriesGaining >= scenarios[1].entriesGaining
        ? scenarios[0].ifTeamWins
        : scenarios[1].ifTeamWins

    return {
      matchId: match.matchId,
      matchDescription: `${match.homeTeam} vs ${match.awayTeam}`,
      round: match.round,
      scenarios,
      maxRankSwing,
      highestImpactWinner,
    }
  })
}
