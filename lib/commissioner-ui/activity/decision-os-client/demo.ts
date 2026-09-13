import type { ActivityClient } from './types'
import type { CommissionerActivityEventContract } from '../../contracts'
import { demoLeagueHealthClient } from '../../league-health/decision-os-client/demo'
import { demoRecommendationsClient } from '../../recommendations/decision-os-client/demo'
import { demoAutomationClient } from '../../automations/decision-os-client/demo'
import { demoReportsClient } from '../../reports/decision-os-client/demo'
import { demoWorkspaceClient } from '../../workspace/decision-os-client/demo'
import { conditionToEventSeverity } from '../../notifications/decision-os-client/severityMapping'

/**
 * ⚠ `now` IS PASSED IN, NOT READ HERE. This helper used to call `new Date()`
 * itself, once per event, and the demo pushes events that share an offset
 * (`daysAgo(1, now)` twice, `daysAgo(2, now)` twice). When the clock ticked between two
 * of those calls, the later-built event came out 1 ms NEWER than the one before
 * it, so a list promised newest-first was not — and CI failed on it
 * (2026-09-13, `…008` then `…009`). `getEvents` reads the clock once and every
 * timestamp is derived from that single value.
 */
function daysAgo(n: number, now: number) {
  const date = new Date(now)
  date.setDate(date.getDate() - n)
  return date.toISOString()
}

/**
 * Every event below is built from another module's own demo fixture,
 * exactly like Notification Center's demo.ts — a `summary` and
 * `evidenceHref` are the only things this file ever holds, never a
 * second copy of a risk's description, an automation's health detail, a
 * report's failure reason, or a task's own fields.
 */
export const demoActivityClient: ActivityClient = {
  async getEvents() {
    // One clock read for the whole response — see `daysAgo`.
    const now = Date.now()
    const [risks, recommendations, automations, reportHistory, tasks] = await Promise.all([
      demoLeagueHealthClient.getRisks(),
      demoRecommendationsClient.getQueue(),
      demoAutomationClient.getCatalog(),
      demoReportsClient.getHistory(),
      demoWorkspaceClient.getTasks(),
    ])

    const risk = risks.data?.[0]
    const tradeDeadlineRecommendation = recommendations.data?.find((rec) => rec.id === 'demo-rec-2')
    const standingsRecommendation = recommendations.data?.find((rec) => rec.id === 'demo-rec-3')
    const lineupAutomation = automations.data?.find((auto) => auto.id === 'demo-auto-2')
    const tradeReminderAutomation = automations.data?.find((auto) => auto.id === 'demo-auto-1')
    const failedReport = reportHistory.data?.find((report) => report.status === 'failed')
    const readyReport = reportHistory.data?.find((report) => report.id === 'report-1')
    const completedTask = tasks.data?.find((task) => task.id === 'demo-task-7')
    const archivedTask = tasks.data?.find((task) => task.id === 'demo-task-8')

    const events: CommissionerActivityEventContract[] = []

    if (risk) {
      events.push({
        id: `activity-${risk.id}`,
        type: 'risk_detected',
        sourceModuleId: 'league-health',
        severity: conditionToEventSeverity(risk.severity),
        initiator: 'system',
        summary: risk.description,
        evidenceHref: '/commissioner-os/league-health',
        timestamp: daysAgo(0, now),
      })
    }

    if (lineupAutomation) {
      events.push({
        id: `activity-${lineupAutomation.id}-failed`,
        type: 'automation_failed',
        sourceModuleId: 'automations',
        severity: conditionToEventSeverity(lineupAutomation.health),
        initiator: 'system',
        summary: `${lineupAutomation.name} failed on its last run.`,
        evidenceHref: '/commissioner-os/automations',
        timestamp: daysAgo(1, now),
      })
    }

    if (failedReport) {
      events.push({
        id: `activity-${failedReport.id}`,
        type: 'report_failed',
        sourceModuleId: 'reports',
        severity: 'warning',
        initiator: 'system',
        summary: `${failedReport.templateName} failed to generate.`,
        evidenceHref: '/commissioner-os/reports',
        timestamp: daysAgo(1, now),
      })
    }

    if (tradeDeadlineRecommendation) {
      events.push({
        id: `activity-${tradeDeadlineRecommendation.id}`,
        type: 'recommendation_created',
        sourceModuleId: 'recommendations',
        severity: conditionToEventSeverity(tradeDeadlineRecommendation.severity),
        initiator: 'system',
        summary: tradeDeadlineRecommendation.title,
        evidenceHref: '/commissioner-os/recommendations',
        timestamp: daysAgo(2, now),
      })
    }

    if (completedTask) {
      events.push({
        id: `activity-${completedTask.id}`,
        type: 'task_completed',
        sourceModuleId: 'workspace',
        severity: 'success',
        initiator: 'human',
        summary: completedTask.title,
        evidenceHref: '/commissioner-os/workspace',
        timestamp: daysAgo(2, now),
      })
    }

    if (standingsRecommendation) {
      events.push({
        id: `activity-${standingsRecommendation.id}`,
        type: 'recommendation_automated',
        sourceModuleId: 'recommendations',
        severity: conditionToEventSeverity(standingsRecommendation.severity),
        initiator: 'system',
        summary: standingsRecommendation.title,
        evidenceHref: '/commissioner-os/recommendations',
        timestamp: daysAgo(3, now),
      })
    }

    if (archivedTask) {
      events.push({
        id: `activity-${archivedTask.id}`,
        type: 'task_archived',
        sourceModuleId: 'workspace',
        severity: 'informational',
        initiator: 'human',
        summary: archivedTask.title,
        evidenceHref: '/commissioner-os/workspace',
        timestamp: daysAgo(4, now),
      })
    }

    if (tradeReminderAutomation) {
      events.push({
        id: `activity-${tradeReminderAutomation.id}-success`,
        type: 'automation_executed',
        sourceModuleId: 'automations',
        severity: 'success',
        initiator: 'system',
        summary: `${tradeReminderAutomation.name} ran successfully.`,
        evidenceHref: '/commissioner-os/automations',
        timestamp: daysAgo(5, now),
      })
    }

    if (readyReport) {
      events.push({
        id: `activity-${readyReport.id}`,
        type: 'report_generated',
        sourceModuleId: 'reports',
        severity: 'success',
        initiator: 'system',
        summary: `${readyReport.templateName} generated successfully.`,
        evidenceHref: '/commissioner-os/reports',
        timestamp: daysAgo(6, now),
      })
    }

    return {
      data: events,
      error: null,
      source: 'demo',
      timestamp: daysAgo(0, now),
    }
  },
}
