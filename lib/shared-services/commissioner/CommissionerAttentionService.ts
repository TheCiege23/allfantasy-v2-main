/**
 * Commissioner Attention Service — Phase 10.
 *
 * Reuses lib/decision-os/attentionSignals.ts's deriveLeagueAttentionSignals()
 * as its primary source — a real, already-computed signal engine that (per
 * the Phase 10 audit) currently has NO live route caller ("built for a
 * future background job/email/mobile consumer" per its own header). This
 * service gives it a real consumer, mapped into this module's own canonical
 * CommissionerAttentionItem shape, and adds one genuinely new category this
 * existing engine doesn't have: carrying over the Phase 9 Game Day service's
 * own LineupAttentionItems (when the context assembler was given a viewer
 * roster to enrich with).
 *
 * financialStatus defaults to 'UNKNOWN' rather than guessing — resolving the
 * real per-league financial/dues status (lib/decision-os/leagueFinancialContext.ts)
 * is out of scope for this foundation pass; wiring it is a documented next
 * step, not silently assumed.
 */

import { deriveLeagueAttentionSignals } from '@/lib/decision-os/attentionSignals'
import type { CommissionerAttentionItem, CommissionerContext } from './types'

const SEVERITY_MAP: Record<string, CommissionerAttentionItem['severity']> = {
  critical: 'critical',
  high: 'high',
  medium: 'medium',
  low: 'low',
  informational: 'informational',
}

export function buildCommissionerAttentionItems(context: CommissionerContext): CommissionerAttentionItem[] {
  const generatedAt = new Date().toISOString()
  const items: CommissionerAttentionItem[] = []

  const overallStatus = context.missionControl.leagueHealth.available ? context.missionControl.leagueHealth.result.engine.overallStatus : null
  const leagueHealthScore = context.missionControl.leagueHealth.available ? context.missionControl.leagueHealth.result.engine.leagueHealthScore : null

  const legacySignals = deriveLeagueAttentionSignals({
    leagueId: context.leagueId,
    now: new Date(generatedAt),
    overallStatus,
    leagueHealthScore,
    recommendedActions: context.missionControl.recommendedActions,
    financialStatus: 'UNKNOWN',
    draftDateUtc: null,
  })

  for (const signal of legacySignals) {
    items.push({
      reasonCode: 'legacy_signal',
      category: signal.type,
      severity: SEVERITY_MAP[signal.severity] ?? 'informational',
      leagueId: signal.leagueId,
      affectedManagerIds: [],
      message: signal.title,
      evidence: [signal.explanation],
      confidence: 70,
      freshness: 'fresh',
      risk: signal.severity === 'critical' || signal.severity === 'high' ? 'high' : signal.severity === 'medium' ? 'medium' : 'low',
      recommendedAction: signal.recommendedAction ?? null,
      actionAvailableInApp: false,
      providerDeepLink: null,
      permissionRequired: 'commissioner',
    })
  }

  if (context.gameDayAttentionItems) {
    for (const gd of context.gameDayAttentionItems) {
      if (gd.severity === 'info') continue
      items.push({
        reasonCode: 'lineup_attention_carryover',
        category: gd.reasonCode,
        severity: gd.severity === 'critical' ? 'critical' : 'medium',
        leagueId: context.leagueId,
        affectedManagerIds: [],
        message: gd.message,
        evidence: gd.evidence,
        confidence: gd.confidence,
        freshness: gd.freshness,
        risk: gd.risk,
        recommendedAction: null,
        actionAvailableInApp: gd.actionable,
        providerDeepLink: gd.providerDeepLink,
        permissionRequired: 'member',
      })
    }
  }

  return items
}
