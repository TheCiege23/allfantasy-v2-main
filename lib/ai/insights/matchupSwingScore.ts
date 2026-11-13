/**
 * Matchup Swing Score Calculator
 *
 * For every upcoming match, compute:
 *   - Pick split (% on each side)
 *   - Max points at risk (minority picks × points at stake)
 *   - Chaos rating 1–10 (how evenly split are picks, weighted by round)
 *   - Composite swing score (chaos × maxPointsAtRisk)
 *
 * The top-swing match is the one most likely to reshuffle the leaderboard.
 * The highest-chaos match is the most evenly split (hardest to predict).
 *
 * These are different: a final match with a 60/40 split on 16 pts
 * outranks a group match that is 50/50 on 2 pts.
 */
import type { InsightPool } from "./types"

type MatchSwingScore = {
  matchId: string
  matchDescription: string
  round: string
  homeTeam: string
  awayTeam: string
  homePicks: number
  awayPicks: number
  homePickPct: number
  awayPickPct: number
  pointsAtStake: number
  /** minority_count × pointsAtStake */
  maxPointsAtRisk: number
  /** 1–10: higher = more evenly split (10 = perfect 50/50 split) */
  chaosRating: number
  /** Total entries with a pick on this match. */
  entriesWithPick: number
  /** composite: chaosRating × maxPointsAtRisk — use to find the most impactful match */
  swingScore: number
}

type MatchupSwingSummary = {
  matches: MatchSwingScore[]
  /** Highest composite swing score — the match most likely to change the leaderboard. */
  topSwingMatch: MatchSwingScore | null
  /** Most evenly split regardless of points — the "coin flip" match. */
  highestChaosMatch: MatchSwingScore | null
}

const ROUND_WEIGHT: Record<string, number> = {
  group: 0.7,
  round_of_32: 0.75,
  round_of_16: 0.85,
  quarter_final: 0.9,
  semi_final: 1.0,
  final: 1.0,
  third_place: 0.6,
}

export function computeMatchupSwingScores(pool: InsightPool): MatchupSwingSummary {
  const upcoming = pool.matches.filter((m) => m.status === "scheduled")

  const matches: MatchSwingScore[] = upcoming.map((m) => {
    const { home, away } = m.pickDistribution
    const total = home + away

    const balance = total > 0 ? Math.min(home, away) / total : 0
    const weight = ROUND_WEIGHT[m.round] ?? 0.8
    const chaosRating = Math.max(1, Math.min(10, Math.round(balance * weight * 20)))

    const minority = Math.min(home, away)
    const maxPointsAtRisk = minority * m.pointsAtStake
    const swingScore = chaosRating * maxPointsAtRisk

    return {
      matchId: m.matchId,
      matchDescription: `${m.homeTeam} vs ${m.awayTeam}`,
      round: m.round,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      homePicks: home,
      awayPicks: away,
      homePickPct: total > 0 ? Math.round((home / total) * 100) : 50,
      awayPickPct: total > 0 ? Math.round((away / total) * 100) : 50,
      pointsAtStake: m.pointsAtStake,
      maxPointsAtRisk,
      chaosRating,
      entriesWithPick: total,
      swingScore,
    }
  })

  const topSwingMatch =
    matches.length > 0
      ? matches.reduce((best, m) => (m.swingScore > best.swingScore ? m : best))
      : null

  const highestChaosMatch =
    matches.length > 0
      ? matches.reduce((best, m) => (m.chaosRating > best.chaosRating ? m : best))
      : null

  return { matches, topSwingMatch, highestChaosMatch }
}
