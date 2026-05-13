import "server-only"
import { prisma } from "@/lib/prisma"
import type { PlayoffRoundKey } from "./types"

// Points awarded per round for a correct series winner pick
const ROUND_POINTS: Record<PlayoffRoundKey, number> = {
  round_1: 10,
  conference_semifinals: 20,
  conference_finals: 40,
  finals: 80,
}

function getRoundPoints(round: string): number {
  return ROUND_POINTS[round as PlayoffRoundKey] ?? 10
}

/**
 * Score a single entry against all resolved series in the challenge.
 * Updates PlayoffBracketPick.pointsAwarded + isCorrect, then
 * aggregates totalScore + correctPicks on the entry row.
 */
export async function scorePlayoffEntry(input: {
  challengeId: string
  entryId: string
}): Promise<{ totalScore: number; correctPicks: number }> {
  const { challengeId, entryId } = input

  // Load picks for this entry alongside their series' resolved winner
  const picks = await (prisma as any).playoffBracketPick.findMany({
    where: { entryId, challengeId },
    include: {
      series: {
        select: {
          round: true,
          winnerTeamName: true,
          status: true,
        },
      },
    },
  })

  let totalScore = 0
  let correctPicks = 0

  const updates: Array<Promise<unknown>> = []

  for (const pick of picks as Array<{
    id: string
    pickTeamName: string
    series: { round: string; winnerTeamName: string | null; status: string }
  }>) {
    const { series } = pick
    if (series.status !== "final" || !series.winnerTeamName) continue

    const isCorrect = pick.pickTeamName === series.winnerTeamName
    const pointsAwarded = isCorrect ? getRoundPoints(series.round) : 0

    totalScore += pointsAwarded
    if (isCorrect) correctPicks += 1

    updates.push(
      (prisma as any).playoffBracketPick.update({
        where: { id: pick.id },
        data: { isCorrect, pointsAwarded },
      })
    )
  }

  await Promise.all(updates)

  await (prisma as any).playoffBracketEntry.update({
    where: { id: entryId },
    data: { totalScore, correctPicks },
  })

  return { totalScore, correctPicks }
}

/**
 * Score every entry in a challenge and recompute rank.
 * Returns a sorted leaderboard snapshot.
 */
export async function scoreAllEntriesForChallenge(input: {
  challengeId: string
}): Promise<Array<{ entryId: string; rank: number; totalScore: number; correctPicks: number }>> {
  const { challengeId } = input

  const entries = await (prisma as any).playoffBracketEntry.findMany({
    where: { challengeId },
    select: { id: true },
  })

  const results = await Promise.all(
    (entries as Array<{ id: string }>).map(async (entry) => {
      const scores = await scorePlayoffEntry({ challengeId, entryId: entry.id })
      return { entryId: entry.id, ...scores }
    })
  )

  // Sort descending by totalScore, then by correctPicks as tiebreaker
  results.sort((a, b) => b.totalScore - a.totalScore || b.correctPicks - a.correctPicks)

  // Assign ranks (ties share same rank)
  const ranked: Array<{ entryId: string; rank: number; totalScore: number; correctPicks: number }> = []
  let currentRank = 1
  for (let i = 0; i < results.length; i++) {
    if (i > 0 && results[i].totalScore === results[i - 1].totalScore) {
      ranked.push({ ...results[i], rank: ranked[i - 1].rank })
    } else {
      ranked.push({ ...results[i], rank: currentRank })
    }
    currentRank++
  }

  // Persist ranks
  await Promise.all(
    ranked.map((r) =>
      (prisma as any).playoffBracketEntry.update({
        where: { id: r.entryId },
        data: { rank: r.rank },
      })
    )
  )

  return ranked
}
