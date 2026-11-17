/**
 * AILegacyExplanationService — builds explainable narrative for "Why is this score high?" and AI explanation.
 */

import type { LegacyScoreRow } from './LegacyRankingService'
import { getLegacySportLabel } from './SportLegacyResolver'

interface LegacyExplanationContext {
  entityType: string
  entityId: string
  sport: string
  sportLabel: string
  leagueId: string | null
  overallLegacyScore: number
  breakdown: {
    championshipScore: number
    playoffScore: number
    consistencyScore: number
    rivalryScore: number
    awardsScore: number
    dynastyScore: number
  }
}

export function buildLegacyExplanationContext(record: LegacyScoreRow): LegacyExplanationContext {
  return {
    entityType: record.entityType,
    entityId: record.entityId,
    sport: record.sport,
    sportLabel: getLegacySportLabel(record.sport),
    leagueId: record.leagueId,
    overallLegacyScore: record.overallLegacyScore,
    breakdown: {
      championshipScore: record.championshipScore,
      playoffScore: record.playoffScore,
      consistencyScore: record.consistencyScore,
      rivalryScore: record.rivalryScore,
      awardsScore: record.awardsScore,
      dynastyScore: record.dynastyScore,
    },
  }
}

/**
 * Build a short "why is this score high?" explanation from the breakdown.
 */
export function buildLegacyExplanationNarrative(context: LegacyExplanationContext): string {
  const parts: string[] = [
    `Legacy score: ${context.overallLegacyScore.toFixed(1)} (${context.sportLabel})`,
    `Championships/Finals: ${context.breakdown.championshipScore.toFixed(0)}`,
    `Playoff success: ${context.breakdown.playoffScore.toFixed(0)}`,
    `Consistency: ${context.breakdown.consistencyScore.toFixed(0)}`,
    `Rivalry dominance: ${context.breakdown.rivalryScore.toFixed(0)}`,
    `Awards: ${context.breakdown.awardsScore.toFixed(0)}`,
    `Dynasty/staying power: ${context.breakdown.dynastyScore.toFixed(0)}`,
  ]
  const top = [
    { name: 'Championships/Finals', v: context.breakdown.championshipScore },
    { name: 'Playoffs', v: context.breakdown.playoffScore },
    { name: 'Consistency', v: context.breakdown.consistencyScore },
    { name: 'Rivalry', v: context.breakdown.rivalryScore },
    { name: 'Awards', v: context.breakdown.awardsScore },
    { name: 'Dynasty', v: context.breakdown.dynastyScore },
  ].sort((a, b) => b.v - a.v)
  const topDrivers = top.filter((x) => x.v >= 20).slice(0, 3).map((x) => x.name)
  return [
    parts.join('. '),
    topDrivers.length ? `Strongest drivers: ${topDrivers.join(', ')}.` : '',
  ].filter(Boolean).join(' ')
}
