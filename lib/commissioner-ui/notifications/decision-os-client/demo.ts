import type { NotificationsClient } from './types'
import type { CommissionerNotificationPayload } from '../../contracts'
import { demoLeagueHealthClient } from '../../league-health/decision-os-client/demo'
import { demoRecommendationsClient } from '../../recommendations/decision-os-client/demo'
import { demoAutomationClient } from '../../automations/decision-os-client/demo'
import { demoReportsClient } from '../../reports/decision-os-client/demo'
import { conditionToEventSeverity } from './severityMapping'

function ts(daysAgo: number) {
  const date = new Date()
  date.setDate(date.getDate() - daysAgo)
  return date.toISOString()
}

/**
 * Every notification below is built from another module's own demo
 * fixture, the same "reference existing entities, never duplicate them"
 * approach Global Search's index used — a notification's `message` is a
 * short pointer to the real thing, never a second copy of a risk's
 * description, an automation's health detail, or a report's failure
 * reason.
 */
export const demoNotificationsClient: NotificationsClient = {
  async getNotifications() {
    const [risks, recommendations, automations, reportHistory] = await Promise.all([
      demoLeagueHealthClient.getRisks(),
      demoRecommendationsClient.getQueue(),
      demoAutomationClient.getCatalog(),
      demoReportsClient.getHistory(),
    ])

    const risk = risks.data?.[0]
    const standingsRecommendation = recommendations.data?.find((rec) => rec.id === 'demo-rec-3')
    const tradeDeadlineRecommendation = recommendations.data?.find((rec) => rec.id === 'demo-rec-2')
    const lineupAutomation = automations.data?.find((auto) => auto.id === 'demo-auto-2')
    const failedReport = reportHistory.data?.find((report) => report.status === 'failed')

    const data: CommissionerNotificationPayload[] = []

    if (risk) {
      data.push({
        id: `notification-${risk.id}`,
        severity: conditionToEventSeverity(risk.severity),
        message: risk.description,
        sourceModuleId: 'league-health',
        createdAt: ts(0),
        read: false,
        relatedLink: { moduleId: 'league-health', label: 'View League Health', href: '/commissioner-os/league-health' },
      })
    }

    if (lineupAutomation) {
      data.push({
        id: `notification-${lineupAutomation.id}`,
        severity: conditionToEventSeverity(lineupAutomation.health),
        message: `${lineupAutomation.name} needs attention — its last run failed.`,
        sourceModuleId: 'automations',
        createdAt: ts(1),
        read: false,
        relatedLink: { moduleId: 'automations', label: 'Review Automation', href: '/commissioner-os/automations' },
      })
    }

    if (failedReport) {
      data.push({
        id: `notification-${failedReport.id}`,
        severity: 'warning',
        message: `${failedReport.templateName} failed to generate — ${failedReport.failureReason ?? 'no partial file was produced.'}`,
        sourceModuleId: 'reports',
        createdAt: ts(1),
        read: true,
        relatedLink: { moduleId: 'reports', label: 'View Reports', href: '/commissioner-os/reports' },
      })
    }

    if (tradeDeadlineRecommendation) {
      data.push({
        id: `notification-${tradeDeadlineRecommendation.id}`,
        severity: conditionToEventSeverity(tradeDeadlineRecommendation.severity),
        message: tradeDeadlineRecommendation.title,
        sourceModuleId: 'recommendations',
        createdAt: ts(2),
        read: true,
        relatedLink: { moduleId: 'recommendations', label: 'View Recommendations', href: '/commissioner-os/recommendations' },
      })
    }

    if (standingsRecommendation) {
      data.push({
        id: `notification-${standingsRecommendation.id}`,
        severity: conditionToEventSeverity(standingsRecommendation.severity),
        message: standingsRecommendation.title,
        sourceModuleId: 'recommendations',
        createdAt: ts(3),
        read: true,
        relatedLink: { moduleId: 'recommendations', label: 'View Recommendations', href: '/commissioner-os/recommendations' },
      })
    }

    return {
      data,
      error: null,
      source: 'demo',
      timestamp: ts(0),
    }
  },

  async getSummary() {
    const { data } = await demoNotificationsClient.getNotifications()
    const notifications = data ?? []
    const unreadCount = notifications.filter((n) => !n.read).length
    const criticalCount = notifications.filter((n) => n.severity === 'critical').length
    const headline = unreadCount === 0 ? 'No unread notifications' : `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`

    return {
      data: { unreadCount, criticalCount, headline },
      error: null,
      source: 'demo',
      timestamp: ts(0),
    }
  },
}
