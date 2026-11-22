/**
 * Decision OS — Phase 7.0 IPM Hosted API Presentation.
 *
 * Transforms internal IPM result objects to Hosted API response shapes.
 * These are the wire-safe shapes returned by v1 Intelligence API routes.
 * Pure functions — no IO, no side effects.
 */

import type { ManagerApiPresentation, LeagueApiPresentation, PlatformApiPresentation, ManagerPresentationResult, LeaguePresentationResult, PlatformPresentationResult, ColorToken } from './types'
import { PRESENTATION_VERSION, scoreToSeverity, SEVERITY_DEFINITIONS, archetypeToColorToken } from './tokens'

// ── Manager API presentation ──────────────────────────────────────────────────

export function buildManagerApiPresentation(
  result: Pick<
    ManagerPresentationResult,
    | 'managerId'
    | 'managerCard'
    | 'dnaCard'
    | 'badges'
    | 'recommendations'
    | 'metrics'
    | 'completeness'
  >,
): ManagerApiPresentation {
  const mc = result.managerCard
  const dna = result.dnaCard
  const engScore = mc?.overallEngagementScore ?? 0
  const sevToken = scoreToSeverity(engScore)

  return {
    entityId: result.managerId,
    entityType: 'manager',
    healthScore: engScore,
    healthSeverity: SEVERITY_DEFINITIONS[sevToken],
    primaryIdentity: dna?.primaryIdentity ?? 'unknown',
    identityLabel: dna?.identityLabel ?? 'Unclassified',
    retentionRisk: mc?.retentionRisk ?? 'medium',
    engagementScore: engScore,
    badges: result.badges,
    topRecommendations: (result.recommendations?.items ?? []).slice(0, 3),
    metrics: result.metrics,
    completeness: result.completeness,
    version: PRESENTATION_VERSION,
  }
}

// ── League API presentation ───────────────────────────────────────────────────

export function buildLeagueApiPresentation(
  result: Pick<
    LeaguePresentationResult,
    | 'leagueId'
    | 'healthCard'
    | 'archetypeCard'
    | 'benchmarkCard'
    | 'retentionCard'
    | 'badges'
    | 'recommendations'
    | 'metrics'
    | 'completeness'
  >,
): LeagueApiPresentation {
  const hc = result.healthCard
  const ac = result.archetypeCard
  const bm = result.benchmarkCard
  const rc = result.retentionCard
  const healthScore = hc?.healthScore ?? 0
  const sevToken = scoreToSeverity(healthScore)
  const archetype = ac?.archetypeLabel ?? 'unknown'
  const archetypeLabel = ac?.archetypeDisplayLabel ?? 'Unclassified'

  const benchmarkSummary = bm
    ? {
        engagementPercentile: bm.engagement.percentile,
        retentionSafetyPercentile: bm.retentionSafety.percentile,
        archetypeCohortRank: null as number | null,
      }
    : null

  return {
    entityId: result.leagueId,
    entityType: 'league',
    healthScore,
    healthSeverity: SEVERITY_DEFINITIONS[sevToken],
    archetype,
    archetypeLabel,
    retentionRisk: rc?.retentionRisk ?? 'medium',
    engagementTier: hc?.healthTier ?? 'moderate',
    badges: result.badges,
    topRecommendations: (result.recommendations?.items ?? []).slice(0, 3),
    metrics: result.metrics,
    benchmarkSummary,
    completeness: result.completeness,
    version: PRESENTATION_VERSION,
  }
}

// ── Platform API presentation ─────────────────────────────────────────────────

export function buildPlatformApiPresentation(
  result: Pick<
    PlatformPresentationResult,
    | 'platformId'
    | 'fullDashboard'
    | 'badges'
    | 'recommendations'
    | 'metrics'
    | 'completeness'
  >,
  input: {
    platformEngagementScore: number
    platformEngagementTier: string
    leagueCount: number
    managerCount: number
    archetypeDistribution?: Record<string, number>
    interventions?: Array<{ scope: 'league' | 'manager'; priority: string; message: string }>
  },
): PlatformApiPresentation {
  const score = input.platformEngagementScore
  const sevToken = scoreToSeverity(score)
  const totalLeagues = input.leagueCount
  const archetypeDist = input.archetypeDistribution ?? {}

  const archetypeDistribution = Object.entries(archetypeDist)
    .map(([label, count]) => ({
      label,
      count,
      fraction: totalLeagues > 0 ? count / totalLeagues : 0,
      colorToken: archetypeToColorToken(label) as ColorToken,
    }))
    .sort((a, b) => b.count - a.count)

  const interventions = (input.interventions ?? []).slice(0, 20).map((iv) => ({
    scope: iv.scope,
    priority: iv.priority,
    message: iv.message,
    severity: SEVERITY_DEFINITIONS[
      iv.priority === 'critical' ? 'critical'
      : iv.priority === 'high' ? 'elevated'
      : iv.priority === 'medium' ? 'standard'
      : 'advisory'
    ],
  }))

  return {
    entityId: result.platformId,
    entityType: 'platform',
    platformHealthScore: score,
    platformHealthSeverity: SEVERITY_DEFINITIONS[sevToken],
    platformEngagementTier: input.platformEngagementTier,
    leagueCount: input.leagueCount,
    managerCount: input.managerCount,
    badges: result.badges,
    topRecommendations: (result.recommendations?.items ?? []).slice(0, 5),
    metrics: result.metrics,
    archetypeDistribution,
    interventions,
    completeness: result.completeness,
    version: PRESENTATION_VERSION,
  }
}

// ── Company API presentation ──────────────────────────────────────────────────

