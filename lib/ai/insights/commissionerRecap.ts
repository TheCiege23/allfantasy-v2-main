/**
 * Commissioner Recap Calculator
 *
 * Produces the data for a post-round or daily commissioner summary:
 *   - Biggest winner today (most points earned from finalized matches)
 *   - Biggest loser today (most points missed from wrong picks)
 *   - Most exciting completed match (highest split + high stakes)
 *   - Best upcoming match (highest swing score)
 *   - Suggested chat post (commissioner-ready message)
 *   - Pool health summary (avg score, spread, active entries)
 *
 * All numbers are deterministic. AI writes the tone on top.
 */
import type { InsightPool } from "./types"
import { computeMatchupSwingScores } from "./matchupSwingScore"

type CommissionerRecapResult = {
  biggestWinnerToday: {
    displayName: string
    pointsGainedToday: number
    currentRank: number
  } | null
  biggestLoserToday: {
    displayName: string
    missedPointsToday: number
    currentRank: number
  } | null
  mostExcitingCompletedMatch: {
    matchDescription: string
    pickSplit: string
    winner: string | null
    entriesCorrect: number
    entriesWrong: number
  } | null
  bestUpcomingMatch: {
    matchDescription: string
    round: string
    chaosRating: number
    pickSplit: string
    suggestedPost: string
  } | null
  poolHealthSummary: {
    activeEntries: number
    averageScore: number
    topScore: number
    bottomScore: number
    pointsSeparatingFirstFromLast: number
  }
}

export function computeCommissionerRecap(
  pool: InsightPool,
  today: Date = new Date(),
): CommissionerRecapResult {
  const dayStart = new Date(today)
  dayStart.setUTCHours(0, 0, 0, 0)
  const dayEnd = new Date(today)
  dayEnd.setUTCHours(23, 59, 59, 999)

  // Matches that finalized today
  const finalizedToday = pool.matches.filter((m) => {
    if (m.status !== "final" || !m.kickoffUtc) return false
    const d = new Date(m.kickoffUtc)
    return d >= dayStart && d <= dayEnd
  })

  // Points earned / missed per entry today
  const todayEarned = new Map<string, number>()
  const todayMissed = new Map<string, number>()

  for (const match of finalizedToday) {
    for (const entry of pool.entries) {
      const pick = entry.picks.find((p) => p.matchId === match.matchId)
      if (!pick) continue
      if (pick.isCorrect) {
        todayEarned.set(entry.entryId, (todayEarned.get(entry.entryId) ?? 0) + match.pointsAtStake)
      } else {
        todayMissed.set(entry.entryId, (todayMissed.get(entry.entryId) ?? 0) + match.pointsAtStake)
      }
    }
  }

  // Biggest winner today
  let biggestWinnerToday: CommissionerRecapResult["biggestWinnerToday"] = null
  let maxEarned = 0
  for (const [entryId, pts] of todayEarned) {
    if (pts > maxEarned) {
      maxEarned = pts
      const entry = pool.entries.find((e) => e.entryId === entryId)
      if (entry) {
        biggestWinnerToday = {
          displayName: entry.displayName,
          pointsGainedToday: pts,
          currentRank: entry.rank,
        }
      }
    }
  }

  // Biggest loser today
  let biggestLoserToday: CommissionerRecapResult["biggestLoserToday"] = null
  let maxMissed = 0
  for (const [entryId, pts] of todayMissed) {
    if (pts > maxMissed) {
      maxMissed = pts
      const entry = pool.entries.find((e) => e.entryId === entryId)
      if (entry) {
        biggestLoserToday = {
          displayName: entry.displayName,
          missedPointsToday: pts,
          currentRank: entry.rank,
        }
      }
    }
  }

  // Most exciting completed match today
  let mostExcitingCompletedMatch: CommissionerRecapResult["mostExcitingCompletedMatch"] = null
  let topExcitementScore = -1
  for (const match of finalizedToday) {
    const { home, away } = match.pickDistribution
    const t = home + away || 1
    const balance = Math.min(home, away) / t
    const excitementScore = balance * match.pointsAtStake
    if (excitementScore > topExcitementScore) {
      topExcitementScore = excitementScore
      const homePct = Math.round((home / t) * 100)
      const awayPct = 100 - homePct
      const winner =
        match.homeScore !== null && match.awayScore !== null
          ? match.homeScore > match.awayScore
            ? match.homeTeam
            : match.awayScore > match.homeScore
              ? match.awayTeam
              : "Draw"
          : null
      const correct = pool.entries.filter((e) =>
        e.picks.some((p) => p.matchId === match.matchId && p.isCorrect),
      ).length

      mostExcitingCompletedMatch = {
        matchDescription: `${match.homeTeam} vs ${match.awayTeam}`,
        pickSplit: `${homePct}% ${match.homeTeam} / ${awayPct}% ${match.awayTeam}`,
        winner,
        entriesCorrect: correct,
        entriesWrong: t - correct,
      }
    }
  }

  // Best upcoming match — reuse swing calculator
  let bestUpcomingMatch: CommissionerRecapResult["bestUpcomingMatch"] = null
  const swingSummary = computeMatchupSwingScores(pool)
  const best = swingSummary.topSwingMatch
  if (best) {
    bestUpcomingMatch = {
      matchDescription: best.matchDescription,
      round: best.round,
      chaosRating: best.chaosRating,
      pickSplit: `${best.homePickPct}% ${best.homeTeam} / ${best.awayPickPct}% ${best.awayTeam}`,
      suggestedPost: `🔥 ${best.homeTeam} vs ${best.awayTeam} — pool is split ${best.homePickPct}/${best.awayPickPct}. Who did you pick? This one decides ranks. #${pool.entries[0]?.displayName ?? "pool"} #AllFantasy`,
    }
  }

  const scores = pool.entries.map((e) => e.currentScore)
  const avgScore =
    scores.length > 0
      ? Math.round(scores.reduce((s, v) => s + v, 0) / scores.length)
      : 0
  const topScore = scores.length > 0 ? Math.max(...scores) : 0
  const bottomScore = scores.length > 0 ? Math.min(...scores) : 0

  return {
    biggestWinnerToday,
    biggestLoserToday,
    mostExcitingCompletedMatch,
    bestUpcomingMatch,
    poolHealthSummary: {
      activeEntries: pool.entries.length,
      averageScore: avgScore,
      topScore,
      bottomScore,
      pointsSeparatingFirstFromLast: topScore - bottomScore,
    },
  }
}
