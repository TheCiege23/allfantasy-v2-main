import 'server-only'

import { prisma } from '@/lib/prisma'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import type { NotificationCategoryId } from '@/lib/notification-settings/types'
import { getLeagueMemberAppUserIds } from '@/lib/draft-notifications/DraftNotificationService'
import { isSystemLeagueOwner } from '@/lib/league-import/systemLeagueOwner'
import { leagueRealtimeStore } from '@/lib/league-events/realtime-store'
import { invokeLeagueFanoutHandlers } from '@/lib/league-events/subscribers'
import type { LeagueEventVisibility, LeagueFanoutEventType } from '@/lib/league-events/types'

async function getAllLeagueMemberUserIds(leagueId: string): Promise<string[]> {
  const [rosterIds, league] = await Promise.all([
    getLeagueMemberAppUserIds(leagueId),
    prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true } }),
  ])
  const ids = new Set<string>(rosterIds)
  if (league?.userId && !isSystemLeagueOwner(league.userId)) ids.add(league.userId)
  return Array.from(ids)
}

async function getElevatedCommissionerUserIds(leagueId: string): Promise<string[]> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { userId: true },
  })
  const ids = new Set<string>()
  // The system account owns leagues nobody proved they run; it is not a commissioner to notify.
  if (league?.userId && !isSystemLeagueOwner(league.userId)) ids.add(league.userId)
  const co = await prisma.leagueTeam.findMany({
    where: { leagueId, isCoCommissioner: true, platformUserId: { not: null } },
    select: { platformUserId: true },
  })
  for (const row of co) {
    if (row.platformUserId && !String(row.platformUserId).startsWith('orphan-')) {
      ids.add(row.platformUserId)
    }
  }
  /*
   * The people who CLAIMED a commissioner or co-commissioner team. `platformUserId` above is the
   * provider's id (an ESPN SWID), which no dispatch can address; `claimedByUserId` is ours. This is
   * how a proven commissioner of a system-owned league hears commissioner-only events at all.
   */
  const claimedLeaders = await Promise.resolve()
    .then(() =>
      prisma.leagueTeam.findMany({
        where: {
          leagueId,
          claimedByUserId: { not: null },
          OR: [{ isCommissioner: true }, { isCoCommissioner: true }],
        },
        select: { claimedByUserId: true },
      }),
    )
    .catch(() => [] as Array<{ claimedByUserId: string | null }>)
  for (const row of claimedLeaders ?? []) if (row.claimedByUserId) ids.add(row.claimedByUserId)
  return Array.from(ids)
}

export type PublishLeagueFanoutInput = {
  leagueId: string
  /** Stored on ActivityEvent.type and notification.type */
  eventType: LeagueFanoutEventType | string
  title: string
  message: string
  category: NotificationCategoryId
  visibility: LeagueEventVisibility
  actorUserId?: string | null
  meta?: Record<string, unknown>
  actionHref?: string
  actionLabel?: string
  severity?: 'low' | 'medium' | 'high'
  /** Per logical event — combined with userId for PlatformNotification.sourceKey dedupe */
  dedupeKey?: string
  /** Restrict transports while retaining each recipient's category and consent gates. */
  skipChannels?: { email?: boolean; sms?: boolean; push?: boolean }
  smsBody?: string
  skipActivityFeed?: boolean
  /** When true, skips persisting `LeagueEvent` (use with realtime-only hints). */
  skipLeagueEventRow?: boolean
  /** When true, skips `dispatchNotification` (use for noisy/high-frequency events; still writes activity + realtime unless skipped). */
  skipNotifications?: boolean
  skipRealtime?: boolean
}

/**
 * Persists a league activity row, notifies authorized users (respecting visibility),
 * and pushes a realtime envelope for connected clients.
 */
export async function publishLeagueFanoutEvent(input: PublishLeagueFanoutInput): Promise<void> {
  const {
    leagueId,
    eventType,
    title,
    message,
    category,
    visibility,
    actorUserId,
    meta,
    actionHref,
    actionLabel,
    severity = 'medium',
    dedupeKey,
    skipChannels,
    smsBody,
    skipActivityFeed,
    skipLeagueEventRow,
    skipNotifications,
    skipRealtime,
  } = input

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, sport: true },
  })
  if (!league) return

  const mergedMeta: Record<string, unknown> = {
    ...(meta ?? {}),
    leagueId,
    sport: league.sport,
    eventType,
    visibility,
  }

  if (!skipActivityFeed && !skipLeagueEventRow) {
    try {
      const vis = visibility === 'commissioners_only' ? 'commissioners_only' : 'league'
      await prisma.leagueEvent.create({
        data: {
          leagueId,
          eventType: String(eventType).slice(0, 64),
          title: title.slice(0, 256),
          description: message,
          payload: mergedMeta as import('@prisma/client').Prisma.InputJsonValue,
          visibility: vis,
        },
      })
    } catch (e) {
      console.warn('[publishLeagueFanoutEvent] leagueEvent', e)
    }
  }

  const effectiveSkipNotifications = skipNotifications

  if (!skipRealtime) {
    leagueRealtimeStore.publish(leagueId, {
      eventType: String(eventType),
      message,
      meta: mergedMeta,
    })
  }

  if (!effectiveSkipNotifications) {
    const userIds =
      visibility === 'commissioners_only'
        ? await getElevatedCommissionerUserIds(leagueId)
        : await getAllLeagueMemberUserIds(leagueId)

    if (userIds.length > 0) {
      const href = actionHref ?? `/league/${leagueId}`
      const baseDedupe = dedupeKey ? `league:${leagueId}:${dedupeKey}` : undefined

      try {
        await dispatchNotification({
          userIds,
          category,
          productType: 'app',
          type: String(eventType),
          title,
          body: message,
          actionHref: href,
          actionLabel: actionLabel ?? 'Open league',
          leagueId,
          meta: mergedMeta,
          severity,
          skipChannels,
          smsBody,
          ...(baseDedupe ? { dedupePrefix: baseDedupe } : {}),
        })
      } catch (e) {
        console.warn('[publishLeagueFanoutEvent] dispatchNotification', e)
      }
    }
  }

  await invokeLeagueFanoutHandlers({
    leagueId,
    eventType: String(eventType),
    actorUserId: actorUserId ?? null,
    meta: mergedMeta,
  })
}

/** A new league is an operational event for its commissioner and any members already attached. */
export async function publishLeagueCreatedNotice(input: { leagueId: string; actorUserId: string; leagueName: string; sport: string }): Promise<void> {
  await publishLeagueFanoutEvent({
    leagueId: input.leagueId,
    eventType: 'league_created',
    title: 'League created',
    message: `${input.leagueName} is ready to set up.`,
    category: 'commissioner_alerts',
    visibility: 'all_members',
    actorUserId: input.actorUserId,
    meta: { sport: input.sport },
    dedupeKey: `league_created:${input.leagueId}`,
    skipChannels: { email: true },
    smsBody: 'Your AllFantasy league is ready. Open the app to set it up.',
  })
}
