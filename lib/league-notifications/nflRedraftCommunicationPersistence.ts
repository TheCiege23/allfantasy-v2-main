import 'server-only'

import { prisma } from '@/lib/prisma'
import type { CanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'
import { toCanonicalLeagueRuntimeEvent } from '@/lib/league-runtime/leagueRuntimeEvents'
import { createPlatformNotification } from '@/lib/platform/notification-service'
import { createLeagueFeedEvent } from '@/lib/league-feed/createLeagueFeedEvent'
import type { LeagueFeedCategory } from '@/lib/league-feed/leagueFeedTypes'
import { createLeagueChatMessage } from '@/lib/league-chat/LeagueChatMessageService'
import { getLeagueMemberUserIds } from '@/lib/league-chat/leagueMemberIds'
import {
  buildNflRedraftCommunicationPlan,
  communicationDedupeKey,
  type NflRedraftCommunicationCategory,
  type NflRedraftCommunicationPlan,
} from '@/lib/league-notifications/nflRedraftCommunicationRuntime'
import { syncNflRedraftCommunicationToDiscord } from '@/lib/league-notifications/nflRedraftDiscordBridge'

export type PersistNflRedraftCommunicationResult =
  | {
      ok: true
      plan: NflRedraftCommunicationPlan
      created: {
        notifications: number
        feed: boolean
        chatMessageId: string | null
        discordStatus: 'sent' | 'not_configured' | 'failed' | 'skipped'
      }
    }
  | {
      ok: false
      code: 'LEAGUE_NOT_FOUND' | 'NOT_NFL_REDRAFT'
      message: string
    }

type LeagueRow = {
  id: string
  name: string | null
  userId: string
  sport: unknown
  leagueVariant?: string | null
  leagueType?: string | null
  isDynasty?: boolean | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => String(row ?? '').trim()).filter(Boolean)
}

function stringValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function isNflRedraftLeague(league: LeagueRow): boolean {
  const sport = String(league.sport ?? '').trim().toUpperCase()
  const variant = String(league.leagueVariant ?? league.leagueType ?? '').trim().toLowerCase()
  return sport === 'NFL' && (variant.includes('redraft') || !league.isDynasty)
}

function feedCategory(category: NflRedraftCommunicationCategory): LeagueFeedCategory {
  if (category === 'draft') return 'draft'
  if (category === 'lineups') return 'lineups'
  if (category === 'waivers') return 'waivers'
  if (category === 'trades') return 'trades'
  if (category === 'matchups' || category === 'scoring') return 'matchups'
  if (category === 'commissioner') return 'commissioner'
  if (category === 'system' || category === 'chat' || category === 'playoffs') return 'system'
  return 'other'
}

async function getRedraftMemberUserIds(leagueId: string): Promise<string[]> {
  const [leagueIds, redraftMembers] = await Promise.all([
    getLeagueMemberUserIds(leagueId),
    (prisma as any).redraftLeagueMember
      ?.findMany({
        where: { leagueId },
        select: { userId: true },
      })
      .catch(() => []) ?? Promise.resolve([]),
  ])
  return Array.from(new Set([
    ...leagueIds,
    ...(redraftMembers as Array<{ userId?: string | null }>).map((row) => row.userId).filter((id): id is string => Boolean(id)),
  ]))
}

function explicitAudience(event: CanonicalLeagueRuntimeEvent): string[] {
  const payload = record(event.payload)
  return Array.from(new Set([
    ...stringArray(payload.userIds),
    ...stringArray(payload.targetUserIds),
    ...stringArray(payload.notifyUserIds),
    ...stringArray(payload.mentionedUserIds),
    stringValue(payload.userId),
    stringValue(payload.targetUserId),
    stringValue(payload.ownerId),
    stringValue(payload.managerUserId),
  ].filter((id): id is string => Boolean(id))))
}

async function resolveAudience(event: CanonicalLeagueRuntimeEvent): Promise<Array<{ userId: string; teamId?: string | null }>> {
  const explicit = explicitAudience(event)
  if (event.type === 'league.chat.message' && explicit.length === 0) return []
  const ids = explicit.length > 0 ? explicit : await getRedraftMemberUserIds(event.leagueId)
  const payload = record(event.payload)
  const teamId =
    stringValue(payload.teamId) ??
    stringValue(payload.rosterId) ??
    stringValue(payload.managerTeamId)
  return Array.from(new Set(ids)).map((userId) => ({ userId, teamId }))
}

async function findLeague(leagueId: string): Promise<LeagueRow | null> {
  return prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      name: true,
      userId: true,
      sport: true,
      leagueVariant: true,
      leagueType: true,
      isDynasty: true,
    },
  }) as Promise<LeagueRow | null>
}

async function createNotificationRows(plan: NflRedraftCommunicationPlan): Promise<number> {
  let created = 0
  for (const notification of plan.notifications) {
    const ok = await createPlatformNotification({
      userId: notification.userId,
      leagueId: notification.leagueId,
      productType: 'app',
      type: notification.meta.relatedRuntimeEventType ? String(notification.meta.relatedRuntimeEventType).replace(/\./g, '_') : notification.eventType,
      title: notification.title,
      body: notification.body,
      severity: notification.priority,
      sourceKey: notification.sourceKey,
      meta: notification.meta,
    })
    if (ok) created += 1
  }
  return created
}

async function createFeedRow(plan: NflRedraftCommunicationPlan): Promise<boolean> {
  if (!plan.feed) return false
  const existing = await (prisma as any).leagueEvent
    .findFirst({
      where: {
        leagueId: plan.feed.leagueId,
        eventType: plan.feed.eventType,
        payload: {
          path: ['details', 'dedupeKey'],
          equals: plan.feed.dedupeKey,
        },
      },
      select: { id: true },
    })
    .catch(() => null)
  if (existing) return false
  const row = await createLeagueFeedEvent(
    {
      leagueId: plan.feed.leagueId,
      eventType: plan.feed.eventType,
      message: plan.feed.message,
      actorType: plan.category === 'commissioner' ? 'commissioner' : 'system',
      category: feedCategory(plan.feed.category),
      importance: plan.feed.importance,
      details: {
        ...plan.feed.details,
        dedupeKey: plan.feed.dedupeKey,
      },
    },
    { forceSystem: true },
  )
  return Boolean(row)
}

async function createChatRow(
  plan: NflRedraftCommunicationPlan,
  senderUserId: string,
): Promise<string | null> {
  if (!plan.chat) return null
  const dedupeKey = plan.chat.dedupeKey.slice(0, 64)
  const existing = await prisma.leagueChatMessage.findFirst({
    where: {
      leagueId: plan.chat.leagueId,
      globalBroadcastId: dedupeKey,
    },
    select: { id: true },
  })
  if (existing) return existing.id

  const created = await createLeagueChatMessage(plan.chat.leagueId, senderUserId, plan.chat.body, {
    type: plan.chat.messageType,
    source: plan.chat.source,
    globalBroadcastId: dedupeKey,
    messageSubtype: 'g42_system',
    metadata: {
      ...plan.chat.metadata,
      discordAuthorName: plan.category === 'commissioner' ? 'Commissioner' : 'AllFantasy',
    },
  })
  return created?.id ?? null
}

export async function persistNflRedraftCommunicationForEvent(input: {
  event: CanonicalLeagueRuntimeEvent
  actorUserId?: string | null
  mirrorToDiscord?: boolean
  includeEmailPushPlaceholders?: boolean
}): Promise<PersistNflRedraftCommunicationResult> {
  const league = await findLeague(input.event.leagueId)
  if (!league) {
    return { ok: false, code: 'LEAGUE_NOT_FOUND', message: 'League not found.' }
  }
  if (!isNflRedraftLeague(league)) {
    return { ok: false, code: 'NOT_NFL_REDRAFT', message: 'G42 communication runtime only handles NFL redraft leagues.' }
  }

  const audience = await resolveAudience(input.event)
  const plan = buildNflRedraftCommunicationPlan({
    event: input.event,
    audience,
    leagueName: league.name,
    includeEmailPushPlaceholders: input.includeEmailPushPlaceholders,
  })

  const notifications = await createNotificationRows(plan)
  const feed = await createFeedRow(plan)
  const chatMessageId = await createChatRow(plan, input.actorUserId ?? input.event.actorUserId ?? league.userId)
  let discordStatus: 'sent' | 'not_configured' | 'failed' | 'skipped' = 'skipped'

  if (input.mirrorToDiscord !== false && chatMessageId && plan.discord) {
    const discord = await syncNflRedraftCommunicationToDiscord({
      leagueId: plan.discord.leagueId,
      messageId: chatMessageId,
      title: plan.discord.title,
      body: plan.discord.body,
    })
    discordStatus = discord.status
  }

  return {
    ok: true,
    plan,
    created: {
      notifications,
      feed,
      chatMessageId,
      discordStatus,
    },
  }
}

export async function createNflRedraftCommissionerAnnouncement(input: {
  leagueId: string
  actorUserId: string
  title?: string | null
  body: string
  announcementType?: 'league' | 'draft_reminder' | 'waiver_reminder' | 'playoff_reminder'
  pinned?: boolean
  mirrorToDiscord?: boolean
}): Promise<PersistNflRedraftCommunicationResult> {
  const body = input.body.trim()
  const title = input.title?.trim() || 'Commissioner announcement'
  const now = new Date()
  const event = toCanonicalLeagueRuntimeEvent({
    leagueId: input.leagueId,
    eventType: 'commissioner.announcement.created',
    createdAt: now,
    actorUserId: input.actorUserId,
    payload: {
      title,
      body,
      announcementType: input.announcementType ?? 'league',
      pinned: input.pinned === true,
    },
  })
  return persistNflRedraftCommunicationForEvent({
    event,
    actorUserId: input.actorUserId,
    mirrorToDiscord: input.mirrorToDiscord,
  })
}

export async function createNflRedraftChatSystemMessage(input: {
  leagueId: string
  actorUserId?: string | null
  title?: string | null
  body: string
  eventType?: string
  payload?: Record<string, unknown>
  mirrorToDiscord?: boolean
}): Promise<PersistNflRedraftCommunicationResult> {
  const event = toCanonicalLeagueRuntimeEvent({
    leagueId: input.leagueId,
    eventType: input.eventType ?? 'league.chat.system_message',
    actorUserId: input.actorUserId ?? null,
    payload: {
      title: input.title ?? 'League chat update',
      body: input.body,
      ...(input.payload ?? {}),
    },
  })
  return persistNflRedraftCommunicationForEvent({
    event,
    actorUserId: input.actorUserId,
    mirrorToDiscord: input.mirrorToDiscord,
  })
}

export function getNflRedraftCommunicationEventDedupeKey(event: CanonicalLeagueRuntimeEvent): string {
  return communicationDedupeKey(event)
}
