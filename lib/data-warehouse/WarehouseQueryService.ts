/**
 * WarehouseQueryService — historical queries, simulation inputs, trend detection, AI analytics.
 * Single entry for dashboard analytics and drill-downs.
 */

import { prisma } from '@/lib/prisma'
import type { LeagueHistorySummary } from './LeagueHistoryAggregator'
import { getLeagueHistorySummary, getMatchupHistory, getStandingsHistory } from './LeagueHistoryAggregator'

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
