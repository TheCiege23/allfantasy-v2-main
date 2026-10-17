import 'server-only'

import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { listFollowingUserIds, listPlayerFollows } from '@/lib/follows/playerFollows'
import { scanFreeAgentLeagues } from '@/lib/core-app/followingCard'
import { dispatchNotification } from '@/lib/notifications/NotificationDispatcher'
import type { FollowFreeAgentDeps } from './followFreeAgentCheck'

/**
 * The database side of lib/follows/followFreeAgentCheck.ts — kept apart so the check itself stays
 * pure enough to test without Prisma.
 *
 * Snapshots live in `SportsDataCache` (`follow-free:v1:<user>:<sleeperId>` → `{ held: [...] }`),
 * the same store the Chimmy checks use for their claims. Dedupe reads `PlatformNotification.sourceKey`,
 * the in-app row the dispatcher writes under `dedupePrefix`.
 */
export const followFreeAgentDeps: FollowFreeAgentDeps = {
  listUsers: (limit) => listFollowingUserIds('NFL', limit),
  listFollows: async (userId) => {
    const follows = await listPlayerFollows(userId)
    if (!follows) return null
    return follows
      .filter((f) => f.sport === 'NFL' && f.sleeperId)
      .map((f) => ({ sleeperId: f.sleeperId as string, externalId: f.externalId, name: f.name }))
  },
  loadLeagues: async (userId, season) => {
    const teams = await prisma.leagueTeam.findMany({
      where: { claimedByUserId: userId, league: { sport: 'NFL', season } },
      select: { league: { select: { id: true, name: true, platform: true, sport: true } } },
    })
    const seen = new Set<string>()
    const out: Array<{ id: string; name: string | null; platform: string | null; sport: string | null }> = []
    for (const t of teams) {
      if (seen.has(t.league.id)) continue
      seen.add(t.league.id)
      out.push({ id: t.league.id, name: t.league.name, platform: t.league.platform, sport: String(t.league.sport) })
    }
    return out
  },
  scan: async (userId, leagues, sleeperIds) =>
    scanFreeAgentLeagues(
      userId,
      leagues.map((l) => ({ id: l.id, name: l.name, platform: l.platform, sport: l.sport })),
      sleeperIds,
    ),
  readSnapshot: async (key) => {
    const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { data: true } })
    const held = (row?.data as { held?: unknown } | null)?.held
    return Array.isArray(held) ? held.filter((x): x is string => typeof x === 'string') : row ? [] : null
  },
  writeSnapshot: async (key, held, expiresAt) => {
    const data = { held, at: new Date().toISOString() } as Prisma.InputJsonValue
    await prisma.sportsDataCache.upsert({
      where: { cacheKey: key },
      create: { cacheKey: key, expiresAt, data },
      update: { expiresAt, data },
    })
  },
  alreadySent: async (sourceKey) =>
    (await prisma.platformNotification.findFirst({ where: { sourceKey }, select: { id: true } }).catch(() => null)) != null,
  dispatch: (input) =>
    dispatchNotification({
      userIds: [input.userId],
      category: 'followed_players',
      productType: 'app',
      type: 'followed_player_free_agent',
      title: input.title,
      body: input.body,
      actionHref: input.href,
      actionLabel: 'Claim him',
      leagueId: input.leagueId,
      severity: 'medium',
      dedupePrefix: input.dedupePrefix,
      meta: input.meta,
      // No registered SMS sender yet (Twilio A2P 10DLC); in-app, email and push go as the user set them.
      skipChannels: { sms: true },
    }),
}
