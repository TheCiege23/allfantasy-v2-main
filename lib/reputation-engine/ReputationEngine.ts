/**
 * ReputationEngine — orchestrates evidence aggregation, score calculation, tier resolution, and persistence.
 */

import { prisma } from '@/lib/prisma'
import { normalizeSportForReputation, isSupportedReputationSport } from './SportReputationResolver'
import { resolveReputationTier } from './ReputationTierResolver'
import {
  aggregateReputationEvidence,
  refreshDerivedEvidenceForManager,
  seedDefaultEvidenceIfEmpty,
} from './ReputationEvidenceAggregator'
import { computeDimensionScores } from './ReputationScoreCalculator'
import { getReputationRuntimeConfig } from './ReputationConfigService'
import type { ReputationEngineInput, ReputationEngineResult, ReputationTier } from './types'

async function runReputationEngine(
  input: ReputationEngineInput
): Promise<ReputationEngineResult | null> {
  const sport = normalizeSportForReputation(input.sport)
  if (!isSupportedReputationSport(sport)) return null
  const season = (() => {
    const raw = input.season
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
    return new Date().getUTCFullYear()
  })()

  await refreshDerivedEvidenceForManager({
    leagueId: input.leagueId,
    managerId: input.managerId,
    sport,
    season,
  })
  await seedDefaultEvidenceIfEmpty(input.leagueId, input.managerId, sport, { season })
  const aggregated = await aggregateReputationEvidence(input.leagueId, input.managerId, sport, { season })
  const config = await getReputationRuntimeConfig({
    leagueId: input.leagueId,
    sport,
    season,
  })
  const dimensionScores = computeDimensionScores(aggregated, config.scoreWeights)
  const tier = resolveReputationTier(dimensionScores.overallScore, config.tierThresholds)

  const data = {
    leagueId: input.leagueId,
    managerId: input.managerId,
    sport,
    season,
    overallScore: dimensionScores.overallScore,
    reliabilityScore: dimensionScores.reliabilityScore,
    activityScore: dimensionScores.activityScore,
    tradeFairnessScore: dimensionScores.tradeFairnessScore,
    sportsmanshipScore: dimensionScores.sportsmanshipScore,
    commissionerTrustScore: dimensionScores.commissionerTrustScore,
    toxicityRiskScore: dimensionScores.toxicityRiskScore,
    participationQualityScore: dimensionScores.participationQualityScore,
    responsivenessScore: dimensionScores.responsivenessScore,
    tier,
  }

  if (input.replace !== false) {
    await prisma.managerReputationRecord.upsert({
      where: {
        manager_reputation_records_unique_scope: {
          leagueId: input.leagueId,
          managerId: input.managerId,
          sport,
          season,
        },
      },
      create: data,
      update: data,
    })
  }

  const r = await prisma.managerReputationRecord.findUnique({
    where: {
      manager_reputation_records_unique_scope: {
        leagueId: input.leagueId,
        managerId: input.managerId,
        sport,
        season,
      },
    },
  })
  if (!r) return null

  return {
    reputationId: r.id,
    managerId: r.managerId,
    leagueId: r.leagueId,
    sport: r.sport,
    season: r.season,
    overallScore: r.overallScore,
    tier: r.tier as ReputationTier,
    dimensionScores: {
      overallScore: r.overallScore,
      reliabilityScore: r.reliabilityScore,
      activityScore: r.activityScore,
      tradeFairnessScore: r.tradeFairnessScore,
      sportsmanshipScore: r.sportsmanshipScore,
      commissionerTrustScore: r.commissionerTrustScore,
      toxicityRiskScore: r.toxicityRiskScore,
      participationQualityScore: r.participationQualityScore,
      responsivenessScore: r.responsivenessScore,
    },
  }
}

/**
 * Run reputation engine for all teams in a league.
 */
export async function runReputationEngineForLeague(
  leagueId: string,
  options?: { sport?: string; season?: number | null; replace?: boolean }
): Promise<{ processed: number; created: number; updated: number; results: Array<{ managerId: string; tier: string; overallScore: number }> }> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    include: { teams: true },
  })
  if (!league) return { processed: 0, created: 0, updated: 0, results: [] }
  const sport = normalizeSportForReputation(options?.sport ?? (league.sport as string) ?? 'NFL')
  const season = options?.season ?? league.season ?? new Date().getUTCFullYear()
  const replace = options?.replace !== false

  const results: Array<{ managerId: string; tier: string; overallScore: number }> = []
  let created = 0
  let updated = 0
  for (const team of league.teams) {
    const managerId = team.externalId || team.id
    const existing = await prisma.managerReputationRecord.findUnique({
      where: {
        manager_reputation_records_unique_scope: {
          leagueId,
          managerId,
          sport,
          season,
        },
      },
    })
    const out = await runReputationEngine({ leagueId, managerId, sport, season, replace })
    if (out) {
      results.push({ managerId: out.managerId, tier: out.tier, overallScore: out.overallScore })
      if (existing) updated++
      else created++
    }
  }
  return { processed: results.length, created, updated, results }
}
