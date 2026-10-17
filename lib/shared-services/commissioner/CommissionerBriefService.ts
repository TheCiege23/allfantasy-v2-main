/**
 * Commissioner Brief Service — Phase 10. Pure function only, deterministic.
 *
 * Genuinely new: this is a SINGLE-league, structured weekly brief — distinct
 * from lib/decision-os/dailyBrief.ts's composeDailyBrief(), which is a
 * real, live, already-wired CROSS-league brief (embedded in
 * CommissionerCommandCenterSection.tsx) covering different content
 * (multi-league monitoring summary, not one league's weekly facts). This
 * service selects and ranks facts only — narrative/tone is a separate
 * concern (see CommissionerNarrativeAdapter.ts). Per the brief: "Do not let
 * an LLM calculate standings, scores, probabilities, ranking order, or
 * transaction results" — every fact here comes from an already-computed
 * real source (Mission Control, Game Day Lineup Attention, Power Rankings).
 */

import type { CommissionerAttentionItem, CommissionerBrief, CommissionerBriefSection, CommissionerContext, CommissionerPowerRanking } from './types'

export function buildCommissionerBrief(
  context: CommissionerContext,
  ranking: CommissionerPowerRanking | null,
  attentionItems: CommissionerAttentionItem[]
): CommissionerBrief {
  const generatedAt = new Date().toISOString()
  const sections: CommissionerBriefSection[] = []

  const healthAvailable = context.missionControl.leagueHealth.available
  sections.push({
    key: 'league_overview',
    title: 'League Overview',
    facts: healthAvailable
      ? [
          `Overall status: ${context.missionControl.leagueHealth.result.engine.overallStatus}.`,
          `${context.missionControl.activity.tradeCount} trade(s), ${context.missionControl.activity.waiverClaimCount} waiver claim(s) this period.`,
          `${context.missionControl.managerCounts.activeManagers} active manager(s), ${context.missionControl.managerCounts.inactiveManagers} inactive.`,
        ]
      : ['League health data is unavailable this period.'],
    evidence: healthAvailable ? context.missionControl.leagueHealth.result.engine.biggestStrengths : [],
  })

  if (ranking && ranking.teams.length > 0) {
    const movers = [...ranking.teams].filter((t) => t.rankDelta != null).sort((a, b) => Math.abs(b.rankDelta ?? 0) - Math.abs(a.rankDelta ?? 0))
    sections.push({
      key: 'biggest_movers',
      title: 'Biggest Movers',
      facts: movers.slice(0, 3).map((t) => `${t.displayName ?? t.username ?? `Roster ${t.rosterId}`}: rank ${t.rank} (${t.rankDelta! > 0 ? '+' : ''}${t.rankDelta} from last week).`),
      evidence: [ranking.explanation],
    })
  }

  const lineupConcerns = attentionItems.filter((i) => i.reasonCode === 'lineup_attention_carryover')
  sections.push({
    key: 'lineup_concerns',
    title: 'Lineup Concerns',
    facts: lineupConcerns.length > 0 ? lineupConcerns.map((i) => i.message) : ['No lineup concerns detected for the assembled viewer roster.'],
    evidence: lineupConcerns.flatMap((i) => i.evidence),
  })

  sections.push({
    key: 'waiver_activity',
    title: 'Waiver Activity',
    facts: [`${context.missionControl.activity.waiverClaimCount} waiver claim(s) recorded this period.`],
    evidence: [],
  })

  sections.push({
    key: 'trade_activity',
    title: 'Trade Activity',
    facts: [`${context.missionControl.activity.tradeCount} trade(s) recorded this period.`],
    evidence: [],
  })

  sections.push({
    key: 'commissioner_actions',
    title: 'Commissioner Actions',
    facts: context.missionControl.recommendedActions.length > 0 ? context.missionControl.recommendedActions.map((a) => `[${a.priority}] ${a.message}`) : ['No commissioner actions currently recommended.'],
    evidence: [],
  })

  const dataQualityWarnings: string[] = []
  if (!healthAvailable) dataQualityWarnings.push('League health could not be resolved.')
  if (!context.leagueAnalytics.available) dataQualityWarnings.push('League analytics could not be resolved.')
  if (context.formatAwareness.powerRankingSupport === 'specialty_adapter_required') {
    dataQualityWarnings.push(context.formatAwareness.reason ?? 'This league format requires a specialty adapter not yet built.')
  }
  sections.push({
    key: 'data_quality_warnings',
    title: 'Data Quality',
    facts: dataQualityWarnings.length > 0 ? dataQualityWarnings : ['No data quality issues detected.'],
    evidence: [],
  })

  const isHealthy = healthAvailable && (context.missionControl.leagueHealth.result.engine.overallStatus === 'excellent' || context.missionControl.leagueHealth.result.engine.overallStatus === 'healthy')
  const confidence = healthAvailable ? context.missionControl.leagueHealth.result.engine.confidencePct : 0

  return {
    leagueId: context.leagueId,
    week: ranking?.week ?? 0,
    generatedAt,
    sections,
    isHealthy,
    confidence,
  }
}
