/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 7,
 * rankings domain.
 *
 * Reuses `lib/league-power-rankings/PowerRankingEngine.ts::computePowerRankings`
 * via `lib/shared-services/commissioner/CommissionerRankingService.ts::buildCommissionerRanking`
 * (already called in `commissionerOsContext.ts`, result on `context.ranking`).
 * Deliberately does NOT begin the global provider-agnostic Rankings
 * migration — this generator only summarizes the existing league-specific
 * engine's output for the commissioner. Every ranking discloses its basis,
 * generation date, freshness, and unavailable components — never presented
 * as a bare number.
 */
import type { CommissionerOsContext } from '../../commissionerOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../../userOsRecommendationHelpers'
import type { LeagueRecommendation } from '../../types'

export function generateRankingsRecommendations(
  context: CommissionerOsContext,
  generatedAt: string
): LeagueRecommendation[] {
  const priority = 'low' as const
  if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) return []

  if (context.shared.formatAwareness.powerRankingSupport === 'specialty_adapter_required') {
    // Honestly unsupported for this league's format — never present a stub ranking as real.
    return []
  }

  if (!context.ranking || context.ranking.teams.length === 0) return []

  const movers = [...context.ranking.teams]
    .filter((t) => t.rankDelta != null && t.rankDelta !== 0)
    .sort((a, b) => Math.abs(b.rankDelta ?? 0) - Math.abs(a.rankDelta ?? 0))
    .slice(0, 3)

  return [
    buildRecommendation({
      leagueId: context.canonicalLeagueId,
      domain: 'commissioner',
      type: 'power_rankings_summary',
      key: `week-${context.ranking.week}`,
      priority,
      title: `Week ${context.ranking.week} power rankings ready`,
      summary: `Deterministic power rankings for week ${context.ranking.week} — ${context.ranking.explanation}`,
      rationale: movers.length
        ? movers.map((t) => `${t.displayName ?? t.username ?? `Roster ${t.rosterId}`}: rank ${t.rank} (${(t.rankDelta ?? 0) > 0 ? '+' : ''}${t.rankDelta}).`)
        : ['No significant rank movement this week.'],
      evidence: [
        { label: 'Ranking basis', detail: context.ranking.explanation, source: 'computePowerRankings' },
        { label: 'Generated', detail: context.ranking.sourceAttribution.providerTimestamp ?? generatedAt, source: 'PowerRankingEngine' },
      ],
      confidence: context.ranking.sourceAttribution.confidence / 100,
      sourceFreshness: context.syncFreshness,
      executionCapability: 'copy_action',
      commissionerScope: 'league_wide',
      publicationAudience: 'league_wide',
      publicationChannel: 'league_chat',
      governanceSeverity: 'none',
      generatedAt,
    }),
  ]
}
