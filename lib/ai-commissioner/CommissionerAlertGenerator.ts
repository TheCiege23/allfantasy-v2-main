import type { AiCommissionerConfig } from '@prisma/client'
import type { GovernanceAnalysis, GovernanceSignal } from './types'

export interface CommissionerAlertGeneratorInput {
  analysis: GovernanceAnalysis
  config: AiCommissionerConfig
}

export function generateCommissionerAlerts(
  input: CommissionerAlertGeneratorInput
): GovernanceSignal[] {
  const { analysis, config } = input
  const alerts: GovernanceSignal[] = []

  if (config.remindersEnabled) {
    // A best ball league sets every lineup itself: there is nothing to remind a manager to set.
    if (!analysis.bestBall) {
      alerts.push({
        alertType: 'LINEUP_REMINDER',
        severity: 'medium',
        headline: 'Lineup lock reminders are active',
        summary: `Send lineup reminders roughly ${analysis.scheduleContext.lockReminderHours} hours before lock for ${analysis.sport}.`,
        relatedManagerIds: [],
      })
    }
    if (
      analysis.scheduleContext.periodsUntilPlayoffs != null &&
      analysis.scheduleContext.periodsUntilPlayoffs <= 2
    ) {
      alerts.push({
        alertType: 'PLAYOFF_DEADLINE_REMINDER',
        severity: analysis.scheduleContext.periodsUntilPlayoffs <= 1 ? 'high' : 'medium',
        headline: 'Playoff deadline is approaching',
        summary: `Only ${analysis.scheduleContext.periodsUntilPlayoffs} scoring period(s) until playoffs. Queue commissioner reminders for lock deadlines and roster compliance.`,
      })
    }
  }

  for (const conflict of analysis.ruleConflicts) {
    alerts.push({
      alertType: 'RULE_CONFLICT_NOTICE',
      severity: conflict.severity,
      headline: 'Rule configuration needs review',
      summary: conflict.summary,
    })
  }

  if (analysis.pendingWaiverClaims > 0) {
    alerts.push({
      alertType: 'VOTE_RECOMMENDATION',
      severity: analysis.pendingWaiverClaims > 20 ? 'high' : 'medium',
      headline: 'Waiver queue requires commissioner attention',
      summary: `${analysis.pendingWaiverClaims} waiver claim(s) are pending. Recommend a commissioner review cycle before the next lock.`,
    })
  }

  if (config.inactivityMonitoringEnabled) {
    for (const manager of analysis.inactiveManagers.slice(0, 5)) {
      alerts.push({
        alertType: 'INACTIVE_MANAGER_WARNING',
        severity: manager.daysSinceActivity > 21 ? 'high' : 'medium',
        headline: 'Inactive manager risk detected',
        summary: `Manager ${manager.managerId} has shown no recent activity for ${manager.daysSinceActivity} days.`,
        relatedManagerIds: [manager.managerId],
      })
    }
  }

  if (config.disputeAnalysisEnabled) {
    for (const dispute of analysis.tradeDisputes.slice(0, 5)) {
      alerts.push({
        alertType: 'DISPUTE_CONTEXT',
        severity: dispute.severity,
        headline: 'Trade dispute context ready',
        summary: dispute.summary,
        relatedManagerIds: dispute.managerIds,
        relatedTradeId: dispute.tradeId,
      })
      alerts.push({
        alertType: 'TRADE_REVIEW_FLAG',
        severity: dispute.severity,
        headline: 'Trade review recommended',
        summary: `Flagging trade ${dispute.tradeId} for commissioner review due to value imbalance signals.`,
        relatedManagerIds: dispute.managerIds,
        relatedTradeId: dispute.tradeId,
      })
    }
  }

  if (config.collusionMonitoringEnabled) {
    for (const signal of analysis.collusionSignals.slice(0, 5)) {
      alerts.push({
        alertType: 'COLLUSION_SIGNAL',
        severity: signal.severity,
        headline: 'Potential collusion signal detected',
        summary: signal.summary,
        relatedManagerIds: signal.managerIds,
        relatedTradeId: signal.tradeId ?? null,
      })
    }
  }

  if (config.voteSuggestionEnabled) {
    alerts.push({
      alertType: 'VOTE_RECOMMENDATION',
      severity: 'low',
      headline: 'Commissioner vote guidance available',
      summary:
        'AI Commissioner can draft league vote framing for disputes, trade review votes, and governance announcements.',
    })
  }

  return alerts
}
