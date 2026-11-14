/**
 * SimulationQueryService — query persisted matchup and season simulation results.
 * For dashboard cards, AI inputs, and replay.
 */

import { prisma } from '@/lib/prisma'

export async function getMatchupSimulation(
  leagueId: string,
  weekOrPeriod: number,
  teamAId?: string,
  teamBId?: string
) {
  const where: { leagueId: string; weekOrPeriod: number; teamAId?: string; teamBId?: string } = {
    leagueId,
    weekOrPeriod,
  }
  if (teamAId) where.teamAId = teamAId
  if (teamBId) where.teamBId = teamBId
  return prisma.matchupSimulationResult.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
  })
}

export async function getLatestMatchupSimulationsForLeague(
  leagueId: string,
  weekOrPeriod: number,
  limit = 20
) {
  return prisma.matchupSimulationResult.findMany({
    where: { leagueId, weekOrPeriod },
    orderBy: { createdAt: 'desc' },
    take: limit,
  })
}

export async function getSeasonSimulationForLeague(
  leagueId: string,
  season: number,
  weekOrPeriod: number
) {
  const rows = await prisma.seasonSimulationResult.findMany({
    where: { leagueId, season, weekOrPeriod },
    orderBy: { expectedRank: 'asc' },
  })
  return rows
}

export async function getLatestSeasonSimulation(
  leagueId: string,
  season: number
) {
  const latest = await prisma.seasonSimulationResult.findFirst({
    where: { leagueId, season },
    orderBy: { weekOrPeriod: 'desc' },
    distinct: ['weekOrPeriod'],
  })
  if (!latest) return []
  return prisma.seasonSimulationResult.findMany({
    where: { leagueId, season, weekOrPeriod: latest.weekOrPeriod },
    orderBy: { expectedRank: 'asc' },
  })
}

/**
 * AI-consumable summary: matchup win probs + season playoff odds for a league.
 */
export async function getSimulationSummaryForAI(
  leagueId: string,
  sport: string,
  season: number,
  weekOrPeriod: number
): Promise<{
  matchupResults: Awaited<ReturnType<typeof getLatestMatchupSimulationsForLeague>>
  seasonResults: Awaited<ReturnType<typeof getSeasonSimulationForLeague>>
}> {
  const [matchupResults, seasonResults] = await Promise.all([
    getLatestMatchupSimulationsForLeague(leagueId, weekOrPeriod, 10),
    getSeasonSimulationForLeague(leagueId, season, weekOrPeriod),
  ])
  return { matchupResults, seasonResults }
}
