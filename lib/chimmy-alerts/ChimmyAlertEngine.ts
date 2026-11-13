import { createHash } from 'crypto'
import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import { createPlatformNotification } from '@/lib/platform/notification-service'
import type {
  ChimmyAlert,
  ChimmyAlertCandidate,
  ChimmyAlertChannel,
  ChimmyAlertContext,
  ChimmyAlertLifecycleEvent,
  ChimmyAlertSeverity,
  ChimmyAlertUserPreferences,
} from './types'
import { detectAlertCandidates } from './ChimmyAlertDetectors'
import { loadAlertDeliveryHistory, routeAlertDelivery, type ChimmyAlertDeliveryHistory } from './ChimmyAlertDeliveryRouter'
import { loadChimmyAlertPreferences } from './ChimmyAlertPreferencesService'
import {
  evaluateAlertSuppression,
  groupLowPriorityAlerts,
  resolveEffectiveCooldownMultiplier,
} from './ChimmyAlertSuppressionEngine'

function toSeverity(signal: number): ChimmyAlertSeverity {
  if (signal >= 92) return 'critical'
  if (signal >= 78) return 'urgent'
  if (signal >= 58) return 'action_recommended'
  return 'informational'
}

function scoreAlertUrgency(candidate: ChimmyAlertCandidate, context: ChimmyAlertContext): number {
  const sensitivity = context.userPreferences?.sensitivity ?? 'normal'
  const modifier = sensitivity === 'high' ? 1.08 : sensitivity === 'low' ? 0.9 : 1
  return Math.max(1, Math.min(100, Math.round(candidate.urgencySignal * modifier)))
}

function scoreAlertRelevance(candidate: ChimmyAlertCandidate, context: ChimmyAlertContext): number {
  let score = candidate.confidenceScore
  if (candidate.roleScope === 'commissioner' && context.role === 'commissioner') score += 4
  if (candidate.roleScope === 'admin' && context.role === 'admin') score += 5
  if (context.pageSurface && candidate.class === 'matchup' && context.pageSurface === 'matchup') score += 4
  return Math.max(1, Math.min(100, score))
}

function chooseAlertChannel(severity: ChimmyAlertSeverity, context: ChimmyAlertContext, roleScope: ChimmyAlertCandidate['roleScope']): ChimmyAlertChannel[] {
  const override = context.userPreferences?.channelOverrides?.[severity]
  if (override && override.length > 0) return override

  if (roleScope === 'admin') {
    if (severity === 'critical') return ['notification_center', 'in_app_banner', 'push_notification', 'email']
    return ['notification_center', 'dashboard_card']
  }

  if (roleScope === 'commissioner') {
    if (severity === 'critical') return ['commissioner_panel', 'in_app_banner', 'notification_center', 'push_notification']
    if (severity === 'urgent') return ['commissioner_panel', 'notification_center', 'floating_nudge']
    return ['commissioner_panel', 'dashboard_card']
  }

  if (severity === 'critical') return ['in_app_banner', 'notification_center', 'push_notification']
  if (severity === 'urgent') return ['page_inline', 'notification_center', 'floating_nudge']
  if (severity === 'action_recommended') return ['dashboard_card', 'notification_center']
  return ['dashboard_card']
}

function bindAlertActions(candidate: ChimmyAlertCandidate, context: ChimmyAlertContext): ChimmyAlert['actions'] {
  const leagueHref = context.leagueId ? `/leagues/${context.leagueId}` : '/dashboard'

  switch (candidate.type) {
    case 'lineup_incomplete':
      return [{ label: 'Set Lineup', href: `${leagueHref}/lineup`, actionType: 'optimize_lineup' }]
    case 'priority_add_available':
      return [{ label: 'Claim Now', href: `${leagueHref}/waivers`, actionType: 'claim_player' }]
    case 'new_trade_offer':
      return [{ label: 'Review Trade', href: `${leagueHref}/trade`, actionType: 'analyze_trade' }]
    case 'on_the_clock':
      return [{ label: 'Open Draft Room', href: `${leagueHref}/draft`, actionType: 'draft_player' }]
    case 'weather_risk_now_relevant':
      return [{ label: 'Adjust Lineup', href: `${leagueHref}/matchup`, actionType: 'optimize_floor' }]
    case 'weekly_recap_ready':
      return [{ label: 'Review Post', href: `${leagueHref}/commissioner`, actionType: 'post_recap' }]
    default:
      return [{ label: 'Open', href: leagueHref }]
  }
}

function buildAlertId(candidate: ChimmyAlertCandidate, context: ChimmyAlertContext): string {
  const base = `${context.userId}:${context.leagueId ?? 'global'}:${candidate.class}:${candidate.type}`
  return createHash('sha1').update(base).digest('hex').slice(0, 24)
}

function buildDedupeKey(candidate: ChimmyAlertCandidate, context: ChimmyAlertContext): string {
  const scope = `${context.userId}:${context.leagueId ?? 'global'}:${candidate.type}`
  const metadataPart = candidate.metadata ? JSON.stringify(candidate.metadata) : ''
  return createHash('sha1').update(`${scope}:${metadataPart}`).digest('hex').slice(0, 28)
}

export function renderAlertPayload(candidate: ChimmyAlertCandidate, context: ChimmyAlertContext): ChimmyAlert {
  const urgencyScore = scoreAlertUrgency(candidate, context)
  const confidenceScore = scoreAlertRelevance(candidate, context)
  const severity = toSeverity(urgencyScore)
  const channels = chooseAlertChannel(severity, context, candidate.roleScope ?? 'member')

  return {
    alertId: buildAlertId(candidate, context),
    dedupeKey: buildDedupeKey(candidate, context),
    class: candidate.class,
    type: candidate.type,
    title: candidate.title,
    message: candidate.message,
    severity,
    confidenceScore,
    urgencyScore,
    urgencyDeadlineAt: candidate.urgencyDeadlineAt ?? null,
    channels,
    primaryChannel: channels[0],
    dismissible: candidate.dismissible ?? true,
    snoozable: candidate.snoozable ?? true,
    repeatable: candidate.repeatable ?? true,
    repeatCooldownMinutes: candidate.repeatCooldownMinutes ?? 90,
    expiresAt: null,
    leagueId: context.leagueId ?? null,
    teamId: context.teamId ?? null,
    sport: context.sport,
    leagueType: context.leagueType,
    roleScope: candidate.roleScope ?? 'member',
    actions: bindAlertActions(candidate, context),
    metadata: candidate.metadata,
  }
}

async function suppressDuplicateAlerts(
  alerts: ChimmyAlert[],
  context: ChimmyAlertContext,
  prefs?: ChimmyAlertUserPreferences,
): Promise<ChimmyAlert[]> {
  if (alerts.length === 0) return alerts

  const from = new Date((context.now ?? new Date()).getTime() - 1000 * 60 * 60 * 24 * 7)
  const existing = await prisma.platformNotification.findMany({
    where: {
      userId: context.userId,
      type: 'chimmy_alert',
      createdAt: { gte: from },
    },
    select: {
      createdAt: true,
      meta: true,
      readAt: true,
    },
    take: 300,
    orderBy: { createdAt: 'desc' },
  })

  const kept: ChimmyAlert[] = []
  for (const alert of alerts) {
    const cooldownMultiplier = prefs ? resolveEffectiveCooldownMultiplier(alert, prefs) : 1
    const duplicate = existing.find((row) => {
      const meta = (row.meta ?? {}) as Record<string, unknown>
      const sameKey = meta.dedupeKey === alert.dedupeKey
      if (!sameKey) return false

      const created = row.createdAt.getTime()
      const cooldown = alert.repeatCooldownMinutes * cooldownMultiplier * 60 * 1000
      const isStillCooling = Date.now() - created < cooldown
      const wasDismissed = meta.lifecycleState === 'dismissed'
      if (isStillCooling) return true
      if (wasDismissed && Date.now() - created < cooldown * 2) return true
      return false
    })

    if (duplicate) continue
    kept.push(alert)
  }

  return kept
}

/**
 * Strip channels that the user has opted out of in their channel preferences.
 */
function applyChannelPrefs(
  channels: ChimmyAlertChannel[],
  prefs: ChimmyAlertUserPreferences,
): ChimmyAlertChannel[] {
  const cp = prefs.channelPreferences
  if (!cp) return channels
  return channels.filter((ch) => {
    if (ch === 'push_notification' || ch === 'mobile_push') return !cp.disablePush
    if (ch === 'email') return !cp.disableEmail
    if (ch === 'sms') return !cp.disableSms
    return true
  })
}

export async function logAlertLifecycle(input: {
  userId: string
  alertId: string
  dedupeKey: string
  event: ChimmyAlertLifecycleEvent
  metadata?: Record<string, unknown>
}): Promise<void> {
  await prisma.engagementEvent.create({
    data: {
      userId: input.userId,
      eventType: 'chimmy_alert_lifecycle',
      meta: {
        alertId: input.alertId,
        dedupeKey: input.dedupeKey,
        event: input.event,
        ...(input.metadata ?? {}),
      },
    },
  })
}

function toNotificationSeverity(severity: ChimmyAlertSeverity): 'low' | 'medium' | 'high' {
  if (severity === 'critical' || severity === 'urgent') return 'high'
  if (severity === 'action_recommended') return 'medium'
  return 'low'
}

function toNotificationCategory(alert: ChimmyAlert): 'ai_alerts' | 'commissioner_alerts' {
  return alert.roleScope === 'commissioner' || alert.roleScope === 'admin' ? 'commissioner_alerts' : 'ai_alerts'
}

export async function deliverAlert(
  alert: ChimmyAlert,
  context: ChimmyAlertContext,
  history?: ChimmyAlertDeliveryHistory,
): Promise<void> {
  const plan = routeAlertDelivery(alert, context, history)
  if (!plan.shouldDeliver) return

  // Use pre-computed channels on the alert when available (set by applyChannelPrefs
  // in runUnifiedAlertEngine), otherwise fall back to the plan's channels.
  const channels =
    alert.channels.length > 0 ? alert.channels : [...plan.surfaces, ...plan.transportChannels]

  const hasEmail = channels.includes('email')
  const hasSms = channels.includes('sms')
  const hasPush = channels.includes('push_notification') || channels.includes('mobile_push')

  const category = toNotificationCategory(alert)

  const action = alert.actions[0]
  const meta = {
    chimmyAlert: true,
    alertId: alert.alertId,
    dedupeKey: alert.dedupeKey,
    class: alert.class,
    alertType: alert.type,
    severity: alert.severity,
    urgencyScore: alert.urgencyScore,
    confidenceScore: alert.confidenceScore,
    channels,
    futureChannels: plan.futureChannels,
    primarySurface: plan.primarySurface,
    routingReason: plan.reason,
    lifecycleState: 'created',
    action,
    ...(alert.metadata ?? {}),
  }

  await createPlatformNotification({
    userId: context.userId,
    productType: 'app',
    type: 'chimmy_alert',
    title: alert.title,
    body: alert.message,
    severity: toNotificationSeverity(alert.severity),
    meta,
  })

  await dispatchNotification({
    userIds: [context.userId],
    category,
    productType: 'app',
    type: 'chimmy_alert',
    title: alert.title,
    body: alert.message,
    actionHref: action?.href,
    actionLabel: action?.label,
    severity: toNotificationSeverity(alert.severity),
    meta,
    skipChannels: { email: !hasEmail, sms: !hasSms, push: !hasPush },
  })

  await logAlertLifecycle({
    userId: context.userId,
    alertId: alert.alertId,
    dedupeKey: alert.dedupeKey,
    event: 'created',
    metadata: {
      channels,
      futureChannels: plan.futureChannels,
      primarySurface: plan.primarySurface,
      routingReason: plan.reason,
    },
  })
}

export async function runUnifiedAlertEngine(
  context: ChimmyAlertContext,
  opts?: { autoDeliver?: boolean; skipPrefsLoad?: boolean },
): Promise<ChimmyAlert[]> {
  // 1. Detect candidates from signal bundle
  const candidates = detectAlertCandidates(context)

  // 2. Fast pre-filter by roleScope/subscription (no DB needed)
  const roleFiltered = candidates.filter((candidate) => {
    if ((candidate.roleScope === 'commissioner' && context.role === 'member') ||
        (candidate.roleScope === 'admin' && context.role !== 'admin')) return false
    if (candidate.class === 'commissioner' &&
        !context.subscriptionState?.hasCommissioner &&
        context.role === 'commissioner') return false
    return true
  })

  // 3. Load preferences and delivery history in parallel
  const [prefs, historyByDedupeKey] = await Promise.all([
    opts?.skipPrefsLoad
      ? Promise.resolve(context.userPreferences ?? {})
      : loadChimmyAlertPreferences(context.userId),
    loadAlertDeliveryHistory(context),
  ])

  // Merge loaded prefs with any context overrides (context wins for per-session flags)
  const effectivePrefs = context.userPreferences
    ? { ...prefs, ...context.userPreferences }
    : prefs

  // 4. Render candidates → ChimmyAlert payloads
  const contextWithPrefs: ChimmyAlertContext = { ...context, userPreferences: effectivePrefs }
  const payloads = roleFiltered.map((c) => renderAlertPayload(c, contextWithPrefs))

  // 5. Run preference-based + history-based suppression engine
  const suppressionPassed = payloads.filter((alert) => {
    const decision = evaluateAlertSuppression(
      alert,
      contextWithPrefs,
      effectivePrefs,
      historyByDedupeKey[alert.dedupeKey],
    )
    return !decision.suppress
  })

  // 6. DB cooldown deduplication (respects effective cooldown multiplier)
  const deduped = await suppressDuplicateAlerts(suppressionPassed, contextWithPrefs, effectivePrefs)

  // 7. Group low-priority alerts to avoid noise (informational class cap)
  const grouped = groupLowPriorityAlerts(deduped)

  // 8. Route each alert to the right surfaces
  const routedAlerts = grouped.map((alert) => {
    const plan = routeAlertDelivery(alert, contextWithPrefs, historyByDedupeKey[alert.dedupeKey])
    const routedChannels = [...plan.surfaces, ...plan.transportChannels]

    // Apply channel preference overrides (push/email/sms opt-outs)
    const finalChannels = applyChannelPrefs(routedChannels, effectivePrefs)

    return {
      ...alert,
      channels: finalChannels,
      primaryChannel: plan.primarySurface,
      metadata: {
        ...(alert.metadata ?? {}),
        deliveryPlan: {
          primarySurface: plan.primarySurface,
          channels: finalChannels,
          futureChannels: plan.futureChannels,
          reason: plan.reason,
          shouldDeliver: plan.shouldDeliver,
        },
      },
    }
  })

  // 9. Auto-deliver if requested (background cron path)
  if (opts?.autoDeliver) {
    for (const alert of routedAlerts) {
      await deliverAlert(alert, contextWithPrefs, historyByDedupeKey[alert.dedupeKey])
    }
  }

  return routedAlerts
}
