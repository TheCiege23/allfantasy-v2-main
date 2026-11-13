import { prisma } from '@/lib/prisma'

type SurvivalStandings = {
  active: {
    rosterId: string
    teamName: string | null
    liveScore: number
    survivalRank: number
    marginAboveChopLine: number
    isInDangerZone: boolean
    faabBalance: number | null
  }[]
  dangerZone: string[]
  chopLine: { currentLastPlace: { rosterId: string; score: number } | null; projectedChopScore: number | null }
  eliminated: { rosterId: string; teamName: string | null; periodEliminated: number; finalScore: number }[]
  finalStage: null | { mode: string; periodsRemaining: number | null; standings: unknown[] }
}

export function computeChopLine(
  scores: { rosterId: string; score: number }[],
  elimCount: number,
): number {
  if (scores.length === 0 || elimCount <= 0) return Number.NEGATIVE_INFINITY
  const sorted = [...scores].sort((a, b) => a.score - b.score)
  const idx = Math.min(elimCount, sorted.length) - 1
  return sorted[idx]?.score ?? Number.NEGATIVE_INFINITY
}

export async function getSurvivalStandings(
  seasonId: string,
  scoringPeriod: number,
): Promise<SurvivalStandings> {
  const g = await prisma.guillotineSeason.findFirst({
    where: { id: seasonId },
    include: {
      eliminations: { orderBy: { scoringPeriod: 'desc' } },
      redraftSeason: {
        include: { rosters: { include: { players: true } } },
      },
    },
  })
  if (!g?.redraftSeason) {
    return {
      active: [],
      dangerZone: [],
      chopLine: { currentLastPlace: null, projectedChopScore: null },
      eliminated: [],
      finalStage: null,
    }
  }

  const logs = await prisma.guillotineSurvivalLog.findMany({
    where: { seasonId, scoringPeriod },
  })
  const logByRoster = new Map(logs.map((l) => [l.rosterId, l]))

  const activeRosters = g.redraftSeason.rosters.filter((r) => !r.isEliminated)
  const active = activeRosters
    .map((r) => {
      const log = logByRoster.get(r.id)
      return {
        rosterId: r.id,
        teamName: r.teamName,
        liveScore: log?.totalScore ?? 0,
        survivalRank: log?.rankAmongActive ?? 0,
        marginAboveChopLine: log?.marginAboveChopLine ?? 0,
        isInDangerZone: log?.wasInDangerZone ?? false,
        faabBalance: r.faabBalance,
      }
    })
    .sort((a, b) => b.liveScore - a.liveScore)
    .map((row, i) => ({
      ...row,
      survivalRank: row.survivalRank || i + 1,
    }))

  const eliminated = await prisma.guillotineElimination.findMany({
    where: { seasonId },
    orderBy: { scoringPeriod: 'desc' },
  })

  return {
    active,
    dangerZone: active.filter((a) => a.isInDangerZone).map((a) => a.rosterId),
    chopLine: {
      currentLastPlace:
        active.length > 0
          ? { rosterId: active[active.length - 1]!.rosterId, score: active[active.length - 1]!.liveScore }
          : null,
      projectedChopScore: active.length > 0 ? active[active.length - 1]!.liveScore : null,
    },
    eliminated: eliminated.map((e) => ({
      rosterId: e.eliminatedRosterId,
      teamName: e.eliminatedTeamName,
      periodEliminated: e.scoringPeriod,
      finalScore: e.finalScore,
    })),
    finalStage: g.isInFinalStage
      ? { mode: 'final', periodsRemaining: null, standings: active }
      : null,
  }
}
