/**
 * WarehouseQueryService — historical queries, simulation inputs, trend detection, AI analytics.
 * Single entry for dashboard analytics and drill-downs.
 */

import { prisma } from '@/lib/prisma'
import { normalizeSportForWarehouse } from './types'
import type { LeagueHistorySummary } from './LeagueHistoryAggregator'
import { getLeagueHistorySummary, getMatchupHistory, getStandingsHistory } from './LeagueHistoryAggregator'

export type { LeagueHistorySummary }

/**
 * Historical query: player fantasy points by season/week (for charts and trends).
 */
export async function getPlayerFantasyPointsByPeriod(
  playerId: string,
  sport: string,
  season: number,
  weeks?: number[]
) {
  const sportNorm = normalizeSportForWarehouse(sport)
  return prisma.playerGameFact.findMany({
    where: {
      playerId,
      sport: sportNorm,
      season,
      ...(weeks?.length ? { weekOrRound: { in: weeks } } : {}),
    },
    orderBy: { weekOrRound: 'asc' },
    select: { weekOrRound: true, fantasyPoints: true, gameId: true, createdAt: true },
  })
}

/**
 * Simulation input: team points distribution by period for a league.
 */
export async function getTeamPointsByPeriodForLeague(
  leagueId: string,
  season: number,
  weekOrPeriod?: number
) {
  const matchups = await prisma.matchupFact.findMany({
    where: { leagueId, season, ...(weekOrPeriod != null ? { weekOrPeriod } : {}) },
  })
  const teamPoints: Record<string, number[]> = {}
  for (const m of matchups) {
    if (!teamPoints[m.teamA]) teamPoints[m.teamA] = []
    teamPoints[m.teamA].push(m.scoreA)
    if (!teamPoints[m.teamB]) teamPoints[m.teamB] = []
    teamPoints[m.teamB].push(m.scoreB)
  }
  return teamPoints
}

/**
 * Cross-season analytics: standings summary per season for a league.
 */
export async function getStandingsBySeasonForLeague(
  leagueId: string,
  seasons: number[]
) {
  return prisma.seasonStandingFact.findMany({
    where: { leagueId, season: { in: seasons } },
    orderBy: [{ season: 'desc' }, { rank: 'asc' }],
  })
}

/**
 * Trend detection: recent transaction volume per league.
 */
export async function getTransactionVolumeByLeague(
  leagueIds: string[],
  since: Date
) {
  const groups = await prisma.transactionFact.groupBy({
    by: ['leagueId'],
    where: { leagueId: { in: leagueIds }, createdAt: { gte: since } },
    _count: { transactionId: true },
  })
  return Object.fromEntries(groups.map((g) => [g.leagueId, g._count.transactionId]))
}

/**
 * AI analytics: summary payload for a league (for prompt injection or narrative).
 */
export async function getLeagueWarehouseSummaryForAI(
  leagueId: string,
  season?: number
): Promise<{
  summary: LeagueHistorySummary
  recentMatchups: Awaited<ReturnType<typeof getMatchupHistory>>
  standings: Awaited<ReturnType<typeof getStandingsHistory>>
  draftPicksCount: number
  transactionCount: number
}> {
  const summary = await getLeagueHistorySummary(leagueId, { season })
  const seasonNum = season ?? summary.season
  const [recentMatchups, standings, draftPicksCount, transactionCount] = await Promise.all([
    seasonNum != null ? getMatchupHistory(leagueId, seasonNum) : Promise.resolve([]),
    seasonNum != null ? getStandingsHistory(leagueId, seasonNum) : Promise.resolve([]),
    prisma.draftFact.count({ where: { leagueId, ...(seasonNum != null ? { season: seasonNum } : {}) } }),
    prisma.transactionFact.count({ where: { leagueId } }),
  ])
  return {
    summary,
    recentMatchups,
    standings,
    draftPicksCount,
    transactionCount,
  }
}
