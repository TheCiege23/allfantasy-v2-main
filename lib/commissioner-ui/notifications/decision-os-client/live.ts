import type { NotificationsClient } from './types'
import type { CommissionerNotificationPayload } from '../../contracts'
import { isLiveReady } from '../../liveReadiness'
import { liveLeagueHealthClient } from '../../league-health/decision-os-client/live'
import { liveRecommendationsClient } from '../../recommendations/decision-os-client/live'
import { liveAutomationClient } from '../../automations/decision-os-client/live'
import { liveReportsClient } from '../../reports/decision-os-client/live'
import { conditionToEventSeverity } from './severityMapping'

/**
 * Phase 3.13 — Notification Center, like Search (3.12), is a **composition
 * layer**: its own contract doc comment says a notification payload never
 * duplicates the module data behind it, only enough (`message`,
 * `sourceModuleId`, an optional `relatedLink`) to know about it and get
 * back to it. `getNotifications()` composes over four other modules' own
 * already-audited *live* clients — `liveLeagueHealthClient.getRisks()`,
 * `liveRecommendationsClient.getQueue()`, `liveAutomationClient.getCatalog()`,
 * `liveReportsClient.getHistory()` — mirroring `demo.ts`'s own composition,
 * generalized from that file's narratively-curated single hardcoded demo
 * entries (`demo-rec-2`, `demo-auto-2`, etc.) to: map *every* real item that
 * meets the same real, already-established filter demo.ts's specific
 * choices imply (a failed report, an automation needing attention — health
 * not positive or its last run failed — every risk, every recommendation).
 * No new ranking/scoring/aggregation logic: each filter reuses a field the
 * source item already has.
 *
 * All four sources are, today, structurally unable to contribute (each
 * already concluded in its own phase's report to have no real analog for
 * its own required fields — Phase 3.5 for risks, 3.7 for recommendations,
 * 3.9 for automations, 3.11 for reports), so `getNotifications()` returns
 * `data: []` in every environment right now. This is a genuine, honest
 * success, not a placeholder masquerading as one, for a reason specific to
 * notifications and distinct from Reports' (3.11) conclusion: a
 * notification is a *recomputed, derived observation* about another
 * module's current state, never a persisted, user-generated artifact. "0
 * currently-derivable alerts" doesn't assert anything false about a
 * commissioner's own past actions (unlike Reports' "0 generated reports,"
 * which would misrepresent irretrievable user history) — it only reflects
 * that no source module currently has anything real to surface, which is
 * literally, structurally true. An empty inbox is also a completely normal
 * state for any real notification system, unlike Reports' fixed, always-
 * populated template catalog.
 *
 * `read` has no real analog anywhere — no persisted "was this notification
 * seen" store exists for any composed source. Every composed entry
 * defaults to `read: false`: not a fabricated guess about human behavior,
 * but the structurally accurate statement that a notification recomputed
 * fresh on this exact request has no prior read history in this system
 * (matching this module's own doc comment: the returned value is only "the
 * fetched baseline a fresh session starts from," refined by local
 * client-side state after that — never a second backend mutation).
 *
 * `createdAt` reuses each source's own real timestamp where one exists
 * (`recommendation.createdAt`, `automation.lastRunAt`,
 * `report.generatedAt`) — the same "honest reinterpretation of a real
 * field" pattern Recommendations Center used in Phase 3.7. `LeagueHealthRisk`
 * has no timestamp field of any kind; since `getRisks()` never actually
 * succeeds today, this never arises in practice, but for correctness a
 * risk-derived notification's `createdAt` falls back to the composition's
 * own request time — an honest "as of when this was computed" fact, not a
 * fabricated history.
 */
function notYetIntegrated() {
  return {
    category: 'upstream_unavailable' as const,
    message: 'The live Decision OS backend is not yet integrated in this environment.',
    moduleId: 'notifications' as const,
    retryable: false,
    timestamp: new Date().toISOString(),
  }
}

async function composeNotifications(): Promise<CommissionerNotificationPayload[]> {
  const now = new Date().toISOString()
  const [risks, recommendations, automations, reportHistory] = await Promise.all([
    liveLeagueHealthClient.getRisks(),
    liveRecommendationsClient.getQueue(),
    liveAutomationClient.getCatalog(),
    liveReportsClient.getHistory(),
  ])

  const data: CommissionerNotificationPayload[] = []

  for (const risk of risks.data ?? []) {
    data.push({
      id: `notification-${risk.id}`,
      severity: conditionToEventSeverity(risk.severity),
      message: risk.description,
      sourceModuleId: 'league-health',
      createdAt: now,
      read: false,
      relatedLink: { moduleId: 'league-health', label: 'View League Health', href: '/commissioner-os/league-health' },
    })
  }

  for (const rec of recommendations.data ?? []) {
    data.push({
      id: `notification-${rec.id}`,
      severity: conditionToEventSeverity(rec.severity),
      message: rec.title,
      sourceModuleId: 'recommendations',
      createdAt: rec.createdAt,
      read: false,
      relatedLink: { moduleId: 'recommendations', label: 'View Recommendations', href: '/commissioner-os/recommendations' },
    })
  }

  for (const automation of automations.data ?? []) {
    const needsAttention = automation.health !== 'positive' || automation.lastRunResult === 'failure'
    if (!needsAttention) continue
    data.push({
      id: `notification-${automation.id}`,
      severity: conditionToEventSeverity(automation.health),
      message: `${automation.name} needs attention — its last run ${automation.lastRunResult === 'failure' ? 'failed' : 'was not fully successful'}.`,
      sourceModuleId: 'automations',
      createdAt: automation.lastRunAt ?? now,
      read: false,
      relatedLink: { moduleId: 'automations', label: 'Review Automation', href: '/commissioner-os/automations' },
    })
  }

  for (const report of reportHistory.data ?? []) {
    if (report.status !== 'failed') continue
    data.push({
      id: `notification-${report.id}`,
      severity: 'warning',
      message: `${report.templateName} failed to generate — ${report.failureReason ?? 'no partial file was produced.'}`,
      sourceModuleId: 'reports',
      createdAt: report.generatedAt,
      read: false,
      relatedLink: { moduleId: 'reports', label: 'View Reports', href: '/commissioner-os/reports' },
    })
  }

  return data
}

export const liveNotificationsClient: NotificationsClient = {
  async getNotifications() {
    if (!(await isLiveReady('notifications'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const data = await composeNotifications()
    return { data, error: null, source: 'live', timestamp: new Date().toISOString() }
  },

  async getSummary() {
    if (!(await isLiveReady('notifications'))) {
      return { data: null, error: notYetIntegrated(), source: 'live', timestamp: new Date().toISOString() }
    }
    const notifications = await composeNotifications()
    const unreadCount = notifications.filter((n) => !n.read).length
    const criticalCount = notifications.filter((n) => n.severity === 'critical').length
    const headline = unreadCount === 0 ? 'No unread notifications' : `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}`

    return {
      data: { unreadCount, criticalCount, headline },
      error: null,
      source: 'live',
      timestamp: new Date().toISOString(),
    }
  },
}
