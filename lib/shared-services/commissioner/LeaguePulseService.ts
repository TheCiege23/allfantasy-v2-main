/**
 * League Pulse Service — Phase 10. Pure function only.
 *
 * Builds an explainable, multi-dimension League Pulse from a real
 * CommissionerContext — every dimension is derived from a field this
 * codebase's real engines already compute (monitorLeagueHealth()'s
 * engagement/fairness/sustainability sub-scores, Mission Control's activity
 * counts and recommended actions, and — when available — the Phase 9 Game
 * Day Lineup Attention items). No new scoring formula is invented; this
 * module only explains and organizes existing scores into named dimensions,
 * per the brief's "do not reduce league health into one unexplained number."
 */

import type { CommissionerContext, LeaguePulse, PulseDimension, SourceAttribution } from './types'

function unavailableDimension(dimension: PulseDimension['dimension'], reason: string): PulseDimension {
  return {
    dimension,
    state: 'unavailable',
    explanation: reason,
    evidence: [],
    confidence: 0,
    freshness: 'unknown',
    sourceAttribution: { source: 'league-pulse-service', fetchedAt: new Date().toISOString(), providerTimestamp: null, freshness: 'unknown', confidence: 0, missingDataReason: reason },
    risk: 'low',
    uncertainty: [reason],
  }
}

function stateFromScore(score: number): PulseDimension['state'] {
  if (score >= 65) return 'good'
  if (score >= 50) return 'watch'
  return 'attention_required'
}

export function buildLeaguePulse(context: CommissionerContext): LeaguePulse {
  const generatedAt = new Date().toISOString()
  const dimensions: PulseDimension[] = []

  if (!context.missionControl.leagueHealth.available) {
    dimensions.push(unavailableDimension('competition', 'League health could not be resolved for this league.'))
    dimensions.push(unavailableDimension('participation', 'League health could not be resolved for this league.'))
    dimensions.push(unavailableDimension('activity', 'League health could not be resolved for this league.'))
  } else {
    const { engine, decisionOs } = context.missionControl.leagueHealth.result
    const { trend } = decisionOs
    const attribution: SourceAttribution = {
      source: 'monitorLeagueHealth (via resolveDecisionOsLeagueHealth)',
      fetchedAt: generatedAt,
      providerTimestamp: engine.generatedAt,
      freshness: 'fresh',
      confidence: engine.confidencePct,
      missingDataReason: null,
    }

    dimensions.push({
      dimension: 'competition',
      state: stateFromScore(engine.fairnessScore),
      explanation: `Fairness score ${engine.fairnessScore}/100 — reflects waiver type, trade review process, abandoned teams, and unresolved disputes.`,
      evidence: engine.biggestProblems.length > 0 ? engine.biggestProblems : engine.biggestStrengths,
      confidence: engine.confidencePct,
      freshness: 'fresh',
      sourceAttribution: attribution,
      risk: engine.fairnessScore < 50 ? 'high' : engine.fairnessScore < 65 ? 'medium' : 'low',
      uncertainty: [],
    })

    dimensions.push({
      dimension: 'participation',
      state: stateFromScore(engine.sustainabilityScore),
      explanation: `Sustainability score ${engine.sustainabilityScore}/100 — reflects inactive managers, abandoned teams, and lineup submission rate.`,
      evidence: engine.inactiveManagerNotes,
      confidence: engine.confidencePct,
      freshness: 'fresh',
      sourceAttribution: attribution,
      risk: engine.abandonmentRiskScore > 60 ? 'high' : engine.abandonmentRiskScore > 30 ? 'medium' : 'low',
      uncertainty: engine.engagementDropoffFlags,
    })

    dimensions.push({
      dimension: 'activity',
      state: stateFromScore(engine.engagementScore),
      explanation: `Engagement score ${engine.engagementScore}/100 — reflects trades, waiver claims, and lineup submission activity. Trend: ${trend.available ? trend.direction : 'unavailable'}.`,
      evidence: [...engine.transactionHealthNotes, ...engine.waiverHealthNotes, ...engine.tradeHealthNotes],
      confidence: engine.confidencePct,
      freshness: 'fresh',
      sourceAttribution: attribution,
      risk: engine.churnRiskScore > 60 ? 'high' : engine.churnRiskScore > 30 ? 'medium' : 'low',
      uncertainty: [],
    })
  }

  if (context.gameDayAttentionItems === null) {
    dimensions.push(unavailableDimension('lineup_health', 'No viewer roster was supplied — Game Day Lineup Attention was not assembled for this league.'))
  } else {
    const critical = context.gameDayAttentionItems.filter((i) => i.severity === 'critical').length
    dimensions.push({
      dimension: 'lineup_health',
      state: critical > 0 ? 'attention_required' : context.gameDayAttentionItems.length > 0 ? 'watch' : 'good',
      explanation: `${context.gameDayAttentionItems.length} lineup attention item(s) found for the assembled viewer roster, ${critical} critical.`,
      evidence: context.gameDayAttentionItems.slice(0, 5).map((i) => i.message),
      confidence: 70,
      freshness: 'fresh',
      sourceAttribution: { source: 'game-day-lineup-attention-service', fetchedAt: generatedAt, providerTimestamp: null, freshness: 'fresh', confidence: 70, missingDataReason: null },
      risk: critical > 0 ? 'high' : 'low',
      uncertainty: [],
    })
  }

  const activityAttr: SourceAttribution = { source: 'mission-control-service', fetchedAt: generatedAt, providerTimestamp: null, freshness: 'fresh', confidence: 80, missingDataReason: null }
  dimensions.push({
    dimension: 'transaction_activity',
    state: context.missionControl.activity.tradeCount + context.missionControl.activity.waiverClaimCount > 0 ? 'good' : 'watch',
    explanation: `${context.missionControl.activity.tradeCount} trade(s), ${context.missionControl.activity.waiverClaimCount} waiver claim(s), ${context.missionControl.activity.draftPickCount} draft pick(s) recorded.`,
    evidence: [`rosterActivityCount=${context.missionControl.activity.rosterActivityCount}`],
    confidence: 80,
    freshness: 'fresh',
    sourceAttribution: activityAttr,
    risk: 'low',
    uncertainty: [],
  })

  dimensions.push({
    dimension: 'commissioner_attention',
    state: context.missionControl.recommendedActions.some((a) => a.priority === 'urgent')
      ? 'attention_required'
      : context.missionControl.recommendedActions.length > 0
        ? 'watch'
        : 'good',
    explanation: `${context.missionControl.recommendedActions.length} recommended action(s) from Mission Control.`,
    evidence: context.missionControl.recommendedActions.map((a) => a.message),
    confidence: 80,
    freshness: 'fresh',
    sourceAttribution: activityAttr,
    risk: context.missionControl.recommendedActions.some((a) => a.priority === 'urgent') ? 'high' : 'low',
    uncertainty: [],
  })

  const provenanceValues = context.missionControl.fieldProvenance ? Object.values(context.missionControl.fieldProvenance) : []
  const realFieldCount = provenanceValues.filter((v) => v === 'decision_os').length
  dimensions.push({
    dimension: 'data_quality',
    state: context.missionControl.fieldProvenance === null ? 'unavailable' : realFieldCount === provenanceValues.length ? 'good' : 'watch',
    explanation: context.missionControl.fieldProvenance
      ? `${realFieldCount}/${provenanceValues.length} League Health input fields are real Decision OS data; the rest use schema defaults.`
      : 'League Health field provenance is unavailable.',
    evidence: [],
    confidence: context.missionControl.fieldProvenance ? Math.round((realFieldCount / Math.max(1, provenanceValues.length)) * 100) : 0,
    freshness: context.missionControl.fieldProvenance ? 'fresh' : 'unknown',
    sourceAttribution: activityAttr,
    risk: 'low',
    uncertainty: [],
  })

  const numericDimensions = dimensions.filter((d) => d.state !== 'unavailable')
  const stateScore: Record<PulseDimension['state'], number> = { good: 90, watch: 60, attention_required: 30, unavailable: 0 }
  const compositeScore =
    numericDimensions.length > 0 ? Math.round(numericDimensions.reduce((sum, d) => sum + stateScore[d.state], 0) / numericDimensions.length) : 0

  return {
    leagueId: context.leagueId,
    generatedAt,
    dimensions,
    compositeScore,
    compositeExplanation: `Composite of ${numericDimensions.length} available dimension(s) (of ${dimensions.length} total) — see each dimension's own explanation and evidence for what drove it.`,
  }
}
