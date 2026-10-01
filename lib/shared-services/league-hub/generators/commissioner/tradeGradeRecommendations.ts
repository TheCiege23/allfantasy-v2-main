/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 11,
 * trade-grade domain.
 *
 * Same reasoning as the User OS phase's trade domain: does NOT hand-construct
 * `TradeDecisionContextV1` to call `computeDeterministicVerdict` directly
 * (a fully-assembled, Zod-validated context object — unsafe to build
 * shallowly within this phase's budget). Instead surfaces the real trade
 * COUNT already computed by Mission Control
 * (`context.shared.missionControl.activity.tradeCount`) as a neutral,
 * commissioner-facing recap pointer, directing to the real Trade Decision
 * OS surfaces for actual per-trade grading. Never recommends commissioner
 * intervention for a merely-uneven trade — `governanceSeverity` stays
 * `'none'` unconditionally here, since this generator has no real signal
 * for rule violations, fraud, or invalid ownership (that's the integrity
 * domain's job, with its own, separate, cautious-language generator).
 */
import type { CommissionerOsContext } from '../../commissionerOsContext'
import { buildRecommendation, isFreshnessSafeForPriority } from '../../userOsRecommendationHelpers'
import type { LeagueRecommendation } from '../../types'

export function generateTradeGradeRecommendations(
  context: CommissionerOsContext,
  generatedAt: string
): LeagueRecommendation[] {
  const priority = 'low' as const
  if (!isFreshnessSafeForPriority(context.syncFreshness, priority)) return []

  const tradeCount = context.shared.missionControl.activity.tradeCount
  if (tradeCount === 0) return []

  return [
    buildRecommendation({
      leagueId: context.canonicalLeagueId,
      domain: 'commissioner',
      type: 'trade_activity_recap',
      key: 'trade-recap',
      priority,
      title: `${tradeCount} trade(s) this period`,
      summary: `Your league recorded ${tradeCount} real trade(s) this period. Review deterministic fairness/impact grades for any of them in the Trade Analyzer.`,
      rationale: [`Real trade count from Mission Control: ${tradeCount}.`],
      evidence: [{ label: 'Trade count', detail: String(tradeCount), source: 'resolveMissionControlSnapshot' }],
      sourceFreshness: context.syncFreshness,
      executionCapability: 'recommendation_only',
      action: { label: 'Open Trade Analyzer', href: '/dynasty-trade-analyzer' },
      commissionerScope: 'league_wide',
      publicationAudience: 'commissioner_only',
      // Never a governance flag here — an uneven trade alone is never grounds for intervention.
      governanceSeverity: 'none',
      humanReviewRequired: false,
      generatedAt,
    }),
  ]
}
