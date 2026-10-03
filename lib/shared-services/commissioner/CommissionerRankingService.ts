/**
 * Commissioner Ranking Service — Phase 10.
 *
 * Wraps lib/league-power-rankings/PowerRankingEngine.ts's computePowerRankings()
 * — the one real, deterministic, format-agnostic (redraft/dynasty) ranking
 * engine confirmed live during the audit, with rank movement already built
 * in (PowerRankingTeam.rankDelta/prevRank). Deliberately does NOT call the
 * confirmed stub engines found during the audit (lib/bestball/ai/powerRankings.ts,
 * lib/keeper/ai/powerRankingsKeeper.ts, lib/redraft/ai/powerRankings.ts all
 * return placeholder/empty output) — for those formats this service honestly
 * returns 'specialty_adapter_required' rather than presenting stub output as
 * a real ranking.
 */

import { computePowerRankings } from '@/lib/league-power-rankings/PowerRankingEngine'
import type { CommissionerContext, CommissionerPowerRanking } from './types'

export async function buildCommissionerRanking(context: CommissionerContext, week?: number): Promise<CommissionerPowerRanking | null> {
  const fetchedAt = new Date().toISOString()

  if (context.formatAwareness.powerRankingSupport === 'specialty_adapter_required') {
    return null
  }

  const output = await computePowerRankings(context.leagueId, week)
  if (!output) return null

  return {
    leagueId: context.leagueId,
    week: output.week,
    mode: 'general_v2',
    formulaVersion: JSON.stringify(output.formula),
    support: 'supported',
    teams: output.teams,
    sourceAttribution: {
      source: 'league-power-rankings-engine',
      fetchedAt,
      providerTimestamp: new Date(output.computedAt).toISOString(),
      freshness: 'fresh',
      confidence: 80,
      missingDataReason: null,
    },
    explanation: `Weighted ${(output.formula.recordWeight * 100).toFixed(0)}% record / ${(output.formula.recentPerformanceWeight * 100).toFixed(0)}% recent performance / ${(output.formula.rosterStrengthWeight * 100).toFixed(0)}% roster strength / ${(output.formula.projectionStrengthWeight * 100).toFixed(0)}% projection strength.`,
  }
}
