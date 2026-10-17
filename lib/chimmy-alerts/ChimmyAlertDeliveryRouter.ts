import { prisma } from '@/lib/prisma'
import type { ChimmyAlert, ChimmyAlertChannel, ChimmyAlertContext } from './types'
import { isWithinQuietHours as isWithinSharedQuietHours } from '@/lib/notifications/quietHours'

export interface ChimmyAlertDeliveryHistory {
  lastSeenAt?: Date
  lastDismissedAt?: Date
  lastReadAt?: Date
  lastDeliveredChannels?: ChimmyAlertChannel[]
  /** How many times the user has explicitly dismissed this dedupeKey. */
  dismissalCount?: number
  /** When the user last took action on this alert (clicked CTA / acted_on event). */
  actedOnAt?: Date
  /** When the alert was last resolved (underlying condition gone). */
  resolvedAt?: Date
  /** Snooze expiry timestamp in ms (loaded from preferences, not from DB history). */
  snoozeUntil?: number
}

export interface ChimmyAlertDeliveryPlan {
  shouldDeliver: boolean
  reason: string
  surfaces: ChimmyAlertChannel[]
  transportChannels: ChimmyAlertChannel[]
  futureChannels: ChimmyAlertChannel[]
  primarySurface: ChimmyAlertChannel
}

/*
 * ⚠ THE SHARED RULE, NOT A LOCAL COPY. This read `now.getHours()` — the SERVER's hour (UTC on
 * Railway) — and ignored the window's own `timezone`, so a 22→7 window in New York ran 18→3 local.
 * `lib/notifications/quietHours.ts` says it replaced this; the router was never moved over.
 */
function isWithinQuietHours(context: ChimmyAlertContext): boolean {
  return isWithinSharedQuietHours(context.userPreferences?.quietHours ?? null, context.now ?? new Date())
}

function isLeagueWideAlert(alert: ChimmyAlert): boolean {
  if (alert.roleScope === 'commissioner' || alert.roleScope === 'admin') return true
  return alert.class === 'commissioner' || alert.class === 'story_engagement' || alert.class === 'admin_integrity'
}

function needsActionNow(alert: ChimmyAlert): boolean {
  if (alert.severity === 'critical') return true
  if (alert.type === 'on_the_clock') return true
  if (alert.type === 'lineup_incomplete' && alert.urgencyScore >= 82) return true
  if (alert.type === 'priority_add_available' && alert.urgencyScore >= 80) return true
  return false
}

function relevantPageSurface(alert: ChimmyAlert): string | null {
  if (alert.class === 'waiver') return 'waiver'
  if (alert.class === 'lineup' || alert.class === 'team_roster') return 'roster'
  if (alert.class === 'matchup') return 'matchup'
  if (alert.class === 'draft') return 'draft_room'
  if (alert.class === 'commissioner') return 'commissioner_panel'
  return null
}

function uniqueChannels(channels: ChimmyAlertChannel[]): ChimmyAlertChannel[] {
  const seen = new Set<string>()
  const out: ChimmyAlertChannel[] = []
  for (const channel of channels) {
    if (seen.has(channel)) continue
    seen.add(channel)
    out.push(channel)
  }
  return out
}

function baseSurfacesByType(alert: ChimmyAlert, context: ChimmyAlertContext): ChimmyAlertChannel[] {
  if (alert.type === 'on_the_clock') return ['critical_drawer', 'in_app_banner']

  if (alert.type === 'lineup_incomplete') {
    const surfaces: ChimmyAlertChannel[] = ['in_app_banner', 'dashboard_card']
    if (context.pageSurface === 'roster' || context.pageSurface === 'matchup') surfaces.push('page_inline')
    return surfaces
  }

  if (alert.type === 'weekly_recap_ready') {
    return context.role === 'commissioner' ? ['commissioner_panel'] : ['dashboard_card']
  }

  if (alert.type === 'priority_add_available') {
    const surfaces: ChimmyAlertChannel[] = ['dashboard_card', 'page_inline']
    if (context.pageSurface === 'waiver') surfaces.push('floating_nudge')
    return surfaces
  }

  if (alert.type === 'suspicious_trade_signal') {
    return ['commissioner_panel']
  }

  if (alert.class === 'commissioner') return ['commissioner_panel']

  if (alert.class === 'draft') {
    return context.pageSurface === 'draft_room' ? ['floating_nudge'] : ['dashboard_card']
  }

  if (alert.class === 'waiver') return ['dashboard_card', 'page_inline']
  if (alert.class === 'lineup' || alert.class === 'team_roster') return ['dashboard_card', 'in_app_banner']
  if (alert.class === 'trade') return ['dashboard_card', 'private_ai_chat']
  if (alert.class === 'matchup') return ['page_inline', 'floating_nudge']

  return ['dashboard_card']
}

function pushEligible(alert: ChimmyAlert, context: ChimmyAlertContext): boolean {
  if (isWithinQuietHours(context) && alert.severity !== 'critical') return false
  if (!needsActionNow(alert) && alert.severity !== 'urgent') return false
  if (alert.type === 'weekly_recap_ready') return false
  return true
}

export function routeAlertDelivery(
  alert: ChimmyAlert,
  context: ChimmyAlertContext,
  history?: ChimmyAlertDeliveryHistory,
): ChimmyAlertDeliveryPlan {
  const leagueWide = isLeagueWideAlert(alert)
  const actionNow = needsActionNow(alert)
  const targetPage = relevantPageSurface(alert)
  const onRelevantPage = Boolean(targetPage && context.pageSurface === targetPage)

  const dismissedRecently = Boolean(
    history?.lastDismissedAt && (Date.now() - history.lastDismissedAt.getTime()) < 1000 * 60 * 60 * 12,
  )
  const seenRecently = Boolean(
    history?.lastSeenAt && (Date.now() - history.lastSeenAt.getTime()) < 1000 * 60 * 60 * 3,
  )

  if (dismissedRecently && alert.severity !== 'critical') {
    return {
      shouldDeliver: false,
      reason: 'dismissed_recently',
      surfaces: [],
      transportChannels: [],
      futureChannels: [],
      primarySurface: 'notification_center',
    }
  }

  let surfaces = baseSurfacesByType(alert, context)

  if (onRelevantPage && !actionNow && alert.type !== 'priority_add_available' && alert.type !== 'suspicious_trade_signal') {
    surfaces = surfaces.filter((s) => s !== 'dashboard_card')
    surfaces.push('floating_nudge')
  }

  if (seenRecently && !actionNow) {
    surfaces = surfaces.filter((s) => s !== 'floating_nudge' && s !== 'in_app_banner')
  }

  if (leagueWide) {
    surfaces = surfaces.filter((s) => s !== 'private_ai_chat')
  }

  if (!leagueWide && alert.class === 'trade' && alert.severity !== 'critical') {
    surfaces.push('private_ai_chat')
  }

  if (alert.type !== 'suspicious_trade_signal') {
    surfaces.push('notification_center')
  }

  surfaces = uniqueChannels(surfaces)

  const transportChannels: ChimmyAlertChannel[] = []
  if (pushEligible(alert, context)) transportChannels.push('push_notification')

  const futureChannels: ChimmyAlertChannel[] =
    alert.severity === 'critical' || (alert.severity === 'urgent' && leagueWide)
      ? ['email', 'sms']
      : []

  const all = uniqueChannels([...surfaces, ...transportChannels])
  const primarySurface = all[0] ?? 'notification_center'

  return {
    shouldDeliver: all.length > 0,
    reason: actionNow ? 'urgent_action_routing' : 'contextual_routing',
    surfaces,
    transportChannels,
    futureChannels,
    primarySurface,
  }
}

export async function loadAlertDeliveryHistory(
  context: ChimmyAlertContext,
): Promise<Record<string, ChimmyAlertDeliveryHistory>> {
  const from = new Date((context.now ?? new Date()).getTime() - 1000 * 60 * 60 * 24 * 14)
  const rows = await prisma.platformNotification.findMany({
    where: {
      userId: context.userId,
      type: 'chimmy_alert',
      createdAt: { gte: from },
    },
    select: {
      createdAt: true,
      readAt: true,
      meta: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 400,
  })

  const stateByKey: Record<string, ChimmyAlertDeliveryHistory> = {}
  for (const row of rows) {
    const meta = (row.meta ?? {}) as Record<string, unknown>
    const dedupeKey = typeof meta.dedupeKey === 'string' ? meta.dedupeKey : null
    if (!dedupeKey) continue

    const current = stateByKey[dedupeKey] ?? {}
    current.lastSeenAt = current.lastSeenAt ?? row.createdAt
    if (row.readAt && !current.lastReadAt) current.lastReadAt = row.readAt
    if (meta.lifecycleState === 'dismissed' && !current.lastDismissedAt) current.lastDismissedAt = row.createdAt

    if (!current.lastDeliveredChannels && Array.isArray(meta.channels)) {
      current.lastDeliveredChannels = (meta.channels as unknown[])
        .filter((channel): channel is ChimmyAlertChannel => typeof channel === 'string')
    }

    stateByKey[dedupeKey] = current
  }

  // Load dismissal counts and acted_on / resolved events from engagementEvent
  const lifecycleRows = await prisma.engagementEvent.findMany({
    where: {
      userId: context.userId,
      eventType: 'chimmy_alert_lifecycle',
      createdAt: { gte: from },
    },
    select: { createdAt: true, meta: true },
    orderBy: { createdAt: 'desc' },
    take: 500,
  })

  for (const row of lifecycleRows) {
    const meta = (row.meta ?? {}) as Record<string, unknown>
    const dedupeKey = typeof meta.dedupeKey === 'string' ? meta.dedupeKey : null
    const event = typeof meta.event === 'string' ? meta.event : null
    if (!dedupeKey || !event) continue

    const current = stateByKey[dedupeKey] ?? {}

    if (event === 'dismissed') {
      current.dismissalCount = (current.dismissalCount ?? 0) + 1
      if (!current.lastDismissedAt || row.createdAt > current.lastDismissedAt) {
        current.lastDismissedAt = row.createdAt
      }
    }

    if (event === 'acted_on' && !current.actedOnAt) {
      current.actedOnAt = row.createdAt
    }

    if (event === 'resolved' && !current.resolvedAt) {
      current.resolvedAt = row.createdAt
    }

    stateByKey[dedupeKey] = current
  }

  return stateByKey
}
