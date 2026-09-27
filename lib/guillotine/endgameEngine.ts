import { prisma } from '@/lib/prisma'

import { resolveGuillotineEndgame, resolveCumulativeFinalWinner, type GuillotineEndgameFormat } from './endgameRules'
export type { GuillotineEndgameFormat } from './endgameRules'

export async function transitionToFinalStage(seasonId: string, scoringPeriod: number): Promise<void> {
  await prisma.guillotineSeason.update({
    where: { id: seasonId },
    data: {
      isInFinalStage: true,
      finalStageStartPeriod: scoringPeriod,
      status: 'final_stage',
    },
  })
}

export interface EndgameState {
  format: GuillotineEndgameFormat
  threshold: number
  aliveRosterIds: string[]
  inFinalStage: boolean
  /** Non-null only when the season is fully resolved and a single winner exists. */
  champion: string | null
}

/**
 * Compute current endgame state for a guillotine season. When alive count
 * drops to the configured threshold, caller should invoke transitionToFinalStage.
 */
export async function determineEndgameState(seasonId: string): Promise<EndgameState | null> {
  const g = await prisma.guillotineSeason.findFirst({
    where: { id: seasonId },
    include: {
      redraftSeason: {
        include: { rosters: { where: { isEliminated: false }, select: { id: true, leagueId: true, ownerId: true } } },
      },
    },
  })
  if (!g?.redraftSeason) return null
  const alive = g.redraftSeason.rosters
  const leagueId = g.leagueId
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true, guillotineEndgame: true } })
  const { format, threshold, cumulativePeriods } = resolveGuillotineEndgame(league ?? {})
  const aliveIds = alive.map((r) => r.id)
  let champion = aliveIds.length === 1 ? aliveIds[0]! : null
  if (format !== 'last_team_standing') {
    champion = null
    if (g.finalStageStartPeriod != null) {
      const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, redraftRosterId: true } })
      const engineIds = aliveIds.map(id => rosters.find(row => row.redraftRosterId === id)?.id).filter((id): id is string => !!id)
      if (engineIds.length === aliveIds.length) {
        const scores = await prisma.guillotinePeriodScore.findMany({ where: { leagueId, season: g.season, weekOrPeriod: { gte: g.finalStageStartPeriod, lt: g.finalStageStartPeriod + cumulativePeriods } }, select: { rosterId: true, weekOrPeriod: true, periodPoints: true } })
        const winner = resolveCumulativeFinalWinner(engineIds, g.finalStageStartPeriod, g.currentScoringPeriod, cumulativePeriods, scores)
        champion = winner ? rosters.find(row => row.id === winner)?.redraftRosterId ?? null : null
      }
    }
  }
  return {
    format,
    threshold,
    aliveRosterIds: aliveIds,
    inFinalStage: aliveIds.length <= threshold,
    champion,
  }
}

export async function determineFinalChampion(seasonId: string): Promise<string | null> {
  const state = await determineEndgameState(seasonId)
  return state?.champion ?? null
}
