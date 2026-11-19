/**
 * UnifiedPrestigeQueryService — one-stop queries for manager/team prestige (reputation + legacy + HoF).
 */

import { getReputationByLeagueAndManager } from '@/lib/reputation-engine/ManagerTrustQueryService'
import { getLegacyScoreByEntity, queryLegacyLeaderboard } from '@/lib/legacy-score-engine/LegacyRankingService'
import { queryHallOfFameEntries } from '@/lib/hall-of-fame-engine/HallOfFameQueryService'
import { DEFAULT_SPORT } from '@/lib/sport-scope'
import type { UnifiedManagerSummary, UnifiedTeamSummary, UnifiedPrestigeQueryInput } from './types'
import { normalizeSportForPrestige } from './SportPrestigeResolver'

export async function getUnifiedManagerSummary(
  leagueId: string,
  managerId: string,
  sport: string
): Promise<UnifiedManagerSummary> {
  const sportNorm = normalizeSportForPrestige(sport)

  const [reputation, legacy, hofEntries] = await Promise.all([
    getReputationByLeagueAndManager(leagueId, managerId),
    getLegacyScoreByEntity('MANAGER', managerId, sportNorm, leagueId),
    queryHallOfFameEntries({
      leagueId,
      sport: sportNorm,
      entityType: 'MANAGER',
      entityId: managerId,
      limit: 10,
      offset: 0,
    }),
  ])

  const topEntry = hofEntries.entries[0]

  return {
    managerId,
    leagueId,
    sport: sportNorm,
    reputation: reputation
      ? {
          overallScore: reputation.overallScore,
          tier: reputation.tier,
          commissionerTrustScore: reputation.commissionerTrustScore,
          reliabilityScore: reputation.reliabilityScore,
          activityScore: reputation.activityScore,
          tradeFairnessScore: reputation.tradeFairnessScore,
          sportsmanshipScore: reputation.sportsmanshipScore,
          toxicityRiskScore: reputation.toxicityRiskScore,
        }
      : null,
    legacy: legacy
      ? {
          overallLegacyScore: legacy.overallLegacyScore,
          championshipScore: legacy.championshipScore,
          playoffScore: legacy.playoffScore,
          consistencyScore: legacy.consistencyScore,
          rivalryScore: legacy.rivalryScore,
          dynastyScore: legacy.dynastyScore,
        }
      : null,
    hallOfFameEntryCount: hofEntries.total,
    topHallOfFameTitle: topEntry?.title ?? null,
  }
}

export async function getUnifiedTeamSummary(
  leagueId: string,
  entityId: string,
  entityType: 'TEAM' | 'FRANCHISE',
  sport: string
): Promise<UnifiedTeamSummary> {
  const sportNorm = normalizeSportForPrestige(sport)

  const [legacy, hofEntries] = await Promise.all([
    getLegacyScoreByEntity(entityType, entityId, sportNorm, leagueId),
    queryHallOfFameEntries({
      leagueId,
      sport: sportNorm,
      entityType: 'TEAM',
      entityId,
      limit: 10,
      offset: 0,
    }),
  ])

  const topEntry = hofEntries.entries[0]

  return {
    entityId,
    entityType,
    leagueId,
    sport: sportNorm,
    legacy: legacy
      ? {
          overallLegacyScore: legacy.overallLegacyScore,
          championshipScore: legacy.championshipScore,
          playoffScore: legacy.playoffScore,
          consistencyScore: legacy.consistencyScore,
          rivalryScore: legacy.rivalryScore,
          dynastyScore: legacy.dynastyScore,
        }
      : null,
    hallOfFameEntryCount: hofEntries.total,
    topHallOfFameTitle: topEntry?.title ?? null,
  }
}

/**
 * Batch-fetch unified manager summaries for a league (optionally filtered by managerIds or sport).
 */
export async function getUnifiedManagerSummaries(
  input: UnifiedPrestigeQueryInput
): Promise<UnifiedManagerSummary[]> {
  const { leagueId, sport, managerIds, entityIds } = input
  const sportNorm = sport ? normalizeSportForPrestige(sport) : undefined

  let targetManagerIds = managerIds?.length ? managerIds : entityIds?.length ? entityIds : undefined
  if (!targetManagerIds?.length) {
    const [repList, legacyList] = await Promise.all([
      (await import('@/lib/reputation-engine/ManagerTrustQueryService')).listReputationsByLeague(
        leagueId,
        { sport: sportNorm ?? undefined, limit: 200 }
      ),
      queryLegacyLeaderboard({
        leagueId,
        sport: sportNorm ?? undefined,
        entityType: 'MANAGER',
        limit: 200,
        offset: 0,
      }),
    ])
    const fromRep = new Set(repList.map((r) => r.managerId))
    const fromLegacy = new Set(legacyList.records.map((r) => r.entityId))
    targetManagerIds = Array.from(new Set([...fromRep, ...fromLegacy]))
  }

  if (targetManagerIds.length === 0) return []

  const summaries = await Promise.all(
    targetManagerIds.slice(0, 100).map((managerId) =>
      getUnifiedManagerSummary(leagueId, managerId, sportNorm ?? DEFAULT_SPORT)
    )
  )
  return summaries
}

