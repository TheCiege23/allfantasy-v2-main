import { prisma } from '@/lib/prisma'
import type { PlatformNotification } from '@/types/platform-shared'

async function getFromUnifiedTable(
  appUserId: string,
  limit: number,
  options?: { leagueId?: string | null },
): Promise<PlatformNotification[] | null> {
  try {
    const rows = await (prisma as any).platformNotification.findMany({
      where: {
        userId: appUserId,
        ...(options?.leagueId ? { leagueId: options.leagueId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return rows.map((row: any) => ({
      id: String(row.id),
      type: String(row.type || 'notification'),
      title: String(row.title || 'Notification'),
      body: row.body || null,
      product: (row.productType || 'shared') as PlatformNotification['product'],
      severity: (row.severity || 'low') as PlatformNotification['severity'],
      read: Boolean(row.readAt),
      createdAt: new Date(row.createdAt).toISOString(),
      meta: {
        ...((row.meta as Record<string, unknown> | null) || {}),
        ...(row.leagueId ? { leagueId: String(row.leagueId) } : {}),
      },
    }))
  } catch {
    return null
  }
}

async function getFallback(
  appUserId: string,
  limit: number,
  options?: { leagueId?: string | null },
): Promise<PlatformNotification[]> {
  const [bracketFeed, tradeAlerts] = await Promise.all([
    (prisma as any).bracketFeedEvent
      .findMany({
        where: {
          ...(options?.leagueId
            ? { leagueId: options.leagueId }
            : { OR: [{ league: { members: { some: { userId: appUserId } } } }, { leagueId: null }] }),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          eventType: true,
          headline: true,
          detail: true,
          createdAt: true,
          leagueId: true,
          tournamentId: true,
        },
      })
      .catch(() => []),
    (prisma as any).tradeNotification
      .findMany({
        where: {
          userId: appUserId,
          ...(options?.leagueId ? { leagueId: options.leagueId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          type: true,
          status: true,
          aiVerdict: true,
          leagueId: true,
          sleeperLeagueId: true,
          seenAt: true,
          createdAt: true,
        },
      })
      .catch(() => []),
  ])

  const mappedFeed: PlatformNotification[] = bracketFeed.map((event: any) => ({
    id: `bracket_feed_${event.id}`,
    type: event.eventType || 'bracket_event',
    title: event.headline || 'Bracket update',
    body: event.detail || null,
    product: 'bracket',
    severity: event.eventType === 'breaking_news' ? 'high' : 'low',
    read: false,
    createdAt: new Date(event.createdAt).toISOString(),
    meta: {
      leagueId: event.leagueId || null,
      tournamentId: event.tournamentId || null,
    },
  }))

  const mappedTrade: PlatformNotification[] = tradeAlerts.map((alert: any) => ({
    id: `trade_alert_${alert.id}`,
    type: alert.type || 'trade',
    title: alert.aiVerdict ? `Trade Alert: ${alert.aiVerdict}` : 'Trade Alert',
    body: alert.status ? `Status: ${alert.status}` : null,
    product: 'legacy',
    severity: alert.status === 'pending' ? 'medium' : 'low',
    read: Boolean(alert.seenAt),
    createdAt: new Date(alert.createdAt).toISOString(),
    meta: {
      leagueId: alert.leagueId || null,
      sleeperLeagueId: alert.sleeperLeagueId || null,
    },
  }))

  return [...mappedFeed, ...mappedTrade]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit)
}

export async function getPlatformNotifications(
  appUserId: string,
  limit = 40,
  options?: { leagueId?: string | null },
): Promise<PlatformNotification[]> {
  const take = Math.max(1, Math.min(limit, 100))

  const unified = await getFromUnifiedTable(appUserId, take, options)
  if (unified) return unified

  return getFallback(appUserId, take, options)
}

export async function markPlatformNotificationRead(appUserId: string, notificationId: string): Promise<boolean> {
  try {
    const result = await (prisma as any).platformNotification.updateMany({
      where: { id: notificationId, userId: appUserId },
      data: { readAt: new Date() },
    })
    return (result?.count ?? 0) > 0
  } catch {
    return false
  }
}

export async function markAllPlatformNotificationsRead(
  appUserId: string,
  options?: { leagueId?: string | null },
): Promise<boolean> {
  try {
    await (prisma as any).platformNotification.updateMany({
      where: {
        userId: appUserId,
        readAt: null,
        ...(options?.leagueId ? { leagueId: options.leagueId } : {}),
      },
      data: { readAt: new Date() },
    })
    return true
  } catch {
    return false
  }
}

export async function createPlatformNotification(params: {
  userId: string
  leagueId?: string | null
  productType?: 'shared' | 'app' | 'bracket' | 'legacy'
  type: string
  title: string
  body?: string
  severity?: 'low' | 'medium' | 'high'
  meta?: Record<string, unknown>
  /** Unique per notification; duplicate inserts are skipped (idempotent fan-out). */
  sourceKey?: string | null
}): Promise<boolean> {
  try {
    if (params.sourceKey) {
      const existing = await (prisma as any).platformNotification.findUnique({
        where: { sourceKey: params.sourceKey },
        select: { id: true },
      })
      if (existing) return true
    }
    await (prisma as any).platformNotification.create({
      data: {
        userId: params.userId,
        leagueId: params.leagueId ?? undefined,
        productType: params.productType || 'shared',
        type: params.type,
        title: params.title,
        body: params.body || null,
        severity: params.severity || 'low',
        meta: params.meta || undefined,
        sourceKey: params.sourceKey ?? undefined,
      },
    })
    return true
  } catch {
    return false
  }
}
